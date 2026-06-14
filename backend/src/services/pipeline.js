/**
 * services/pipeline.js — Orquestador del pipeline de RAG
 * Procesa un material (buffer + metadata) y lo indexa en Pinecone.
 */
import { parseFile, chunkText, cleanText, extractTranscriptTimeline, extractPptxSlideTitles } from './parser.js';
import { generateEmbeddingsBatch, generateClassSummary, generateClassMap } from './ai.js';
import { upsertChunks, getIndexStats } from './vector-store.js';
import { saveJson, loadJson } from './storage.js';
import { upsertMaterialState } from './state-store.js';
import { trackIngestionInteraction } from './telemetry.js';
import { buildDependencyHeaders } from './correlation.js';
import { getMaterialPriority } from './material-classification.js';

const CONTAINER_PROCESSED = 'processed';
const CONTAINER_SUMMARIES = 'class-summaries';
const BATCH_SIZE = 20;

/**
 * Ejecuta el pipeline completo de procesamiento de un archivo con telemetría.
 */
export async function runPipeline({ fileBuffer, fileContentType, fileName, classIds, subjectId, materialType, materialId, userId, blobUrl, correlationId }, context) {
    const startTime = Date.now();
    let totalTokens = 0;
    const lectureDateIso = new Date().toISOString();
    const openAiHeaders = buildDependencyHeaders(correlationId);
    const mt = (materialType || '').toLowerCase();

    try {
        let extractedTimeline = null;
        if (mt === 'transcript') {
            extractedTimeline = extractTranscriptTimeline(fileBuffer, fileContentType, fileName);
            context.log(`[Pipeline] Timeline detectada: ${extractedTimeline.markers.length} hit-points, ${extractedTimeline.sections.length} secciones`);
        }

        // 1. Extraer texto según tipo de archivo
        context.log(`[Pipeline] Parseando archivo: ${fileName} (${fileContentType})`);
        const text = await parseFile(fileBuffer, fileContentType, fileName);
        context.log(`[Pipeline] Texto extraído: ${text.length} caracteres`);

        // 1b. Extraer títulos de diapositiva si es presentación (Story 2.161)
        let slideTitles = null;
        if (mt === 'presentation') {
            try {
                slideTitles = extractPptxSlideTitles(fileBuffer);
                context.log(`[Pipeline] Títulos extraídos: ${Object.keys(slideTitles || {}).length} diapositivas con título`);
            } catch (titleErr) {
                context.log.warn(`[Pipeline] No se pudieron extraer títulos (no bloqueante): ${titleErr.message}`);
            }
        }

        // 2. Dividir en chunks
        const chunks = chunkText(text, 512, 50);
        context.log(`[Pipeline] Chunks generados: ${chunks.length}`);

        if (chunks.length === 0) {
            throw new Error('No se pudo extraer texto significativo del archivo para generar chunks.');
        }

        // 3. Generar embeddings en batches y preparar vectores para Pinecone
        const vectors = [];
        let lastSlideNumber = null;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const currentBatch = chunks.slice(i, i + BATCH_SIZE);
            context.log(`[Pipeline] Vectorizando batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} (${currentBatch.length} chunks)...`);
            
            const { embeddings, usage } = await generateEmbeddingsBatch(currentBatch, { headers: openAiHeaders });
            totalTokens += (usage?.total_tokens || 0);

            embeddings.forEach((embedding, index) => {
                const chunkIndex = i + index;
                const metadata = {
                    subjectId,
                    classId: classIds?.[0] || null,
                    classIds,
                    materialId,
                    materialType,
                    materialPriority: getMaterialPriority(mt),
                    chunkIndex,
                    sourceFilename: fileName,
                    lectureDate: lectureDateIso,
                    text: currentBatch[index],
                };
                // Adjuntar título de diapositiva si está disponible (Story 2.161)
                const slideNumber = resolveSlideNumber(currentBatch[index]);
                if (slideNumber !== null) lastSlideNumber = slideNumber;
                const slideTitle = slideTitles?.[lastSlideNumber];
                if (slideTitle) {
                    metadata.slideTitle = slideTitle;
                }
                vectors.push({
                    id: `${materialId}-chunk-${chunkIndex}`,
                    values: embedding,
                    metadata,
                });
            });
        }

        // 4. Indexar en Pinecone
        const vectorIndexName = process.env.PINECONE_INDEX_NAME;
        context.log(`[Pipeline] Indexando ${vectors.length} vectores en Pinecone index: ${vectorIndexName}...`);
        await upsertChunks(vectors);
        context.log(`[Pipeline] Vectores indexados con éxito.`);

        // ── 4b. Log vector index health metrics (Issue #78) ──────────
        try {
            const stats = await getIndexStats();
            context.log(`[Pinecone Health] Index: ${vectorIndexName || 'n/a'} | totalVectorCount: ${stats.totalVectorCount} | indexFullness: ${(stats.indexFullness * 100).toFixed(2)}%`);
        } catch (statsErr) {
            context.log.warn(`[Pinecone Health] No se pudo obtener stats del índice: ${statsErr.message}`);
        }

        // 5. Generar resumen y mapa conceptual si es un tipo de material rico en texto
        if (mt === 'transcript' || mt === 'notes') {
            context.log(`[Pipeline] Generando activos IA (resumen y mapa) para material ${materialId}...`);
            try {
                // Ejecutamos en paralelo para optimizar tiempo
                const [summaryResult, mapResult] = await Promise.all([
                    generateClassSummary(text, '', { headers: openAiHeaders }),
                    generateClassMap(text, { headers: openAiHeaders })
                ]);

                totalTokens += (summaryResult.usage?.total_tokens || 0);
                totalTokens += (mapResult.usage?.total_tokens || 0);
                
                // Guardar activos para cada clase asociada
                for (const classId of classIds) {
                    // Guardar Resumen
                    await saveJson(CONTAINER_SUMMARIES, `${classId}.json`, {
                        classId,
                        subjectId,
                        summary: summaryResult.content,
                        generatedFrom: materialId,
                        generatedAt: summaryResult.generatedAt,
                        lastModifiedBy: 'AI'
                    });

                    // Guardar Mapa Conceptual (Nuevo en HU#61)
                    await saveJson('class-maps', `${classId}.json`, {
                        classId,
                        subjectId,
                        mapCode: mapResult.code,
                        generatedAt: mapResult.generatedAt
                    });
                }
                context.log(`[Pipeline] Activos IA guardados con éxito para clases: ${classIds.join(', ')}`);
            } catch (sumErr) {
                context.error(`[Pipeline] Error generando activos IA (no bloqueante):`, sumErr);
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
            uploadedAt: new Date(startTime).toISOString(),
            processedAt: new Date().toISOString(),
        };

        try {
            await upsertMaterialState(materialState);
        } catch (stateErr) {
            context.error(`[StateStore] No se pudo persistir estado ready para ${materialId}:`, stateErr);
        }

        await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, {
            ...materialState,
            extractedText: text,
            chunks: chunks.map(c => typeof c === 'string' ? { text: c } : c),
        });
        context.log(`[Pipeline] Estado guardado: processed/${materialId}.json (ready)`);

        if (mt === 'transcript' && extractedTimeline) {
            for (const classId of classIds) {
                const timelineBlob = `${classId}.json`;
                const existingTimeline = await loadJson('class-timelines', timelineBlob) || {
                    classId,
                    subjectId,
                    markers: [],
                    sections: [],
                };

                const sections = extractedTimeline.sections.map(section => ({
                    ...section,
                    id: `${materialId}-${section.id}`,
                    materialId,
                    sourceFilename: fileName,
                }));

                const markers = extractedTimeline.markers.map(marker => ({
                    ...marker,
                    id: `${materialId}-${marker.id}`,
                    sectionId: `${materialId}-${marker.sectionId}`,
                    materialId,
                    sourceFilename: fileName,
                }));

                const mergedSections = [...(existingTimeline.sections || []).filter(s => s.materialId !== materialId), ...sections];
                const mergedMarkers = [...(existingTimeline.markers || []).filter(m => m.materialId !== materialId), ...markers];

                await saveJson('class-timelines', timelineBlob, {
                    classId,
                    subjectId,
                    sections: mergedSections,
                    markers: mergedMarkers,
                    updatedAt: new Date().toISOString(),
                    updatedBy: 'pipeline',
                });
            }
        }

        // ── 7. Emitir telemetría de éxito (Issue #69) ──────────────
        trackIngestionInteraction({
            userId,
            materialId,
            fileName,
            materialType,
            totalTokens,
            durationMs: Date.now() - startTime,
            status: 'success'
        }).catch(e => context.error('[Telemetry] Error logging IngestionInteraction success:', e));

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
            errorMessage: err.message,
            error: err.message,
            stack: err.stack,
            uploadedAt: new Date(startTime).toISOString(),
            processedAt: new Date().toISOString(),
        };

        // Emitir telemetría de error
        trackIngestionInteraction({
            userId,
            materialId,
            fileName,
            materialType,
            totalTokens,
            durationMs: Date.now() - startTime,
            status: 'error'
        }).catch(e => context.error('[Telemetry] Error logging IngestionInteraction failure:', e));

        try {
            await upsertMaterialState(errorState);
        } catch (stateErr) {
            context.error(`[StateStore] No se pudo persistir estado error para ${materialId}:`, stateErr);
        }

        try {
            await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, errorState);
            context.log(`[Pipeline] Estado de error persistido para ${materialId}`);
        } catch (saveErr) {
            context.error('[Pipeline] No se pudo guardar el estado de error:', saveErr);
        }
    }
}

/**
 * Extrae el número de diapositiva del marcador [Diapositiva N] en un chunk.
 * @param {string} chunkText
 * @returns {number|null}
 */
function resolveSlideNumber(chunkText) {
    if (!chunkText) return null;
    const match = chunkText.match(/\[Diapositiva (\d+)\]/);
    if (!match) return null;
    return Number(match[1]);
}
