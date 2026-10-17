import { v4 as uuidv4 } from 'uuid';
import { listAllVectorIds, fetchVectorsByIds, deleteVectorsByFilter, getIndexStats } from './vector-store.js';
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

        // UJ-57: `/vectors/list` puede no enumerar nada mientras el índice sí
        // declara vectores (el mismo hueco que UJ-59 midió en `vector-index`).
        // Sin este control el resguardo sale vacío y se registra como exitoso, y
        // `success: true` habilita el borrado de la ventana siguiente
        // (backup+cleanup): se borraría el acervo sin respaldo. Se falla fuerte.
        const indexTotalVectorCount = await readIndexTotalVectorCountSafely();
        if (allIds.length === 0 && indexTotalVectorCount > 0) {
            throw new CategorizedError(
                `El resguardo no enumeró ningún vector aunque el índice declara tener ${indexTotalVectorCount}. No se guarda un resguardo vacío como si estuviera completo.`,
                {
                    errorCategory: ErrorCategory.RETRIEVAL_FAILURE,
                    code: 'BACKUP_SCAN_INCOMPLETE',
                    status: 502,
                }
            );
        }

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
            // Alcance declarado del resguardo: cuántos vectores declara el índice.
            // Sirve para leer de vuelta si el paquete cubre el acervo o no.
            indexTotalVectorCount,
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
            indexTotalVectorCount,
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
            // Un fallo medido (p.ej. BACKUP_SCAN_INCOMPLETE, 502) conserva su
            // status en vez de aplanarse a 500: quien opera necesita distinguir
            // "no se pudo enumerar" de "se rompió el resguardo".
            status: Number.isInteger(categorized.status) ? categorized.status : 500,
            cause: err,
        });
    }
}

/**
 * Lee el total de vectores que el propio índice declara tener. Devuelve `0`
 * cuando no se pudo leer: un fallo de la lectura auxiliar no debe bloquear el
 * resguardo, y `0` desactiva el control de enumeración vacía en vez de
 * inventar un total.
 * @returns {Promise<number>}
 */
async function readIndexTotalVectorCountSafely() {
    try {
        const stats = await getIndexStats();
        const total = Number(stats?.totalVectorCount);
        return Number.isFinite(total) && total > 0 ? total : 0;
    } catch (err) {
        console.warn(`[VectorBackup] No se pudo leer el total del índice: ${err?.message || err}`);
        return 0;
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
        const { vectors: fetched } = await fetchVectorsByIds(batch);
        allVectors.push(...fetched);
    }
    return allVectors;
}
