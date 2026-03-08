/**
 * services/pinecone.js — Cliente Pinecone
 * Gestiona el índice vectorial para el motor RAG.
 */
import { Pinecone } from '@pinecone-database/pinecone';

let _index = null;

function getIndex() {
    if (!_index) {
        const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        _index = pc.index(process.env.PINECONE_INDEX_NAME);
    }
    return _index;
}

/**
 * Inserta chunks vectorizados en Pinecone con metadatos.
 * @param {Array<{id: string, values: number[], metadata: object}>} vectors
 * @returns {Promise<void>}
 */
export async function upsertChunks(vectors) {
    const index = getIndex();
    // Pinecone acepta hasta 100 vectores por batch
    const BATCH_SIZE = 100;
    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
        const batch = vectors.slice(i, i + BATCH_SIZE);
        await index.upsert(batch);
    }
}

/**
 * Busca chunks similares a un embedding con filtro de metadatos.
 * @param {number[]} embedding - vector de la pregunta
 * @param {object} filter - filtro Pinecone (ej: { classId: { $in: [...] } })
 * @param {number} topK - cantidad de resultados
 * @returns {Promise<Array<{id: string, score: number, metadata: object}>>}
 */
export async function querySimilar(embedding, filter, topK = 5) {
    const index = getIndex();
    const response = await index.query({
        vector: embedding,
        filter,
        topK,
        includeMetadata: true,
    });
    return response.matches || [];
}
