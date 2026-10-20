/**
 * services/caudal-events.js — registro del caudal denegado y del umbral (#458)
 *
 * El tope sin registro deja a quien opera a ciegas: "hubo 429" no dice cuándo,
 * a quién, por qué eje ni con qué caudal. Cada denegación y cada cruce de
 * umbral deja una fila en `RateLimitEvents` con la ventana, la clase, la
 * clave, el motivo y el caudal usado, de modo que alguien que no estuvo pueda
 * reconstruir la noche.
 *
 * Escritura best-effort: el registro es observabilidad, nunca el resultado. Si
 * storage falla, la decisión de caudal ya está tomada y sólo se pierde la fila
 * (con un warn throttled); la API no se cae por no poder anotar.
 */
import { CONFIG } from './config.js';

const TABLE_NAME = () => CONFIG.rateLimit.eventsTable || 'RateLimitEvents';
const WARN_INTERVAL_MS = 30000;

let tableReady = null;
let lastWarnAt = 0;
// Dedupe del umbral cuando no hay almacén (storage caído o modo memoria): una
// sola anotación por ventana y clase en esta instancia.
const localClaims = new Set();

function warnThrottled(message) {
    const now = Date.now();
    if (now - lastWarnAt < WARN_INTERVAL_MS) return;
    lastWarnAt = now;
    console.warn(`[CaudalEvents] ${message}`);
}

async function getClient() {
    const { getTableClient } = await import('./storage.js');
    const client = getTableClient(TABLE_NAME());
    if (!tableReady) {
        tableReady = client.createTable().then(() => true).catch((err) => {
            if (err?.statusCode === 409) return true; // la tabla ya existe
            tableReady = null; // reintentar en el próximo evento
            throw err;
        });
    }
    await tableReady;
    return client;
}

export function dayPartitionOf(at) {
    const date = at instanceof Date ? at : new Date(at ?? Date.now());
    return date.toISOString().slice(0, 10);
}

function sanitizeKeyPart(value) {
    return String(value ?? '').replace(/[^A-Za-z0-9_.-]/g, '_');
}

/**
 * Fila del registro. `kind` distingue la denegación del cruce de umbral; el
 * resto de los campos son los que permiten reconstruir qué se degradó.
 */
export function buildCaudalEventRow({
    kind,
    reason,
    at,
    caudalClass,
    tier,
    route,
    method,
    key,
    windowIdx,
    windowMs,
    used,
    limit,
    retryAfterSec,
    correlationId,
    instance,
    suffix,
}) {
    const timestamp = at ?? new Date().toISOString();
    const isThreshold = kind === 'threshold';
    const rowKey = isThreshold
        // Una sola fila por ventana y clase: la creación condicional (409 si ya
        // existe) es además el candado que evita un aviso por instancia.
        ? `threshold-${sanitizeKeyPart(caudalClass)}-${sanitizeKeyPart(windowIdx)}`
        : `${sanitizeKeyPart(Date.parse(timestamp) || Date.now())}-${sanitizeKeyPart(suffix ?? Math.random().toString(36).slice(2, 8))}`;

    return {
        partitionKey: dayPartitionOf(timestamp),
        rowKey,
        kind: isThreshold ? 'threshold' : 'denial',
        at: timestamp,
        reason: reason || '',
        caudalClass: caudalClass || '',
        tier: tier || '',
        route: route || '',
        method: method || '',
        key: key || '',
        windowIdx: Number(windowIdx) || 0,
        windowMs: Number(windowMs) || 0,
        used: Number(used) || 0,
        limit: Number(limit) || 0,
        retryAfterSec: Number(retryAfterSec) || 0,
        correlationId: correlationId || '',
        instance: instance || '',
    };
}

/**
 * Anota un evento. Nunca lanza: si el registro no puede escribir, se pierde la
 * fila y la API sigue.
 */
export async function recordCaudalEvent(row) {
    try {
        const client = await getClient();
        await client.createEntity(row);
        return true;
    } catch (err) {
        if (err?.statusCode === 409) return false;
        warnThrottled(`no se pudo registrar el evento ${row?.kind} (${row?.reason}): ${err?.message}`);
        return false;
    }
}

/**
 * Reclama el aviso de umbral de esta ventana y clase: `true` sólo en la
 * instancia que efectivamente lo anota. Con storage caído cae a un candado en
 * memoria para no repetir el aviso en cada pedido.
 */
export async function claimThresholdEvent(row) {
    const localKey = `${row.partitionKey}:${row.rowKey}`;
    if (localClaims.has(localKey)) return false;
    try {
        const client = await getClient();
        await client.createEntity(row);
        localClaims.add(localKey);
        return true;
    } catch (err) {
        if (err?.statusCode === 409) {
            localClaims.add(localKey);
            return false;
        }
        warnThrottled(`no se pudo reclamar el umbral: ${err?.message}`);
        localClaims.add(localKey);
        return true; // sin storage, al menos avisar una vez por instancia
    }
}

/**
 * Lee el registro de un día. Devuelve lo más reciente primero: es el orden en
 * que se lee una noche.
 */
export async function listCaudalEvents({ date, kind, limit = 100 } = {}) {
    const partitionKey = dayPartitionOf(date ? `${String(date).slice(0, 10)}T00:00:00.000Z` : undefined);
    const max = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const client = await getClient();
    const events = [];
    for await (const entity of client.listEntities({
        queryOptions: { filter: `PartitionKey eq '${partitionKey}'` },
    })) {
        if (kind && entity.kind !== kind) continue;
        events.push(entity);
    }
    events.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return events.slice(0, max);
}

export function _resetCaudalEventsForTests() {
    tableReady = null;
    lastWarnAt = 0;
    localClaims.clear();
}
