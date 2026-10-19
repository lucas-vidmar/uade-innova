/**
 * services/pipeline.js — Orquestador del pipeline de RAG
 * Procesa un material (buffer + metadata) y lo indexa en Pinecone.
 */
import { parseFile, chunkText, cleanText, extractTranscriptTimeline, extractPptxSlideTitles } from './parser.js';
import { generateEmbeddingsBatch, generateClassSummary, generateClassMap, generatePodcastScript } from './ai.js';
import { upsertChunks, getIndexStats, deleteVectorsByFilter } from './vector-store.js';
import { saveJson, loadJson } from './storage.js';
import { upsertMaterialState, materialStateExists } from './state-store.js';
import { trackIngestionInteraction } from './telemetry.js';
import { buildDependencyHeaders } from './correlation.js';
import { getMaterialPriority } from './material-classification.js';
import { detectGlossaryErrors } from './transcription-corrector.js';
import { ErrorCategory, CategorizedError } from './error-categories.js';
import { CONFIG } from './config.js';

const CONTAINER_PROCESSED = 'processed';
const CONTAINER_SUMMARIES = 'class-summaries';
const CONTAINER_CLASSES = CONFIG.containers.classes;

// Tests can override this function for deterministic token counting
export let _estimateTokenCount = (text) => Math.ceil(text.length / 4);
const BATCH_SIZE = 100;

/**
 * Ejecuta el pipeline completo de procesamiento de un archivo con telemetría.
 */
