/**
 * services/vector-store.js — Adaptador de Pinecone
 * API publica usada por el motor RAG: upsert/query/stats.
 */
import { CategorizedError, ErrorCategory } from './error-categories.js';
import { trackVectorSearchDependency } from './telemetry.js';

const BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 15000;

function getIndexName() {
    return process.env.PINECONE_INDEX_NAME || 'dashboard-edu-pilot';
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
    return String(process.env.PINECONE_API_KEY || '').trim();
}

function assertConfiguration() {
    const apiKey = getApiKey();
    const host = getHost();
    const indexName = getIndexName();

    if (!apiKey) {
        console.error('[VectorStore] PINECONE_API_KEY is missing.');
        throw new Error('Configuracion incompleta: PINECONE_API_KEY es requerida.');
    }

    if (!host) {
        console.error('[VectorStore] PINECONE_HOST is missing. Check your environment variables.');
        throw new Error('Configuracion incompleta: PINECONE_HOST (o PINECONE_ENVIRONMENT) es requerida.');
    }

    if (!indexName) {
        throw new Error('Configuracion incompleta: PINECONE_INDEX_NAME es requerida.');
    }

    console.log(`[VectorStore] Configured with host: ${host}, index: ${indexName}`);
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

async function pineconeRequest(path, payload = {}) {
    const { apiKey, host } = assertConfiguration();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(`${host}${path}`, {
            method: 'POST',
            headers: {
                'Api-Key': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        const text = await response.text();
        const body = parseJsonSafely(text);

        if (!response.ok) {
            const message = body?.message || body?.error || `Pinecone request failed: ${response.status}`;
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
        await pineconeRequest('/vectors/upsert', payload);
        console.log(`[VectorStore] Upserted batch. Index stats expected to update soon.`);
    }
}

export async function querySimilar(embedding, filter, topK = 5) {
    return querySimilarWithTelemetry(embedding, filter, topK);
}

export async function querySimilarWithTelemetry(embedding, filter, topK = 5, deps = {}) {
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

        const response = await pineconeRequest('/query', payload);
        const matches = Array.isArray(response?.matches)
            ? response.matches.map((match) => ({
                id: match?.id,
                score: Number(match?.score || 0),
                metadata: normalizeMetadata(match?.metadata),
            }))
            : [];

        await dependencyTracker({
            provider,
            index: indexName,
            indexName,
            target,
            operation: 'vector.search',
            durationMs: Date.now() - startedAt,
            success: true,
            resultCode: 200,
        });

        return matches;
    } catch (err) {
        await dependencyTracker({
            provider,
            index: indexName,
            indexName,
            target,
            operation: 'vector.search',
            durationMs: Date.now() - startedAt,
            success: false,
            resultCode: err?.status || err?.code || 500,
        });

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

export async function getIndexStats() {
    const stats = await pineconeRequest('/describe_index_stats', {});
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
    return await pineconeRequest('/vectors/delete', payload);
}
