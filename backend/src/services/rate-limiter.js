import { createHash } from 'node:crypto';
import { CONFIG } from './config.js';

const MAX_BUCKETS = 10000;

function resolveTierLimit(tier, tiers) {
    const limit = Number(tiers?.[tier]);
    if (Number.isFinite(limit) && limit > 0) return limit;
    const general = Number(tiers?.general);
    return Number.isFinite(general) && general > 0 ? general : 60;
}

export function createRateLimiter(options = {}) {
    const windowMs = Number(options.windowMs ?? CONFIG.rateLimit.windowMs) || 60000;
    const tiers = options.tiers ?? CONFIG.rateLimit.tiers;
    const nowFn = options.now ?? Date.now;
    const maxBuckets = Number(options.maxBuckets) || MAX_BUCKETS;

    const buckets = new Map();

    function resolveLimit(tier) {
        return resolveTierLimit(tier, tiers);
    }

    function bucketKey(key, tier) {
        return `${tier}:${key}`;
    }

    function pruneExpired(mapKey) {
        const timestamps = buckets.get(mapKey);
        if (!timestamps) return null;
        const cutoff = nowFn() - windowMs;
        let i = 0;
        while (i < timestamps.length && timestamps[i] <= cutoff) i++;
        if (i > 0) timestamps.splice(0, i);
        if (timestamps.length === 0) {
            buckets.delete(mapKey);
            return null;
        }
        return timestamps;
    }

    function sweepExpired() {
        if (buckets.size < maxBuckets) return;
        const cutoff = nowFn() - windowMs;
        for (const [mapKey, timestamps] of buckets) {
            let i = 0;
            while (i < timestamps.length && timestamps[i] <= cutoff) i++;
            if (i > 0) timestamps.splice(0, i);
            if (timestamps.length === 0) buckets.delete(mapKey);
        }
    }

    function check(key, tier = 'general') {
        const limit = resolveLimit(tier);
        const mapKey = bucketKey(key, tier);
        sweepExpired();
        const timestamps = pruneExpired(mapKey);
        if (timestamps && timestamps.length >= limit) {
            const oldest = timestamps[0];
            const retryAfterSec = Math.max(1, Math.ceil((windowMs - (nowFn() - oldest)) / 1000));
            return { allowed: false, retryAfterSec };
        }
        if (!buckets.has(mapKey)) buckets.set(mapKey, []);
        buckets.get(mapKey).push(nowFn());
        return { allowed: true };
    }

    return { check };
}

/**
 * Conteo service-wide (#455) respaldado por Azure Table Storage.
 *
 * El limitador en memoria vale para UNA instancia; Azure Functions escala a
 * varias, así que una ráfaga concurrente se reparte entre instancias y cada
 * una ve pocos pedidos: 237/240 pasaron sin 429. Acá el estado vive en una
 * sola entidad por (tier, clave):
 *
 *   - Ventana deslizante aproximada de dos ventanas fijas: la ventana previa
 *     pesa la fracción de la ventana actual que aún no pasó (Cloudflare-style).
 *   - Escritura condicional por ETag: lectura → si hay lugar, escritura con
 *     `if-match`; en conflicto (412/409) backoff exponencial con jitter y
 *     reintento. Como cada perdedor relee, en cuanto el contador llega al tope
 *     las lectures restantes niegan sin volver a escribir.
 *   - Si storage no está disponible, `check` lanza y el caller (withRateLimit)
 *     cae al limitador en memoria: disponibilidad primero, tope best-effort.
 */

export function isSharedRateLimitEnabled() {
    const flag = String(process.env.RATE_LIMIT_SHARED ?? '').trim().toLowerCase();
    if (flag === 'true' || flag === '1') return true;
    if (flag === 'false' || flag === '0') return false;
    // En Azure Functions la variable siempre existe ('Production' en la nube,
    // 'Development' en `func start`): el tope service-wide sólo aplica en prod
    // y en tests/CI explícitamente encendido con RATE_LIMIT_SHARED=true.
    return String(process.env.AZURE_FUNCTIONS_ENVIRONMENT ?? '').trim().toLowerCase() === 'production';
}

function sanitizeRowKey(value) {
    // RowKey no admite `/\#?` ni comillas: todo lo no [A-Za-z0-9_.-] colapsa a '_' (conservador: agrupa claves de más).
    return String(value).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 1024);
}

function partitionForRowKey(rowKey) {
    // Hash corto: distribuye las claves entre particiones sin concentrar todo el tráfico en una.
    return createHash('sha1').update(rowKey).digest('hex').slice(0, 4);
}

