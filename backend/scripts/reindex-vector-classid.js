/**
 * backend/scripts/reindex-vector-classid.js
 *
 * Migration: backfill `classId` metadata field in legacy Pinecone vectors.
 *
 * ## Usage
 *   node backend/scripts/reindex-vector-classid.js
 *   node backend/scripts/reindex-vector-classid.js --dry-run
 *   DRY_RUN=true node backend/scripts/reindex-vector-classid.js
 *
 * ## Checkpoint / resume (migraciones largas)
 *   node backend/scripts/reindex-vector-classid.js --resume
 *   node backend/scripts/reindex-vector-classid.js --resume --checkpoint ./mi-checkpoint.json
 *
 *   El progreso se persiste tras cada batch en `reindex-classid-checkpoint.json`
 *   (JSON). Con `--resume`, los batches ya completados se omiten y la migracion
 *   continua desde el ultimo batch procesado. El checkpoint se elimina al
 *   completar la migracion.
 *
 * ## Required environment variables
 *   PINECONE_HOST, PINECONE_INDEX_NAME, PINECONE_API_KEY
 *   AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_ACCESS_KEY (for Table Storage)
 *
 * ## Rollback
 *   This migration only adds the `classId` field; it does not modify existing
 *   metadata. To roll back, create a script that re-upserts vectors with
 *   `classId` deleted from metadata. No data loss risk.
 *
 * ## Safety
 *   - Run with --dry-run first to preview changes.
 *   - The script preserves values and all existing metadata fields.
 *   - Vectors already having `classId` are skipped.
 *   - Failed Table Storage lookups are logged and skipped (not blocking).
 */

import { pathToFileURL } from 'url';
import {
    listAllVectorIds,
    fetchVectorsByIds,
    upsertChunks,
} from '../src/services/vector-store.js';

import { getMaterialState } from '../src/services/state-store.js';
import {
    DEFAULT_CHECKPOINT_FILE,
    parseReindexArgs,
    loadCheckpoint,
    writeCheckpoint,
    removeCheckpoint,
    buildResumePlan,
    warnIfIndexChanged,
} from './reindex-checkpoint.js';

const FETCH_BATCH_SIZE = 500;

const parsedArgs = parseReindexArgs();
const isDryRun = parsedArgs.isDryRun;

// Import-safe guard: `--help` solo debe hacer exit cuando el script corre como
// main (no cuando otro modulo lo importa, ej: ensureVectorValues desde
// quarantine-reindex-vectors.js).
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

function printUsage() {
    console.log(`Uso: node scripts/reindex-vector-classid.js [opciones]

Opciones:
  --dry-run                 Solo simula los cambios (no hace upserts).
  --checkpoint <file>       Archivo de checkpoint (default: ${DEFAULT_CHECKPOINT_FILE}).
  --resume                  Reanuda desde el ultimo batch completado del checkpoint.
  --help, -h                Muestra esta ayuda.

Variables de entorno:
  DRY_RUN=true              Equivalente a --dry-run.
`);
}

if (isMainModule && parsedArgs.showHelp) {
    printUsage();
    process.exit(0);
}

function resolveClassId(metadata = {}, materialLookup) {
    if (metadata.classId) return { classId: metadata.classId, source: 'existing' };

    if (Array.isArray(metadata.classIds) && metadata.classIds.length > 0 && metadata.classIds[0]) {
        const resolved = metadata.classIds[0];
        return { classId: resolved, source: 'classIds[0]' };
    }

    if (metadata.materialId && materialLookup && materialLookup[metadata.materialId] && Array.isArray(materialLookup[metadata.materialId]) && materialLookup[metadata.materialId].length > 0) {
        const lookupClassIds = materialLookup[metadata.materialId];
        return { classId: lookupClassIds[0], source: 'table-storage' };
    }

    return { classId: null, source: 'unresolved' };
}

async function buildMaterialLookup(vectorMetadataList) {
    const uniqueMaterialIds = new Set();
    for (const meta of vectorMetadataList) {
        if (!meta.classId && (!Array.isArray(meta.classIds) || meta.classIds.length === 0)) {
            if (meta.materialId && meta.subjectId) {
                uniqueMaterialIds.add(JSON.stringify({ materialId: meta.materialId, subjectId: meta.subjectId }));
            }
        }
    }

    const lookup = {};
    for (const entry of uniqueMaterialIds) {
        const { materialId, subjectId } = JSON.parse(entry);
        try {
            const state = await getMaterialState(subjectId, materialId);
            if (state && state.classIds && state.classIds.length > 0) {
                lookup[materialId] = state.classIds;
            }
        } catch (err) {
            console.warn(`[Reindex] Table Storage lookup failed for materialId=${materialId}: ${err.message}`);
        }
    }

    return lookup;
}

