/**
 * scripts/reindex-checkpoint.js — Checkpoint/resume helpers para
 * reindex-vector-classid.js.
 *
 * El checkpoint permite reanudar una migracion de reindexado interrumpida
 * sin reprocesar los batches ya completados. Formato JSON:
 *   { version, completedBatches, totalIds, updatedAt, counts, correctedVectors, needsResolutionMeta }
 */
import fs from 'fs';
import path from 'path';

export const DEFAULT_CHECKPOINT_FILE = 'reindex-classid-checkpoint.json';

/**
 * Default de checkpoint del runner de cuarentena (Story 10.17). Distinto del
 * archivo de la migracion classId para evitar que runs intercalados se
 * sobrescriban/reanuden mutuamente (Loopback 3).
 */
export const DEFAULT_QUARANTINE_CHECKPOINT_FILE = 'reindex-quarantine-checkpoint.json';

export const CHECKPOINT_VERSION = 1;

export function parseReindexArgs(argv = process.argv.slice(2), env = process.env) {
    const isDryRun = env.DRY_RUN === 'true' || argv.includes('--dry-run');
    const showHelp = argv.includes('--help') || argv.includes('-h');
    const resume = argv.includes('--resume');

    const checkpointIdx = argv.indexOf('--checkpoint');
    let checkpointFile = DEFAULT_CHECKPOINT_FILE;
    if (checkpointIdx !== -1) {
        const next = argv[checkpointIdx + 1];
        if (next && !next.startsWith('--')) {
            checkpointFile = next;
        } else {
            console.warn(`[Reindex] --checkpoint requiere un nombre de archivo; usando el default ${DEFAULT_CHECKPOINT_FILE}.`);
        }
    }

    return { isDryRun, showHelp, resume, checkpointFile };
}

export function checkpointPath(file = DEFAULT_CHECKPOINT_FILE) {
    return path.resolve(file);
}

export function loadCheckpoint(file = DEFAULT_CHECKPOINT_FILE) {
    try {
        const raw = fs.readFileSync(checkpointPath(file), 'utf-8');
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object' || data.version !== CHECKPOINT_VERSION) {
            console.warn(`[Checkpoint] ${file} tiene una version no compatible (esperada ${CHECKPOINT_VERSION}); comenzando desde cero.`);
            return null;
        }
        if (!Number.isInteger(data.completedBatches) || data.completedBatches < 0) {
            console.warn(`[Checkpoint] ${file} no contiene un checkpoint valido; comenzando desde cero.`);
            return null;
        }
        return data;
    } catch (err) {
        if (err?.code === 'ENOENT') {
            console.warn(`[Checkpoint] No se encontro ${file}; comenzando desde cero.`);
        } else {
            console.warn(`[Checkpoint] Error leyendo ${file}: ${err.message}`);
        }
        return null;
    }
}

export function writeCheckpoint(file, data) {
    const completedBatches = Number(data.completedBatches);
    const totalIds = Number(data.totalIds);

    if (!Number.isInteger(completedBatches) || completedBatches < 0
        || !Number.isInteger(totalIds) || totalIds < 0) {
        console.warn(`[Checkpoint] Valores invalidos de completedBatches/totalIds; no se escribe el checkpoint.`);
        return;
    }

    // `extra` se guarda SIEMPRE bajo un namespace reservado para que el estado
    // del caller (failedVectors, candidates, etc.) NUNCA clobberee los campos
    // core (version, counts, completedBatches, totalIds). Round-trip test en
    // reindex-checkpoint.test.js (Loopback 2).
    const extra = data.extra && typeof data.extra === 'object' ? data.extra : undefined;

    const payload = {
        version: CHECKPOINT_VERSION,
        completedBatches,
        totalIds,
        updatedAt: new Date().toISOString(),
        counts: data.counts || {},
        correctedVectors: Array.isArray(data.correctedVectors)
            ? data.correctedVectors.map(v => ({ id: v.id, metadata: v.metadata || {} }))
            : [],
        needsResolutionMeta: Array.isArray(data.needsResolutionMeta)
            ? data.needsResolutionMeta.map(meta => {
                const { _values, ...rest } = meta;
                return rest;
            })
            : [],
    };
    if (extra !== undefined) {
        payload.extra = extra;
    }

    const target = checkpointPath(file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(payload, null, 2));
    console.log(`[Checkpoint] Progreso guardado en ${target} (batch ${completedBatches} completado)`);
}

export function removeCheckpoint(file = DEFAULT_CHECKPOINT_FILE) {
    try {
        fs.rmSync(checkpointPath(file), { force: true });
    } catch (err) {
        console.warn(`[Checkpoint] No se pudo eliminar ${file}: ${err.message}`);
    }
}

/**
 * Calcula el indice de inicio dentro del array de IDs para la reanudacion.
 * Se omiten los batches con indice < completedBatches (ya procesados).
 * @param {object|null} checkpoint
 * @param {number} totalIds - Cantidad total de vectores a procesar
 * @param {number} batchSize - Tamanio de batch (FETCH_BATCH_SIZE)
 * @returns {number} Indice de inicio (0..totalIds)
 */
export function getStartIndex(checkpoint, totalIds, batchSize) {
    if (!checkpoint || !Number.isInteger(checkpoint.completedBatches) || checkpoint.completedBatches <= 0) return 0;
    const start = checkpoint.completedBatches * batchSize;
    return Math.min(Math.max(start, 0), totalIds);
}

/**
 * Plan de reanudacion derivado del checkpoint.
 * @returns {{startIndex: number, completedBatches: number, resumed: boolean}}
 */
export function buildResumePlan(checkpoint, totalIds, batchSize) {
    const startIndex = getStartIndex(checkpoint, totalIds, batchSize);
    const completedBatches = checkpoint && Number.isInteger(checkpoint.completedBatches) ? checkpoint.completedBatches : 0;
    return { startIndex, completedBatches, resumed: startIndex > 0 };
}

/**
 * Advierte si el total de vectores registrado en el checkpoint difiere de forma
 * material del total actual del indice (posible indice modificado entre runs).
 * No bloquea la reanudacion: el checkpoint de batches completados sigue siendo
 * valido, solo se informa el cambio. @returns {boolean} true si se advirtio.
 */
export function warnIfIndexChanged(checkpoint, liveTotal) {
    if (!checkpoint || !Number.isFinite(checkpoint.totalIds)) return false;
    const delta = Math.abs(checkpoint.totalIds - liveTotal);
    const tolerance = Math.max(10, Math.round(liveTotal * 0.05));
    if (delta > tolerance) {
        console.warn(`[Checkpoint] ADVERTENCIA: el checkpoint registra ${checkpoint.totalIds} vectores, pero el indice actual tiene ${liveTotal} (diferencia de ${delta}). El indice pudo haber cambiado; se continua con los batches restantes.`);
        return true;
    }
    return false;
}
