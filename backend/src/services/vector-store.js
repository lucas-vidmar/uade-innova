/**
 * services/vector-store.js — Adaptador de Pinecone
 * API publica usada por el motor RAG: upsert/query/stats.
 */
import { CategorizedError, ErrorCategory } from './error-categories.js';
import { trackVectorSearchDependency } from './telemetry.js';
import { recordVectorOperation } from './vector-metrics.js';
import { CONFIG } from '../config.js';

const BATCH_SIZE = CONFIG.vector.batchSize;
const REQUEST_TIMEOUT_MS = CONFIG.vector.requestTimeoutMs;
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const RETRY_MAX_DELAY_MS = 10000;
// Presupuesto total de tiempo para reintentos (~2.5x el timeout de una request).
const RETRY_TOTAL_BUDGET_MS = Math.round(2.5 * REQUEST_TIMEOUT_MS);

function getIndexName() {
    return CONFIG.vector.indexName;
}

function getNamespace() {
    const namespace = process.env.PINECONE_NAMESPACE;
    return namespace && namespace.trim() ? namespace.trim() : undefined;
}

function normalizeHost(rawHost) {
    const host = String(rawHost || '').trim().replace(/\/+$/, '');
    if (!host) return '';
    if (host.startsWith('http://') || host.startsWith('https://')) return host;
    return `https://${host}`;
}

function getHost() {
    const explicitHost = normalizeHost(process.env.PINECONE_HOST);
    if (explicitHost) return explicitHost;

    // Compatibilidad con configuraciones legacy de Pinecone.
    const environment = String(process.env.PINECONE_ENVIRONMENT || '').trim();
    if (!environment) return '';

    return `https://${getIndexName()}-${environment}.svc.pinecone.io`;
}

function getApiKey() {
    const key = String(process.env.PINECONE_API_KEY || '').trim();
    return key || '';
}

function assertConfiguration() {
    const apiKey = getApiKey();
    const host = getHost();
    const indexName = getIndexName();

    if (!apiKey) {
        throw new Error('Configuracion incompleta: PINECONE_API_KEY es requerida.');
    }

    if (!host) {
        throw new Error('Configuracion incompleta: PINECONE_HOST (o PINECONE_ENVIRONMENT) es requerida.');
    }

    try { new URL(host); } catch { throw new Error('Configuracion incompleta: PINECONE_HOST no es una URL valida.'); }

    if (!indexName) {
        throw new Error('Configuracion incompleta: PINECONE_INDEX_NAME es requerida.');
    }

    return { apiKey, host, indexName };
}

function parseJsonSafely(text) {
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

/**
 * Determina si un error debe reintentarse: errores de red (sin status),
 * rate-limit (429), conflictos/contention (408/409) o errores de servidor
 * (5xx) son transitorios. Los errores de validacion (resto de 4xx) no se
 * reintentan.
 */
export function isTransientError(err) {
    if (!err || typeof err !== 'object') return true;
    if (err?.code === 'PINECONE_TIMEOUT') return true;
    if (!err?.status) return true;
    return err.status === 408 || err.status === 409 || err.status === 429 || err.status >= 500;
}

/**
 * Adjunta metadatos de reintento a una copia del error (sin mutar el error
 * original del caller) preservando su prototipo.
 */
function attachRetryMetadata(err, retryAttempts) {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(err)), err);
    copy.retryAttempts = retryAttempts;
    copy.retried = true;
    return copy;
}

/**
 * Retry acotado con backoff exponencial + jitter para fallas transitorias.
 * El tiempo total de reintentos esta acotado por `totalBudgetMs` (por defecto
 * ~2.5x REQUEST_TIMEOUT_MS): se suma el tiempo acumulado de los intentos y se
 * deja de reintentar apenas se supera el presupuesto, de modo que la operacion
 * no exceda los timeouts del plan Consumption de Azure Functions.
 */
