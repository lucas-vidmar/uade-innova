/**
 * services/vector-store.js — Adaptador de Azure AI Search
 * API publica usada por el motor RAG: upsert/query/stats.
 */
import {
    AzureKeyCredential,
    SearchClient,
    SearchIndexClient,
} from '@azure/search-documents';
import { DefaultAzureCredential } from '@azure/identity';

const VECTOR_DIMENSIONS = Number.parseInt(process.env.AZURE_SEARCH_VECTOR_DIMENSIONS || '1536', 10);
const BATCH_SIZE = 100;

let _searchClient = null;
let _indexClient = null;
let _indexReadyPromise = null;

function getSearchEndpoint() {
    return process.env.AZURE_SEARCH_ENDPOINT || '';
}

function getIndexName() {
    return process.env.AZURE_SEARCH_INDEX_NAME || 'dashboard-edu-pilot';
}

function getCredential() {
    const apiKey = process.env.AZURE_SEARCH_API_KEY;
    if (apiKey) {
        console.log('[Azure Search] Authenticated using API key');
        return new AzureKeyCredential(apiKey);
    }

    console.log('[Azure Search] Authenticated using DefaultAzureCredential');
    return new DefaultAzureCredential();
}

async function ensureClients() {
    const endpoint = getSearchEndpoint();
    const indexName = getIndexName();

    if (!endpoint || !indexName) {
        throw new Error('Configuracion incompleta: AZURE_SEARCH_ENDPOINT y AZURE_SEARCH_INDEX_NAME son requeridas.');
    }

    if (!_searchClient || !_indexClient) {
        const credential = getCredential();
        _indexClient = new SearchIndexClient(endpoint, credential);
        _searchClient = new SearchClient(endpoint, indexName, credential);
    }

    if (!_indexReadyPromise) {
        _indexReadyPromise = ensureIndexExists(indexName);
    }

    await _indexReadyPromise;
    return { searchClient: _searchClient, indexClient: _indexClient, indexName };
}