export async function runPipeline({ fileBuffer, fileContentType, fileName, classIds, subjectId, materialType, materialId, materialPriority, userId, blobUrl, correlationId, traceContext }, context) {
    const startTime = Date.now();
    let totalTokens = 0;
    const lectureDateIso = new Date().toISOString();
    const openAiHeaders = buildDependencyHeaders(correlationId, traceContext);
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

        // 1a. Pre-flight token check (Story 10.9)
        const maxTokens = Number.isFinite(Number(process.env.MAX_MATERIAL_TOKENS))
            ? Number(process.env.MAX_MATERIAL_TOKENS)
            : 500000;
        const estimatedTokens = _estimateTokenCount(text);
        if (estimatedTokens > maxTokens) {
            context.log(`[WARN][Pipeline] Material rejected: too large`, {
                materialId,
                textLength: text.length,
                tokenEstimate: estimatedTokens,
                maxTokens
            });
            throw new CategorizedError('Material demasiado grande. Dividilo en partes.', {
                errorCategory: ErrorCategory.VALIDATION,
                code: 'MATERIAL_TOO_LARGE',
                status: 413,
            });
        }

        // 1b. Extraer títulos de diapositiva si es presentación (Story 2.161)
        let slideTitles = null;
        if (mt === 'presentation') {
            try {
                slideTitles = extractPptxSlideTitles(fileBuffer);
                context.log(`[Pipeline] Títulos extraídos: ${Object.keys(slideTitles || {}).length} diapositivas con título`);
            } catch (titleErr) {
                context.log(`[WARN][Pipeline] No se pudieron extraer títulos (no bloqueante): ${titleErr.message}`);
            }
        }

        // 1c. Detectar errores de glosario en transcripciones (Story 2.186)
        if (mt === 'transcript') {
            try {
                const suggestions = await detectGlossaryErrors(subjectId, text, materialId, classIds?.[0], context);
                if (suggestions.length > 0) {
                    context.log(`[Pipeline] Glosario: ${suggestions.length} error(es) detectado(s) en transcripción ${materialId}`);
                }
            } catch (glossaryErr) {
                context.log(`[WARN][Pipeline] Detección de glosario falló (no bloqueante): ${glossaryErr.message}`);
            }
        }

        // 2. Dividir en chunks
        const chunks = chunkText(text, 512, 50);
        context.log(`[Pipeline] Chunks generados: ${chunks.length}`);

        if (chunks.length === 0) {
            throw new Error('No se pudo extraer texto significativo del archivo para generar chunks.');
        }

        // 2a. Cargar topics de las clases vinculadas (11-4-8) para enriquecer metadatos RAG
        const classTopics = new Map();
        try {
            for (const classId of classIds || []) {
                const classes = await loadJson(CONTAINER_CLASSES, `${subjectId}.json`);
                const classData = (Array.isArray(classes) ? classes : []).find(c => String(c.id) === String(classId));
                if (classData && Array.isArray(classData.topics) && classData.topics.length > 0) {
                    classTopics.set(String(classId), classData.topics.filter(Boolean).slice(0, 20));
                }
            }
        } catch (topicsErr) {
            context.log(`[WARN][Pipeline] No se pudieron cargar topics (no bloqueante): ${topicsErr.message}`);
        }

        // 3. Generar embeddings en batches y preparar vectores para Pinecone
        const vectors = [];
        let lastSlideNumber = null;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const currentBatch = chunks.slice(i, i + BATCH_SIZE);
            context.log(`[Pipeline] Vectorizando batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} (${currentBatch.length} chunks)...`);

            // Pausa entre batches para evitar rate limiting de Azure OpenAI S0
            if (i > 0) await new Promise(r => setTimeout(r, 5000));

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
                    materialPriority: getMaterialPriority(mt, materialPriority),
                    chunkIndex,
                    sourceFilename: fileName,
                    lectureDate: lectureDateIso,
                    text: currentBatch[index],
                    // Always-present field (Story 10.17 / Loopback 1): cada vector
                    // del pipeline nace con `quarantined: false` para que el filtro
                    // { quarantined: { $ne: true } } sea deterministico.
                    quarantined: false,
                };
                // 11-4-8: adjuntar topics de la clase principal para filtrado por tema
                if (classIds?.[0] && classTopics.has(String(classIds[0]))) {
                    metadata.topics = classTopics.get(String(classIds[0]));
                }
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
            context.log(`[WARN][Pinecone Health] No se pudo obtener stats del índice: ${statsErr.message}`);
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
                // #328: scoped paths ({subjectId}/{classId}.json) para que un
                // classId compartido entre materias no colisione.
                for (const classId of classIds) {
                    // Guardar Resumen
                    await saveJson(CONTAINER_SUMMARIES, `${subjectId}/${classId}.json`, {
                        classId,
                        subjectId,
                        summary: summaryResult.content,
                        generatedFrom: materialId,
                        generatedAt: summaryResult.generatedAt,
                        lastModifiedBy: 'AI'
                    });

                    // Guardar Mapa Conceptual (Nuevo en HU#61)
                    await saveJson('class-maps', `${subjectId}/${classId}.json`, {
                        classId,
                        subjectId,
                        mapCode: mapResult.code,
                        generatedAt: mapResult.generatedAt
                    });

                    // Guardar Guión de Podcast (Story 2.xxx)
                    try {
                        const podcastResult = await generatePodcastScript(summaryResult.content, '', classId, { headers: openAiHeaders });
                        totalTokens += (podcastResult.usage?.total_tokens || 0);
                        await saveJson('class-audio-scripts', `${subjectId}/${classId}.json`, {
                            classId,
                            subjectId,
                            script: podcastResult.content,
                            generatedAt: podcastResult.generatedAt,
                            validated: false,
                        });
                        context.log(`[Pipeline] Guión de podcast guardado para clase ${classId}`);
                    } catch (podcastErr) {
                        context.error(`[Pipeline] Error generando guión de podcast (no bloqueante):`, podcastErr);
                    }
                }
                context.log(`[Pipeline] Activos IA guardados con éxito para clases: ${classIds.join(', ')}`);
            } catch (sumErr) {
                context.error(`[Pipeline] Error generando activos IA (no bloqueante):`, sumErr);
            }
        }

        // 5b. #564: si el docente borró el material mientras se procesaba, acá
        // termina todo. Reescribir la fila de estado lo devolvería al
        // inventario de la clase con su blob ya movido a `deleted/`, y el JSON
        // procesado volvería a aparecer en el fallback legacy.
        if (!(await isMaterialStillTracked(subjectId, materialId, context))) {
            context.log(`[Pipeline] Material ${materialId} borrado durante el procesamiento: se descarta el estado ready y el JSON procesado.`);
            try {
                await deleteVectorsByFilter({ materialId: { "$eq": materialId } });
            } catch (cleanupErr) {
                context.error(`[Pipeline] No se pudieron limpiar los vectores de ${materialId} tras el borrado:`, cleanupErr);
            }
            return;
        }

        // 6. Guardar estado final: ready
        const materialState = {
            materialId,
            classIds,
            subjectId,
            type: materialType,
            filename: fileName,
            status: 'ready',
            errorMessage: '',
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
                // #328: scoped timeline path; merge against the scoped blob first,
                // falling back to legacy only when it belongs to this subject.
                const timelineBlob = `${subjectId}/${classId}.json`;
                const legacyTimeline = await loadJson('class-timelines', `${classId}.json`).catch(() => null);
                const legacyBelongs = !legacyTimeline
                    || !legacyTimeline.subjectId
                    || String(legacyTimeline.subjectId) === String(subjectId);
                const existingTimeline = await loadJson('class-timelines', timelineBlob).catch(() => null)
                    || (legacyBelongs ? legacyTimeline : null)
                    || {
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
            status: 'success',
            correlationId,
        }).catch(e => context.error('[Telemetry] Error logging IngestionInteraction success:', e));

    } catch (err) {
        context.error(`[Pipeline] Error crítico para material ${materialId}:`, err);

        const errorCode = err.code || undefined;
        
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
            errorCode,
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
            status: 'error',
            errorCode,
            correlationId,
        }).catch(e => context.error('[Telemetry] Error logging IngestionInteraction failure:', e));

        try {
            if (await isMaterialStillTracked(subjectId, materialId, context)) {
                await upsertMaterialState(errorState);
            } else {
                context.log(`[Pipeline] Material ${materialId} borrado durante el procesamiento: no se persiste el estado de error.`);
            }
        } catch (stateErr) {
            context.error(`[StateStore] No se pudo persistir estado error para ${materialId}:`, stateErr);
        }

        try {
            if (await isMaterialStillTracked(subjectId, materialId, context)) {
                await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, errorState);
                context.log(`[Pipeline] Estado de error persistido para ${materialId}`);
            }
        } catch (saveErr) {
            context.error('[Pipeline] No se pudo guardar el estado de error:', saveErr);
        }
    }
}

/**
 * #564: ¿el material sigue en el inventario de la clase?
 *
 * El pipeline corre asincrónico contra el blob; el docente puede borrar el
 * material mientras procesa. En ese caso el estado ya no existe y volver a
 * escribirlo reviviría un material cuyo archivo ya está en `deleted/`.
 * Un error de storage NO se interpreta como borrado: se mantiene el
 * comportamiento previo para no perder el resultado del procesamiento.
 *
 * @param {string} subjectId
 * @param {string} materialId
 * @param {object} context
 * @returns {Promise<boolean>}
 */
async function isMaterialStillTracked(subjectId, materialId, context) {
    try {
        return await materialStateExists(subjectId, materialId);
    } catch (err) {
        context?.log?.(`[WARN][Pipeline] No se pudo verificar si ${materialId} sigue en el inventario (se asume que sí): ${err.message}`);
        return true;
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
