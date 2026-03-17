/**
 * services/pipeline.js — Orquestador del pipeline de RAG
 * Procesa un material (buffer + metadata) y lo indexa en Pinecone.
 */
import { parseFile, chunkText, cleanText } from './parser.js';
import { generateEmbeddingsBatch, generateClassSummary } from './openai.js';
import { upsertChunks } from './pinecone.js';
import { saveJson } from './storage.js';

const CONTAINER_PROCESSED = 'processed';
const CONTAINER_SUMMARIES = 'class-summaries';
const BATCH_SIZE = 20;

/**
 * Ejecuta el pipeline completo de procesamiento de un archivo.
 * ... (existing jsdocs)
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

        if (chunks.length === 0) {
            throw new Error('No se pudo extraer texto significativo del archivo para generar chunks.');
        }

        // 3. Generar embeddings en batches y preparar vectores para Pinecone
        const vectors = [];
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const currentBatch = chunks.slice(i, i + BATCH_SIZE);
            context.log(`[Pipeline] Vectorizando batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} (${currentBatch.length} chunks)...`);
            
            const embeddings = await generateEmbeddingsBatch(currentBatch);
            
            embeddings.forEach((embedding, index) => {
                const chunkIndex = i + index;
                vectors.push({
                    id: `${materialId}-chunk-${chunkIndex}`,
                    values: embedding,
                    metadata: {
                        subjectId,
                        classIds,
                        materialId,
                        materialType,
                        chunkIndex,
                        sourceFilename: fileName,
                        lectureDate: new Date().toISOString(),
                        text: currentBatch[index],
                    },
                });
            });
        }

        // 4. Indexar en Pinecone
        context.log(`[Pipeline] Indexando ${vectors.length} vectores en Pinecone index: ${process.env.PINECONE_INDEX_NAME}...`);
        await upsertChunks(vectors);
        context.log(`[Pipeline] Vectores indexados con éxito.`);

        // 5. Generar resumen si es un tipo de material rico en texto
        if (materialType === 'transcript' || materialType === 'notes') {
            context.log(`[Pipeline] Generando resumen IA para material ${materialId}...`);
            try {
                const summary = await generateClassSummary(text);
                
                // Guardar el resumen para cada clase asociada
                for (const classId of classIds) {
                    await saveJson(CONTAINER_SUMMARIES, `${classId}.json`, {
                        classId,
                        subjectId,
                        summary,
                        generatedFrom: materialId,
                        generatedAt: new Date().toISOString(),
                        lastModifiedBy: 'AI'
                    });
                }
                context.log(`[Pipeline] Resúmenes guardados en ${CONTAINER_SUMMARIES}`);
            } catch (sumErr) {
                context.error(`[Pipeline] Error generando resumen (no bloqueante):`, sumErr);
            }
        }

        // 6. Guardar estado final: ready
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