export async function withRetry(fn, {
    maxAttempts = RETRY_MAX_ATTEMPTS,
    baseMs = RETRY_BASE_MS,
    maxMs = RETRY_MAX_DELAY_MS,
    totalBudgetMs = RETRY_TOTAL_BUDGET_MS,
} = {}) {
    const attempts = Math.max(1, Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : RETRY_MAX_ATTEMPTS);
    const startedAt = Date.now();

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const transient = isTransientError(err);
            const elapsed = Date.now() - startedAt;
            const exhausted = !transient || attempt >= attempts || elapsed >= totalBudgetMs;
            if (exhausted) {
                if (attempt > 1) throw attachRetryMetadata(err, attempt - 1);
                throw err;
            }
            const delay = Math.min(
                baseMs * 2 ** (attempt - 1) + Math.random() * 200,
                maxMs,
                Math.max(0, totalBudgetMs - elapsed),
            );
            console.warn(`[VectorStore] Error transitorio (${err?.status || err?.code || 'network'}), reintentando (${attempt + 1}/${attempts}) en ${Math.round(delay)}ms`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

/**
 * Ejecuta un unico intento HTTP hacia Pinecone con timeout + abort.
 * Consolida en un solo helper la logica previa de POST (pineconeRequest)
 * y GET (pineconeGetRequest).
 */
async function performPineconeFetch(url, { apiKey, method = 'POST', payload, path }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const headers = { 'Api-Key': apiKey };
    const init = { method, headers, signal: controller.signal };
    if (method !== 'GET' && payload !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(payload);
    }

    try {
        const response = await fetch(url, init);
        const text = await response.text();
        const body = parseJsonSafely(text);

        if (!response.ok) {
            const message = body?.message || body?.error || `Pinecone ${method} request failed: ${response.status}`;
            const err = new Error(message);
            err.status = response.status;
            err.code = body?.code || `HTTP_${response.status}`;
            err.details = body;
            throw err;
        }

        return body;
    } catch (err) {
        if (err?.name === 'AbortError') {
            const timeoutErr = new Error(`Timeout consultando Pinecone en ${path}`);
            timeoutErr.status = 504;
            timeoutErr.code = 'PINECONE_TIMEOUT';
            throw timeoutErr;
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Helper HTTP compartido para Pinecone (POST/GET). Aplica retry acotado
 * solo para fallas transitorias (network / 429 / 5xx).
 */
async function rawPineconeRequest(path, { method = 'POST', payload, queryParams } = {}) {
    const { apiKey, host } = assertConfiguration();

    const url = new URL(`${host}${path}`);
    if (queryParams) {
        for (const [key, value] of Object.entries(queryParams)) {
            if (Array.isArray(value)) {
                for (const item of value) {
                    if (item !== undefined && item !== null && item !== '') {
                        url.searchParams.append(key, item);
                    }
                }
            } else if (value !== undefined && value !== null && value !== '') {
                url.searchParams.append(key, value);
            }
        }
    }

    return withRetry(() => performPineconeFetch(url.toString(), { apiKey, method, payload, path }));
}

function normalizeMetadata(rawMetadata = {}) {
    const metadata = rawMetadata && typeof rawMetadata === 'object' ? rawMetadata : {};
    const classIds = Array.isArray(metadata.classIds)
        ? metadata.classIds
        : metadata.classId
            ? [metadata.classId]
            : [];

    return {
        ...metadata,
        classIds,
    };
}

export async function upsertChunks(vectors) {
    if (!Array.isArray(vectors) || vectors.length === 0) return;

    const namespace = getNamespace();

    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
        const batch = vectors.slice(i, i + BATCH_SIZE).map((vector) => ({
            id: String(vector.id),
            values: Array.isArray(vector.values) ? vector.values : [],
            metadata: normalizeMetadata(vector.metadata),
        }));

        const payload = { vectors: batch };
        if (namespace) payload.namespace = namespace;

        console.log(`[VectorStore] Upserting batch of ${batch.length} vectors to index ${getIndexName()}...`);
        await rawPineconeRequest('/vectors/upsert', { method: 'POST', payload });
        console.log(`[VectorStore] Upserted batch. Index stats expected to update soon.`);
    }
}

export async function querySimilar(embedding, filter, topK = 5, deps = {}) {
    return querySimilarWithTelemetry(embedding, filter, topK, deps);
}

export async function querySimilarWithTelemetry(embedding, filter, topK = 5, deps = {}) {
    const { correlationId } = deps;
    const dependencyTracker = typeof deps.trackDependency === 'function'
        ? deps.trackDependency
        : trackVectorSearchDependency;

    const startedAt = Date.now();
    const provider = 'pinecone';
    const indexName = getIndexName();
    const target = getHost() || 'pinecone';
    const namespace = getNamespace();

    try {
        const payload = {
            vector: embedding,
            topK,
            includeMetadata: true,
            includeValues: false,
        };

        if (filter && typeof filter === 'object' && Object.keys(filter).length > 0) {
            payload.filter = filter;
        }

        if (namespace) payload.namespace = namespace;

        const response = await rawPineconeRequest('/query', { method: 'POST', payload });
        const matches = Array.isArray(response?.matches)
            ? response.matches.map((match) => ({
                id: match?.id,
                score: Number(match?.score || 0),
                metadata: normalizeMetadata(match?.metadata),
            }))
            : [];

        const elapsed = Date.now() - startedAt;

        await dependencyTracker({
            provider,
            index: indexName,
            indexName,
            target,
            operation: 'vector.search',
            durationMs: elapsed,
            success: true,
            resultCode: 200,
            correlationId,
        });

        recordVectorOperation(elapsed, true);
        return matches;
    } catch (err) {
        const elapsed = Date.now() - startedAt;

        await dependencyTracker({
            provider,
            index: indexName,
            indexName,
            target,
            operation: 'vector.search',
            durationMs: elapsed,
            success: false,
            resultCode: err?.status || err?.code || 500,
            correlationId,
        });

        recordVectorOperation(elapsed, false);
        console.error('[Pinecone] Error en querySimilar:', err);
        throw new CategorizedError(`Error consultando la base vectorial: ${err.message}`, {
            errorCategory: ErrorCategory.RETRIEVAL_FAILURE,
            code: err?.code || 'RETRIEVAL_QUERY_FAILED',
            status: Number.isInteger(err?.status) ? err.status : 500,
            details: err?.details || null,
            cause: err,
        });
    }
}

/**
 * Elimina todos los vectores asociados a un materialId.
 */
export async function deleteVectorsByMaterialId(materialId) {
    if (!materialId || typeof materialId !== 'string' || !materialId.trim()) {
        throw new Error('[VectorStore] deleteVectorsByMaterialId requiere un materialId valido');
    }
    return deleteVectorsByFilter({ materialId: { "$eq": materialId.trim() } });
}

export async function getIndexStats() {
    const stats = await rawPineconeRequest('/describe_index_stats', { method: 'POST', payload: {} });
    return {
        totalVectorCount: stats?.totalVectorCount ?? stats?.total_vector_count ?? 0,
        indexFullness: stats?.indexFullness ?? stats?.index_fullness ?? 0,
        namespaces: stats?.namespaces || {},
    };
}

/**
 * Elimina vectores del indice usando un filtro (ej: por subjectId o materialId)
 * @param {object} filter - Filtro de Pinecone (ej: { materialId: { "$eq": "..." } })
 */
export async function deleteVectorsByFilter(filter) {
    if (!filter || typeof filter !== 'object' || Object.keys(filter).length === 0) {
        throw new Error('[VectorStore] deleteVectorsByFilter requiere un filtro no vacio');
    }

    const namespace = getNamespace();
    const payload = { filter };
    if (namespace) payload.namespace = namespace;

    console.log(`[VectorStore] Deleting vectors with filter: ${JSON.stringify(filter)}`);
    return await rawPineconeRequest('/vectors/delete', { method: 'POST', payload });
}

/**
 * Invoca la telemetria de dependencia de forma aislada: si la telemetria
 * falla, nunca debe propagarse al flujo de negocio.
 */
async function trackDependencySafely(dependencyTracker, payload) {
    try {
        await dependencyTracker(payload);
    } catch (err) {
        console.warn(`[VectorStore] Fallo telemetria de dependencia (${payload.operation}):`, err.message);
    }
}

/**
 * Emite telemetria de dependencia (trackVectorSearchDependency) para las
 * operaciones de listado/fetch de vectores y categoriza los errores de
 * recuperacion transitorios como CategorizedError (RETRIEVAL_FAILURE).
 * Los errores no reintentables (4xx) se propagan sin cambios.
 */
async function withVectorTelemetry(deps, operation, fallbackCode, fn) {
    const dependencyTracker = typeof deps?.trackDependency === 'function'
        ? deps.trackDependency
        : trackVectorSearchDependency;

    const startedAt = Date.now();
    const provider = 'pinecone';
    const indexName = getIndexName();
    const target = getHost() || 'pinecone';

    try {
        const result = await fn();
        const elapsed = Date.now() - startedAt;

        await trackDependencySafely(dependencyTracker, {
            provider,
            index: indexName,
            indexName,
            target,
            operation,
            durationMs: elapsed,
            success: true,
            resultCode: 200,
            correlationId: deps?.correlationId,
        });

        return result;
    } catch (err) {
        const elapsed = Date.now() - startedAt;

        const properties = {};
        if (Number.isInteger(err?.retryAttempts)) properties.retryAttempts = err.retryAttempts;
        if (err?.retried) properties.retried = true;

        await trackDependencySafely(dependencyTracker, {
            provider,
            index: indexName,
            indexName,
            target,
            operation,
            durationMs: elapsed,
            success: false,
            resultCode: err?.status || err?.code || 500,
            correlationId: deps?.correlationId,
            properties: Object.keys(properties).length > 0 ? properties : undefined,
        });

        if (isTransientError(err)) {
            console.error(`[Pinecone] Error en ${operation}:`, err);
            const categorized = new CategorizedError(`Error consultando la base vectorial: ${err.message}`, {
                errorCategory: ErrorCategory.RETRIEVAL_FAILURE,
                code: err?.code || fallbackCode,
                status: Number.isInteger(err?.status) ? err.status : 500,
                details: err?.details || null,
                cause: err,
            });
            if (Number.isInteger(err?.retryAttempts)) categorized.retryAttempts = err.retryAttempts;
            if (err?.retried) categorized.retried = true;
            throw categorized;
        }

        throw err;
    }
}

/**
 * Lista IDs de vectores en el indice con paginacion.
 * @param {object} options
 * @param {number} [options.limit=100] - Max IDs per page
 * @param {string} [options.paginationToken] - Token for next page
 * @param {string} [options.prefix] - ID prefix filter
 * @param {string} [options.namespace] - Namespace override
 * @param {boolean} [options._skipTelemetry] - Uso interno: omitir la emision de
 *   telemetria. Lo setea listAllVectorIds para no duplicar eventos por pagina.
 * @param {object} [deps]
 * @param {Function} [deps.trackDependency] - Override para telemetria (testing)
 * @param {string} [deps.correlationId] - Correlation ID para telemetria
 * @returns {Promise<{vectorIds: string[], pagination: { next?: string }}>}
 */
export async function listVectorIds(options = {}, deps = {}) {
    const limit = options.limit != null ? Number(options.limit) : 100;

    // #452/UJ-56: la operación `list` de Pinecone es `GET /vectors/list` y sus
    // parámetros van en el query string (prefix, limit, paginationToken,
    // namespace) — nunca en el cuerpo JSON. Enviarla como POST con body hizo que
    // el índice real del piloto contestara una página vacía mientras declaraba
    // 478 vectores: el escaneo enumeraba 0 y toda superficie construida encima
    // (vector-index, cuarentena, reindexado de material) leía "la unidad no
    // tiene nada indexado" sin error. Referencia: docs.pinecone.io list-vectors.
    const queryParams = { limit };

    if (options.paginationToken) queryParams.paginationToken = options.paginationToken;
    if (options.prefix) queryParams.prefix = options.prefix;

    const namespace = options.namespace || getNamespace();
    if (namespace) queryParams.namespace = namespace;

    console.log(`[VectorStore] Listing vector IDs (limit=${limit}, prefix=${options.prefix || 'none'})...`);

    const run = async () => {
        const response = await rawPineconeRequest('/vectors/list', { method: 'GET', queryParams });

        const vectorIds = Array.isArray(response?.vectors)
            ? response.vectors.map(v => v?.id).filter(Boolean)
            : [];

        return {
            vectorIds,
            pagination: response?.pagination || {},
        };
    };

    if (options._skipTelemetry) return run();
    return withVectorTelemetry(deps, 'vector.list', 'RETRIEVAL_LIST_FAILED', run);
}

/**
 * Obtiene vectores completos (id, values, metadata) por sus IDs.
 * @param {string[]} ids - Array of vector IDs to fetch
 * @param {object} [options]
 * @param {string} [options.namespace] - Namespace override
 * @param {object} [deps]
 * @param {Function} [deps.trackDependency] - Override para telemetria (testing)
 * @param {string} [deps.correlationId] - Correlation ID para telemetria
 * @returns {Promise<{vectors: Array<{id: string, values: number[], metadata: object}>, missingIds: string[]}>}
 */
export async function fetchVectorsByIds(ids, options = {}, deps = {}) {
    if (!Array.isArray(ids) || ids.length === 0) return { vectors: [], missingIds: [] };

    const validIds = ids.filter(id => typeof id === 'string' && id.trim());
    if (validIds.length === 0) return { vectors: [], missingIds: [] };

    if (validIds.length > 1000) {
        throw new Error(`[VectorStore] fetchVectorsByIds max 1000 IDs per call, received ${validIds.length}`);
    }

    const namespace = options.namespace || getNamespace();
    const queryParams = { ids: validIds.map(String) };
    if (namespace) queryParams.namespace = namespace;

    console.log(`[VectorStore] Fetching ${validIds.length} vectors by ID...`);

    return withVectorTelemetry(deps, 'vector.fetch', 'RETRIEVAL_FETCH_FAILED', async () => {
        const response = await rawPineconeRequest('/vectors/fetch', { method: 'GET', queryParams });

        const vectorsObj = response?.vectors || {};
        const vectors = Object.entries(vectorsObj).map(([id, data]) => ({
            id: id || data?.id,
            values: data?.values || [],
            metadata: normalizeMetadata(data?.metadata),
        }));

        const foundIds = new Set(Object.keys(vectorsObj).map(id => String(id)));
        const missingIds = validIds.map(String).filter(id => !foundIds.has(id));

        return { vectors, missingIds };
    });
}

/**
 * Lista TODOS los IDs de vectores iterando sobre la paginacion.
 * @param {object} [options]
 * @param {string} [options.prefix] - ID prefix filter
 * @param {string} [options.namespace] - Namespace override
 * @param {object} [deps]
 * @param {Function} [deps.trackDependency] - Override para telemetria (testing)
 * @param {string} [deps.correlationId] - Correlation ID para telemetria
 * @returns {Promise<string[]>}
 */
export async function listAllVectorIds(options = {}, deps = {}) {
    return withVectorTelemetry(deps, 'vector.listAll', 'RETRIEVAL_LIST_ALL_FAILED', async () => {
        const MAX_PAGES = 1000;
        const allIds = [];
        let paginationToken;
        let pageCount = 0;

        do {
            const result = await listVectorIds({
                ...options,
                paginationToken,
                limit: 100,
                _skipTelemetry: true,
            });

            allIds.push(...result.vectorIds);
            paginationToken = result.pagination?.next;
            pageCount += 1;

            console.log(`[VectorStore] Listed ${allIds.length} IDs so far...`);

            if (pageCount >= MAX_PAGES) {
                console.warn(`[VectorStore] Reached max pages (${MAX_PAGES}). Stopping pagination.`);
                break;
            }
        } while (paginationToken);

        console.log(`[VectorStore] Listed ${allIds.length} total vector IDs`);
        return allIds;
    });
}

/**
 * Reasigna metadatos de los vectores de un material sin recalcular embeddings.
 *
 * UJ-08 / #389: reubicar un material (agregarle o quitarle un encuentro) tiene
 * que alcanzar al índice. Si sólo se actualiza el estado del material, los
 * vectores conservan la clase vieja: la búsqueda del encuentro de origen sigue
 * citando material que ya no le corresponde y el encuentro de destino no lo
 * encuentra nunca.
 *
 * Se reescriben los metadatos sobre los mismos vectores (mismos `values`), así
 * que no se paga una corrida nueva de embeddings ni cambia el ordenamiento.
 *
 * @param {string} materialId
 * @param {object} patch - Metadatos a reescribir: `classIds` (arreglo) y/o `materialType`
 * @param {object} [deps] - Override de telemetria para testing
 * @returns {Promise<{updated: number, missing: number}>}
 */
export async function updateMaterialVectorsMetadata(materialId, patch = {}, deps = {}) {
    if (!materialId || typeof materialId !== 'string' || !materialId.trim()) {
        throw new Error('[VectorStore] updateMaterialVectorsMetadata requiere un materialId valido');
    }

    const classIds = Array.isArray(patch.classIds) ? patch.classIds.filter(Boolean) : null;
    const metadataPatch = {};
    if (classIds) {
        metadataPatch.classId = classIds[0] || '';
        metadataPatch.classIds = [...classIds];
    }
    if (typeof patch.materialType === 'string' && patch.materialType) {
        metadataPatch.materialType = patch.materialType;
    }
    if (Object.keys(metadataPatch).length === 0) return { updated: 0, missing: 0 };

    const ids = await listAllVectorIds({ prefix: `${materialId}-chunk-` }, deps);
    if (ids.length === 0) return { updated: 0, missing: 0 };

    const FETCH_BATCH_SIZE = 500;
    const updates = [];
    let missing = 0;

    for (let i = 0; i < ids.length; i += FETCH_BATCH_SIZE) {
        const batch = ids.slice(i, i + FETCH_BATCH_SIZE);
        const { vectors, missingIds } = await fetchVectorsByIds(batch, {}, deps);
        missing += (missingIds || []).length;

        for (const vector of vectors) {
            if (!Array.isArray(vector.values) || vector.values.length === 0) {
                // Sin valores no se puede re-upsertear: se cuenta como faltante en
                // lugar de mandar un upsert que Pinecone va a rechazar.
                missing += 1;
                continue;
            }
            updates.push({
                id: vector.id,
                values: vector.values,
                metadata: { ...vector.metadata, ...metadataPatch },
            });
        }
    }

    if (updates.length === 0) {
        console.warn(`[VectorStore] Sin vectores reutilizables para reindexar metadatos de ${materialId}`);
        return { updated: 0, missing };
    }

    await upsertChunks(updates);
    console.log(`[VectorStore] Metadatos reindexados para ${materialId}: ${updates.length} vectores (${missing} faltantes)`);

    return { updated: updates.length, missing };
}