/**
 * Los vectores corregidos restaurados desde un checkpoint no incluyen `values`
 * (para mantener liviano el archivo). Se re-fetchean los valores por ID solo
 * para aquellos vectores que los necesiten.
 *
 * Vectores que siguen sin valores luego del refetch se omiten del upsert (se
 * cuentan y loguean), para no sobrescribir datos almacenados con vectors vacios.
 * @returns {Promise<{vectors: Array, skippedCount: number}>}
 */
export async function ensureVectorValues(vectors) {
    const needsFetch = vectors.filter(v => !Array.isArray(v.values) || v.values.length === 0);
    if (needsFetch.length === 0) {
        return { vectors, skippedCount: 0 };
    }

    console.log(`[Reindex] Re-fetching values for ${needsFetch.length} checkpointed vectors...`);
    const valuesById = {};
    for (let i = 0; i < needsFetch.length; i += FETCH_BATCH_SIZE) {
        const ids = needsFetch.slice(i, i + FETCH_BATCH_SIZE).map(v => v.id);
        const { vectors: fetched } = await fetchVectorsByIds(ids);
        for (const vec of fetched) {
            valuesById[vec.id] = vec.values || [];
        }
    }

    const result = [];
    let skippedCount = 0;
    for (const v of vectors) {
        if (!Array.isArray(v.values) || v.values.length === 0) {
            const fresh = valuesById[v.id];
            if (!fresh || fresh.length === 0) {
                skippedCount += 1;
                console.warn(`[Reindex] No hay valores disponibles para el vector ${v.id}; se omite el upsert.`);
                continue;
            }
            result.push({ ...v, values: fresh });
        } else {
            result.push(v);
        }
    }

    return { vectors: result, skippedCount };
}

