/**
 * services/pipeline.js — Orquestador del pipeline de RAG
 * Procesa un material (buffer + metadata) y lo indexa en Pinecone.
 */
import { parseFile, chunkText } from './parser.js';
import { generateEmbedding } from './openai.js';
import { upsertChunks } from './pinecone.js';
import { saveJson } from './storage.js';

const CONTAINER_PROCESSED = 'processed';

/**
 * Ejecuta el pipeline completo de procesamiento de un archivo.
 * @param {object} params
 * @param {Buffer} params.fileBuffer - binario del archivo
 * @param {string} params.fileContentType - MIME type
 * @param {string} params.fileName - nombre original
 * @param {string[]} params.classIds - IDs de las clases asociadas
 * @param {string} params.subjectId - ID de la materia
 * @param {string} params.materialType - tipo (transcript, presentation, etc.)
 * @param {string} params.materialId - UUID del material
 * @param {string} params.blobUrl - URL pública o local del archivo
 * @param {import('@azure/functions').InvocationContext} context - contexto de la función Azure
 */
export async function runPipeline({ fileBuffer, fileContentType, fileName, classIds, subjectId, materialType, materialId, blobUrl }, context) {
    try {
        // 1. Extraer texto según tipo de archivo
        context.log(`[Pipeline] Parseando archivo: ${fileName} (${fileContentType})`);
        const text = await parseFile(fileBuffer, fileContentType, fileName);
        context.log(`[Pipeline] Texto extraído: ${text.length} caracteres`);

        // 2. Dividir en chunks
        const chunks = chunkText(text, 512, 50);
        context.log(`[Pipeline] Chunks generados: ${chunks.length}`);

        // 3. Generar embeddings y preparar vectores para Pinecone
        const vectors = [];
        for (let i = 0; i < chunks.length; i++) {
            const embedding = await generateEmbedding(chunks[i]);
            vectors.push({
                id: `${materialId}-chunk-${i}`,
                values: embedding,
                metadata: {
                    subjectId,
                    classIds,
                    materialId,
                    materialType,
                    chunkIndex: i,
                    sourceFilename: fileName,
                    lectureDate: new Date().toISOString(),
                    text: chunks[i],
                },
            });
        }

        // 4. Upsert en Pinecone
        context.log(`[Pipeline] Indexando ${vectors.length} vectores en Pinecone index: ${process.env.PINECONE_INDEX_NAME}...`);
        await upsertChunks(vectors);
        context.log(`[Pipeline] Vectores indexados con éxito.`);

        // 5. Guardar estado final: ready
        const materialState = {
            materialId,
            classIds,
            subjectId,
            type: materialType,
            filename: fileName,
            status: 'ready',
            blobUrl,
            chunkCount: chunks.length,
            processedAt: new Date().toISOString(),
        };
        await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, materialState);
        context.log(`[Pipeline] Estado guardado: processed/${materialId}.json (ready)`);

    } catch (err) {
        context.error(`[Pipeline] Error crítico para material ${materialId}:`, err);
        
        // Guardar estado: error
        const errorState = {
            materialId,
            classIds,
            subjectId,
            type: materialType,
            filename: fileName,
            status: 'error',
            blobUrl,
            error: err.message,
            processedAt: new Date().toISOString(),
        };
        try {
            await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, errorState);
            context.log(`[Pipeline] Estado de error persistido para ${materialId}`);
        } catch (saveErr) {
            context.error('[Pipeline] No se pudo guardar el estado de error:', saveErr);
        }
    }
}
