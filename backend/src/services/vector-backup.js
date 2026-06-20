import { v4 as uuidv4 } from 'uuid';
import { listAllVectorIds, fetchVectorsByIds, deleteVectorsByFilter } from './vector-store.js';
import { saveJson, listBlobs } from './storage.js';
import { trackVectorBackupRun } from './telemetry.js';
import { CategorizedError, ErrorCategory, normalizeCategorizedError } from './error-categories.js';

const BACKUP_CONTAINER = 'vector-backups';

/**
 * Runs a vector backup and optionally cleanup operation.
 *
 * @param {object} options
 * @param {'backup-only'|'backup+cleanup'} [options.mode='backup-only']
 * @param {string} [options.subjectScope] - Subject ID to scope the operation.
 *        For 'backup+cleanup' mode, this is required to prevent full index deletion.
 * @returns {Promise<{runId, mode, subjectScope, durationMs, vectorCount, backupBlob, status}>}
 */
export async function runVectorBackup({ mode = 'backup-only', subjectScope = null } = {}) {
    const runId = uuidv4();
    const startedAt = Date.now();

    if (mode === 'backup+cleanup' && !subjectScope) {
        throw new CategorizedError(
            'backup+cleanup mode requires a subjectScope to prevent full index deletion.',
            {
                errorCategory: ErrorCategory.VALIDATION,
                code: 'CLEANUP_REQUIRES_SCOPE',
                status: 400,
            }
        );
    }

    try {
        const allIds = await listAllVectorIds();
        const allVectors = await fetchAllVectorsInBatches(allIds);

        let vectors;
        if (subjectScope) {
            vectors = allVectors.filter(v => v.metadata?.subjectId === subjectScope);
        } else {
            vectors = allVectors;
        }

        const backupData = {
            runId,
            exportedAt: new Date().toISOString(),
            mode,
            subjectScope: subjectScope || 'all',
            vectorCount: vectors.length,
            vectors: vectors.map(v => ({
                id: v.id,
                values: v.values,
                metadata: v.metadata,
            })),
        };

        const blobName = `${runId}.json`;
        await saveJson(BACKUP_CONTAINER, blobName, backupData);

        if (mode === 'backup+cleanup') {
            await deleteVectorsByFilter({ subjectId: { $eq: subjectScope } });
        }

        const durationMs = Date.now() - startedAt;

        await trackVectorBackupRun({
            runId,
            mode,
            subjectScope: subjectScope || 'all',
            durationMs,
            vectorCount: vectors.length,
            success: true,
        });

        return {
            runId,
            mode,
            subjectScope: subjectScope || 'all',
            durationMs,
            vectorCount: vectors.length,
            backupBlob: blobName,
            status: 'completed',
        };
    } catch (err) {
        const durationMs = Date.now() - startedAt;
        const categorized = normalizeCategorizedError(err, ErrorCategory.INTERNAL);

        await trackVectorBackupRun({
            runId,
            mode,
            subjectScope: subjectScope || 'all',
            durationMs,
            vectorCount: 0,
            success: false,
            errorCategory: categorized.errorCategory,
            errorMessage: categorized.message,
        });

        throw new CategorizedError(`Vector backup failed: ${err.message}`, {
            errorCategory: categorized.errorCategory,
            code: categorized.code || 'VECTOR_BACKUP_FAILED',
            status: 500,
            cause: err,
        });
    }
}

/**
 * Lists completed backup run IDs.
 * @returns {Promise<string[]>}
 */
export async function listBackupRuns() {
    const blobs = await listBlobs(BACKUP_CONTAINER, '');
    return blobs
        .filter(name => name.endsWith('.json'))
        .map(name => name.replace('.json', ''));
}

async function fetchAllVectorsInBatches(ids) {
    const allVectors = [];
    for (let i = 0; i < ids.length; i += 1000) {
        const batch = ids.slice(i, i + 1000);
        const fetched = await fetchVectorsByIds(batch);
        allVectors.push(...fetched);
    }
    return allVectors;
}