async function ensureIndexExists(indexName) {
    const existingIndexes = [];
    for await (const idx of _indexClient.listIndexes()) {
        existingIndexes.push(idx.name);
    }

    if (existingIndexes.includes(indexName)) {
        return;
    }

    const indexDefinition = {
        name: indexName,
        fields: [
            { name: 'id', type: 'Edm.String', key: true, filterable: true },
            { name: 'subjectId', type: 'Edm.String', filterable: true },
            { name: 'classIds', type: 'Collection(Edm.String)', filterable: true },
            { name: 'materialId', type: 'Edm.String', filterable: true },
            { name: 'materialType', type: 'Edm.String', filterable: true },
            { name: 'chunkIndex', type: 'Edm.Int32', filterable: true, sortable: true },
            { name: 'sourceFilename', type: 'Edm.String', filterable: true, searchable: true },
            { name: 'lectureDate', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
            { name: 'text', type: 'Edm.String', searchable: true },
            {
                name: 'contentVector',
                type: 'Collection(Edm.Single)',
                searchable: true,
                vectorSearchDimensions: VECTOR_DIMENSIONS,
                vectorSearchProfileName: 'default-vector-profile',
            },
        ],
        vectorSearch: {
            algorithms: [
                {
                    name: 'default-hnsw',
                    kind: 'hnsw',
                    hnswParameters: { metric: 'cosine' },
                },
            ],
            profiles: [
                {
                    name: 'default-vector-profile',
                    algorithmConfigurationName: 'default-hnsw',
                },
            ],
        },
    };

    await _indexClient.createOrUpdateIndex(indexDefinition);
    console.log(`[Azure Search] Index creado: ${indexName}`);
}

function escapeFilterValue(value) {
    return String(value || '').replace(/'/g, "''");
}

function buildFilter(filter) {
    if (!filter || typeof filter !== 'object') return undefined;

    const andParts = [];

    for (const [field, condition] of Object.entries(filter)) {
        if (field === '$or') continue;
        andParts.push(parseCondition(field, condition));
    }

    if (Array.isArray(filter.$or) && filter.$or.length > 0) {
        const orParts = filter.$or
            .map(entry => {
                const [field, condition] = Object.entries(entry || {})[0] || [];
                return field ? parseCondition(field, condition) : '';
            })
            .filter(Boolean);

        if (orParts.length > 0) {
            andParts.push(`(${orParts.join(' or ')})`);
        }
    }

    return andParts.length > 0 ? andParts.join(' and ') : undefined;
}

function parseCondition(field, condition) {
    if (!condition || typeof condition !== 'object') {
        throw new Error(`Filtro no soportado para campo ${field}`);
    }

    if ('$eq' in condition) {
        return `${field} eq '${escapeFilterValue(condition.$eq)}'`;
    }

    if ('$in' in condition) {
        const values = Array.isArray(condition.$in) ? condition.$in : [];
        if (values.length === 0) return '';

        if (field === 'classIds') {
            return `classIds/any(c: ${values.map(v => `c eq '${escapeFilterValue(v)}'`).join(' or ')})`;
        }

        return `(${values.map(v => `${field} eq '${escapeFilterValue(v)}'`).join(' or ')})`;
    }

    throw new Error(`Operador no soportado en filtro para ${field}`);
}

export async function upsertChunks(vectors) {
    const { searchClient } = await ensureClients();
    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
        const batch = vectors.slice(i, i + BATCH_SIZE).map(vector => ({
            id: vector.id,
            subjectId: vector.metadata?.subjectId,
            classIds: vector.metadata?.classIds || [],
            materialId: vector.metadata?.materialId,
            materialType: vector.metadata?.materialType,
            chunkIndex: vector.metadata?.chunkIndex,
            sourceFilename: vector.metadata?.sourceFilename,
            lectureDate: vector.metadata?.lectureDate,
            text: vector.metadata?.text,
            contentVector: vector.values,
        }));

        const result = await searchClient.mergeOrUploadDocuments(batch);
        const failed = result.results?.filter(r => !r.succeeded) || [];
        if (failed.length > 0) {
            const firstError = failed[0]?.errorMessage || 'Error desconocido en indexacion';
            throw new Error(firstError);
        }
    }
}

export async function querySimilar(embedding, filter, topK = 5) {
    try {
        const { searchClient } = await ensureClients();
        const filterExpression = buildFilter(filter);

        const response = await searchClient.search('*', {
            top: topK,
            filter: filterExpression,
            select: [
                'id',
                'subjectId',
                'classIds',
                'materialId',
                'materialType',
                'chunkIndex',
                'sourceFilename',
                'lectureDate',
                'text',
            ],
            vectorSearchOptions: {
                queries: [
                    {
                        kind: 'vector',
                        vector: embedding,
                        fields: ['contentVector'],
                        kNearestNeighborsCount: topK,
                    },
                ],
            },
        });

        const matches = [];
        for await (const item of response.results) {
            const doc = item.document || {};
            matches.push({
                id: doc.id,
                score: item.score ?? item['@search.score'] ?? 0,
                metadata: {
                    subjectId: doc.subjectId,
                    classIds: doc.classIds || [],
                    materialId: doc.materialId,
                    materialType: doc.materialType,
                    chunkIndex: doc.chunkIndex,
                    sourceFilename: doc.sourceFilename,
                    lectureDate: doc.lectureDate,
                    text: doc.text,
                },
            });
        }

        return matches;
    } catch (err) {
        console.error('[Azure Search] Error en querySimilar:', err);
        throw new Error(`Error consultando la base vectorial: ${err.message}`);
    }
}

export async function getIndexStats() {
    const { indexClient, indexName } = await ensureClients();
    const stats = await indexClient.getIndexStatistics(indexName);
    return {
        totalVectorCount: stats.documentCount ?? 0,
        indexFullness: 0,
        namespaces: {},
    };
}