const SHARED_MAX_BACKOFF_MS = 500;
const SHARED_BASE_BACKOFF_MS = 25;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSharedRateLimiter(options = {}) {
    const windowMs = Number(options.windowMs ?? CONFIG.rateLimit.windowMs) || 60000;
    const tiers = options.tiers ?? CONFIG.rateLimit.tiers;
    const nowFn = options.now ?? Date.now;
    const tableName = options.tableName ?? CONFIG.rateLimit.sharedTable;
    const maxAttemptsOption = Number(options.maxAttempts) || 0;

    let tableReady = null;

    async function getReadyClient() {
        const { getTableClient } = await import('./storage.js');
        const client = getTableClient(tableName);
        if (!tableReady) {
            tableReady = client.createTable().then(() => true).catch((err) => {
                if (err?.statusCode === 409) return true; // la tabla ya existe
                tableReady = null; // volver a intentar en el próximo pedido
                throw err;
            });
        }
        await tableReady;
        return client;
    }

    async function check(key, tier = 'general') {
        const limit = resolveTierLimit(tier, tiers);
        const now = nowFn();
        const windowIdx = Math.floor(now / windowMs);
        const elapsedInWindow = now - windowIdx * windowMs;
        const previousWeight = 1 - elapsedInWindow / windowMs;
        const rowKey = sanitizeRowKey(`${tier}:${key}`);
        const partitionKey = partitionForRowKey(rowKey);
        // Cada conflicto implica un avance del contador: con `limit + margen`
        // intentos la denegación se observa antes de agotar reintentos.
        const maxAttempts = maxAttemptsOption || Math.min(100, limit + 20);

        const client = await getReadyClient();
        let backoffMs = SHARED_BASE_BACKOFF_MS;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            let entity = null;
            try {
                entity = await client.getEntity(partitionKey, rowKey);
            } catch (err) {
                if (err?.statusCode !== 404) throw err;
            }

            let previousCount = 0;
            let currentCount = 0;
            const storedWindow = Number(entity?.windowIdx);
            if (entity && storedWindow === windowIdx) {
                previousCount = Number(entity.previousCount) || 0;
                currentCount = Number(entity.currentCount) || 0;
            } else if (entity && storedWindow === windowIdx - 1) {
                // La ventana que era "actual" pasó a ser "previa".
                previousCount = Number(entity.currentCount) || 0;
                currentCount = 0;
            }
            // Entidades de ventanas más viejas (o skew de reloj) se resetean.

            const used = previousCount * previousWeight + currentCount;
            if (used >= limit) {
                return {
                    allowed: false,
                    retryAfterSec: Math.max(1, Math.ceil((windowMs - elapsedInWindow) / 1000)),
                };
            }

            const next = {
                partitionKey,
                rowKey,
                windowIdx,
                previousCount,
                currentCount: currentCount + 1,
                updatedAt: new Date(now).toISOString(),
            };

            try {
                if (entity) {
                    await client.updateEntity(next, 'Replace', { etag: entity.etag });
                } else {
                    await client.createEntity(next);
                }
                return { allowed: true };
            } catch (err) {
                if (err?.statusCode === 412 || err?.statusCode === 409) {
                    // Otro request escribió primero: esperar con jitter y releer.
                    await sleep(Math.round(backoffMs + Math.random() * backoffMs));
                    backoffMs = Math.min(SHARED_MAX_BACKOFF_MS, Math.round(backoffMs * 1.7));
                    continue;
                }
                throw err;
            }
        }

        // Camino prácticamente inalcanzable (cada conflicto avanza el contador
        // y la denegación llega por lectura): decisión final por relectura.
        try {
            const entity = await client.getEntity(partitionKey, rowKey);
            const storedWindow = Number(entity?.windowIdx);
            let previousCount = 0;
            let currentCount = 0;
            if (storedWindow === windowIdx) {
                previousCount = Number(entity.previousCount) || 0;
                currentCount = Number(entity.currentCount) || 0;
            } else if (storedWindow === windowIdx - 1) {
                previousCount = Number(entity.currentCount) || 0;
            }
            const used = previousCount * previousWeight + currentCount;
            if (used >= limit) {
                return {
                    allowed: false,
                    retryAfterSec: Math.max(1, Math.ceil((windowMs - elapsedInWindow) / 1000)),
                };
            }
        } catch (err) {
            if (err?.statusCode !== 404) throw err;
        }
        return { allowed: true };
    }

    return { check };
}