export async function main(options = {}) {
    const startTime = Date.now();
    const isDryRun = options.isDryRun !== undefined ? options.isDryRun : parsedArgs.isDryRun;
    const checkpointFile = options.checkpointFile || parsedArgs.checkpointFile;
    const resume = options.resume !== undefined ? options.resume : parsedArgs.resume;

    console.log(`[Reindex] Starting classId backfill migration...`);
    console.log(`[Reindex] Mode: ${isDryRun ? 'DRY RUN (no upserts)' : 'LIVE'}`);
    if (resume) console.log(`[Reindex] Resume habilitado (checkpoint: ${checkpointFile})`);

    // 1. List all vector IDs
    const allIds = await listAllVectorIds();
    console.log(`[Reindex] Found ${allIds.length} total vectors in index`);

    const numBatches = Math.ceil(allIds.length / FETCH_BATCH_SIZE);

    // 2. Checkpoint / resume plan
    let checkpoint = null;
    if (resume) checkpoint = loadCheckpoint(checkpointFile);
    if (checkpoint) warnIfIndexChanged(checkpoint, allIds.length);
    const { startIndex, completedBatches, resumed } = buildResumePlan(checkpoint, allIds.length, FETCH_BATCH_SIZE);
    if (resumed) {
        console.log(`[Reindex] Reanudando desde el batch ${completedBatches} de ${numBatches}; omitiendo batches ya procesados.`);
    }

    // 3. First pass: fetch all vectors and collect those needing classId resolution
    let scanned = checkpoint?.counts?.scanned || 0;
    let skipped = checkpoint?.counts?.skipped || 0;
    let updated = checkpoint?.counts?.updated || 0;
    let failed = checkpoint?.counts?.failed || 0;
    const needsResolutionMeta = Array.isArray(checkpoint?.needsResolutionMeta) ? checkpoint.needsResolutionMeta : [];
    const correctedVectors = Array.isArray(checkpoint?.correctedVectors) ? checkpoint.correctedVectors : [];

    for (let i = startIndex; i < allIds.length; i += FETCH_BATCH_SIZE) {
        const batchIndex = Math.floor(i / FETCH_BATCH_SIZE);
        const idBatch = allIds.slice(i, i + FETCH_BATCH_SIZE);
        const { vectors: fetched } = await fetchVectorsByIds(idBatch);

        for (const vector of fetched) {
            scanned += 1;
            const meta = vector.metadata || {};

            if (meta.classId) {
                skipped += 1;
                continue;
            }

            const classIds = Array.isArray(meta.classIds) ? meta.classIds : [];

            if (classIds.length > 0 && classIds[0]) {
                // Simple resolution from classIds array
                const correctedMeta = { ...meta, classId: classIds[0] };
                updated += 1;

                if (isDryRun) {
                    console.log(`[Reindex] DRY RUN — would update vector ${vector.id}: classId=${classIds[0]} (source: classIds[0])`);
                } else {
                    correctedVectors.push({
                        id: vector.id,
                        values: vector.values || [],
                        metadata: correctedMeta,
                    });
                }
            } else {
                // Needs Table Storage fallback — save original id and values
                needsResolutionMeta.push({ ...meta, _vectorId: vector.id, _values: vector.values || [] });
            }
        }

        if (!isDryRun) {
            writeCheckpoint(checkpointFile, {
                completedBatches: batchIndex + 1,
                totalIds: allIds.length,
                counts: { scanned, skipped, updated, failed },
                correctedVectors,
                needsResolutionMeta,
            });
        }
    }

    console.log(`[Reindex] Scanned: ${scanned}, Already OK: ${skipped}, Simple resolution: ${updated}, Need Table Storage: ${needsResolutionMeta.filter(m => !m._resolved).length}`);

    // 4. Build material lookup from Table Storage for unresolved vectors
    const needLookup = needsResolutionMeta;
    const materialLookup = needLookup.length > 0 ? await buildMaterialLookup(needLookup) : {};

    // 5. Second pass: handle vectors that need Table Storage fallback
    const unresolvedWithIds = needLookup.map(meta => ({
        meta,
        vectorId: meta._vectorId,
        originalValues: meta._values,
    }));

    // Batch-fetch fresh metadata for unresolved vectors
    const batchIds = unresolvedWithIds.map(u => u.vectorId).filter(Boolean);
    const freshVectorMap = {};
    for (let i = 0; i < batchIds.length; i += FETCH_BATCH_SIZE) {
        const idBatch = batchIds.slice(i, i + FETCH_BATCH_SIZE);
        const { vectors: freshVectors } = await fetchVectorsByIds(idBatch);
        for (const vec of freshVectors) {
            freshVectorMap[vec.id] = vec;
        }
    }

    for (const { meta, vectorId, originalValues } of unresolvedWithIds) {
        const { classId } = resolveClassId(meta, materialLookup);

        if (!classId) {
            failed += 1;
            console.warn(`[Reindex] Failed to resolve classId for vector: materialId=${meta.materialId}, subjectId=${meta.subjectId}, chunkIndex=${meta.chunkIndex}`);
            continue;
        }

        if (!vectorId) {
            failed += 1;
            console.warn(`[Reindex] Missing vectorId for materialId=${meta.materialId}, subjectId=${meta.subjectId}`);
            continue;
        }

        const freshVec = freshVectorMap[vectorId];
        const freshMeta = freshVec?.metadata || {};
        const correctedMeta = { ...freshMeta, classId };
        const values = freshVec?.values || originalValues || [];

        if (isDryRun) {
            updated += 1;
            console.log(`[Reindex] DRY RUN — would update vector ${vectorId}: classId=${classId} (source: table-storage)`);
            continue;
        }

        if (values.length === 0) {
            failed += 1;
            console.warn(`[Reindex] No values available for vector: ${vectorId}`);
            continue;
        }

        correctedVectors.push({
            id: vectorId,
            values,
            metadata: correctedMeta,
        });
        updated += 1;
    }

    // 6. Upsert corrections in batches
    if (!isDryRun && correctedVectors.length > 0) {
        const { vectors: withValues, skippedCount } = await ensureVectorValues(correctedVectors);
        failed += skippedCount;

        console.log(`[Reindex] Upserting ${withValues.length} corrected vectors...`);
        if (withValues.length > 0) {
            await upsertChunks(withValues);
            console.log(`[Reindex] Upsert complete.`);
        } else {
            console.warn('[Reindex] No quedaron vectores con valores para upsertear.');
        }
    } else if (isDryRun) {
        console.log(`[Reindex] DRY RUN — would upsert ${updated} vectors`);
    }

    // 7. Summary
    const durationMs = Date.now() - startTime;
    const durationS = (durationMs / 1000).toFixed(2);

    console.log('');
    console.log('=== Migration Summary ===');
    console.log(`Mode:               ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`Total scanned:      ${scanned}`);
    console.log(`Already OK:         ${skipped}`);
    console.log(`Updated:            ${updated}`);
    console.log(`Failed (no classId): ${failed}`);
    console.log(`Duration:           ${durationS}s`);
    console.log('========================');

    if (!isDryRun) {
        removeCheckpoint(checkpointFile);
        console.log(`[Reindex] Checkpoint eliminado (migracion completada).`);
    }

    if (failed > 0) {
        console.warn('[Reindex] Some vectors could not be resolved. Review logs above.');
    }
}

if (isMainModule) {
    main().then(() => process.exit(0)).catch((err) => {
        console.error('[Reindex] Migration failed:', err);
        process.exit(1);
    });
}
