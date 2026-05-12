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

import {
    listAllVectorIds,
    fetchVectorsByIds,
    upsertChunks,
} from '../src/services/vector-store.js';

import { getMaterialState } from '../src/services/state-store.js';

const FETCH_BATCH_SIZE = 500;

const isDryRun = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

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

async function main() {
    const startTime = Date.now();

    console.log(`[Reindex] Starting classId backfill migration...`);
    console.log(`[Reindex] Mode: ${isDryRun ? 'DRY RUN (no upserts)' : 'LIVE'}`);

    // 1. List all vector IDs
    const allIds = await listAllVectorIds();
    console.log(`[Reindex] Found ${allIds.length} total vectors in index`);

    // 2. First pass: fetch all vectors and collect those needing classId resolution
    let scanned = 0;
    let skipped = 0;
    let updated = 0;
    let failed = 0;
    const needsResolutionMeta = [];
    const correctedVectors = [];

    for (let i = 0; i < allIds.length; i += FETCH_BATCH_SIZE) {
        const idBatch = allIds.slice(i, i + FETCH_BATCH_SIZE);
        const fetched = await fetchVectorsByIds(idBatch);

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
    }

    console.log(`[Reindex] Scanned: ${scanned}, Already OK: ${skipped}, Simple resolution: ${updated}, Need Table Storage: ${needsResolutionMeta.filter(m => !m._resolved).length}`);

    // 3. Build material lookup from Table Storage for unresolved vectors
    const needLookup = needsResolutionMeta;
    const materialLookup = needLookup.length > 0 ? await buildMaterialLookup(needLookup) : {};

    // 4. Second pass: handle vectors that need Table Storage fallback
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
        const freshVectors = await fetchVectorsByIds(idBatch);
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

    // 5. Upsert corrections in batches
    if (!isDryRun && correctedVectors.length > 0) {
        console.log(`[Reindex] Upserting ${correctedVectors.length} corrected vectors...`);
        await upsertChunks(correctedVectors);
        console.log(`[Reindex] Upsert complete.`);
    } else if (isDryRun) {
        console.log(`[Reindex] DRY RUN — would upsert ${updated} vectors`);
    }

    // 6. Summary
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

    if (failed > 0) {
        console.warn('[Reindex] Some vectors could not be resolved. Review logs above.');
    }
}

main().then(() => process.exit(0)).catch((err) => {
    console.error('[Reindex] Migration failed:', err);
    process.exit(1);
});
