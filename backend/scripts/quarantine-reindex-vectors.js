/**
 * backend/scripts/quarantine-reindex-vectors.js
 *
 * Runner de auditoria/cuarentena + reindex de vectores RAG mal etiquetados
 * (Story 10.17 / Issue #263 — QA-002).
 *
 * ## Usage
 *   node backend/scripts/quarantine-reindex-vectors.js                 # live (audita y cuarentena)
 *   node backend/scripts/quarantine-reindex-vectors.js --dry-run       # preview (sin writes)
 *   node backend/scripts/quarantine-reindex-vectors.js --resume        # reanuda un run incompleto
 *   node backend/scripts/quarantine-reindex-vectors.js --reindex-material arq-software-2026:mat-123
 *
 * ## Required environment variables
 *   PINECONE_HOST, PINECONE_INDEX_NAME, PINECONE_API_KEY
 *   AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_ACCESS_KEY (Table Storage + Blob)
 *   AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY (embeddings, solo reindex live)
 *
 * ## Exit codes
 *   0  — exito completo (o --help)
 *   1  — run incompleto (failed > 0, dry-run con failed > 0)
 *   2  — aborto antes de mutar el indice (arg invalido, listado truncado,
 *        reindex con backup incompleto, cero chunks, subjectId mismatch, etc.)
 *
 * ## Seguridad
 *   - Siempre correr con --dry-run primero.
 *   - Backup pre-cambio + reporte de auditoria en container `vector-quarantine/`.
 *   - El checkpoint (default `reindex-quarantine-checkpoint.json`, distinto del
 *     de la migracion classId) se preserva cuando hay vectores fallidos para
 *     reintentar via --resume.
 */

import { pathToFileURL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import {
    listAllVectorIds,
    listVectorIds,
    fetchVectorsByIds,
    upsertChunks,
    deleteVectorsByMaterialId,
    getIndexStats,
} from '../src/services/vector-store.js';
import {
    getMaterialState,
    getMaterialStateById,
    listClassesBySubject,
    upsertMaterialState,
} from '../src/services/state-store.js';
import { saveJson, loadJson } from '../src/services/storage.js';
import { trackVectorQuarantineRun } from '../src/services/telemetry.js';
import { chunkText } from '../src/services/parser.js';
import { generateEmbeddingsBatch } from '../src/services/ai.js';
import {
    DEFAULT_QUARANTINE_CHECKPOINT_FILE,
    parseReindexArgs,
    loadCheckpoint,
    writeCheckpoint,
    removeCheckpoint,
    buildResumePlan,
    warnIfIndexChanged,
} from './reindex-checkpoint.js';
import { ensureVectorValues } from './reindex-vector-classid.js';
import {
    normalizeClassIds,
    detectVectorConflict,
    buildQuarantineMetadata,
    isQuarantined,
} from '../src/services/vector-audit.js';

const QUARANTINE_CONTAINER = 'vector-quarantine';
const CONTAINER_PROCESSED = 'processed';
const SCAN_BATCH_SIZE = 500;
const FETCH_PAGE_LIMIT = 500;
const REINDEX_MAX_PAGES = 100;
const VERIFY_FETCH_BATCH = 500;
const CHECKPOINT_KIND = 'quarantine';

export class CliExitError extends Error {
    constructor(message, exitCode = 2, category = 'CLI_ERROR') {
        super(message);
        this.name = 'CliExitError';
        this.exitCode = exitCode;
        this.category = category;
    }
}

/**
 * Parser unico del argumento `--reindex-material <subjectId>:<materialId>`.
 * Fuente unica de verdad (Loopback 5): runCli routea por este parser.
 *
 * @returns {{reindexMaterial: {subjectId: string, materialId: string}|null, reindexMaterialInvalid: boolean}}
 */
export function parseReindexMaterialArg(argv = process.argv.slice(2)) {
    const idx = argv.indexOf('--reindex-material');
    if (idx === -1) return { reindexMaterial: null, reindexMaterialInvalid: false };
    const next = argv[idx + 1];
    if (!next || next.startsWith('--')) {
        return { reindexMaterial: null, reindexMaterialInvalid: true };
    }
    const colonIdx = next.indexOf(':');
    if (colonIdx <= 0 || colonIdx === next.length - 1) {
        return { reindexMaterial: null, reindexMaterialInvalid: true };
    }
    return {
        reindexMaterial: {
            subjectId: next.slice(0, colonIdx),
            materialId: next.slice(colonIdx + 1),
        },
        reindexMaterialInvalid: false,
    };
}

/**
 * CLI del runner de cuarentena. Reutiliza parseReindexArgs para las flags base.
 *
 * `--checkpoint` se honra VERBATIM siempre que este presente con un valor valido
 * (nunca se re-mapea, incluso si es igual al default de la migracion). Solo el
 * caso sin flag usa el default de cuarentena (Loopback 4/5).
 */
export function parseQuarantineArgs(argv = process.argv.slice(2), env = process.env) {
    const base = parseReindexArgs(argv, env);

    const checkpointIdx = argv.indexOf('--checkpoint');
    const next = checkpointIdx !== -1 ? argv[checkpointIdx + 1] : undefined;
    const hasExplicitCheckpoint = Boolean(next && !next.startsWith('--'));

    const { reindexMaterial, reindexMaterialInvalid } = parseReindexMaterialArg(argv);

    return {
        isDryRun: base.isDryRun,
        showHelp: base.showHelp,
        resume: base.resume,
        checkpointFile: hasExplicitCheckpoint ? next : DEFAULT_QUARANTINE_CHECKPOINT_FILE,
        hasExplicitCheckpoint,
        reindexMaterial,
        reindexMaterialInvalid,
    };
}

function printUsage() {
    console.log(`Uso: node backend/scripts/quarantine-reindex-vectors.js [opciones]

Opciones:
  --dry-run                               Solo simula los cambios (sin writes).
  --checkpoint <file>                     Archivo de checkpoint (default: ${DEFAULT_QUARANTINE_CHECKPOINT_FILE}).
  --resume                                Reanuda desde el ultimo batch completado del checkpoint.
  --reindex-material <subjectId>:<materialId>
                                          Reindexa un material corregido: borra sus vectores
                                          en cuarentena y los re-embebe con metadata correcta.
  --help, -h                              Muestra esta ayuda.

Variables de entorno:
  DRY_RUN=true                            Equivalente a --dry-run.
`);
}

async function resolveMaterialState(meta) {
    let state = null;
    if (meta.subjectId && meta.materialId) {
        state = await getMaterialState(meta.subjectId, meta.materialId);
    }
    if (!state && meta.materialId) {
        state = await getMaterialStateById(meta.materialId);
    }
    return state;
}

/**
 * Clasifica un vector contra su registro autoritativo actual.
 *
 * @returns {Promise<{bucket: 'clean'|'quarantined'|'unresolvable'|'failed', conflict?: object}>}
 *   - 'clean'  → sin conflicto (o verified-answer) → normalizacion quarantined:false
 *   - 'quarantined' → subjectId-mismatch / classId-mismatch / metadata-incomplete
 *   - 'unresolvable' → registro autoritativo ausente (no-authoritative-material)
 *   - 'failed' → error de lookup (transitorio; NUNCA se cuarentena) (Loopback 4)
 */
async function classifyVector(vector) {
    const meta = vector.metadata && typeof vector.metadata === 'object' ? vector.metadata : {};

    // Loopback 2/3: verified-answer es EXEMPTO de cuarentena (no tiene fila en
    // materials por diseño), pero igual se normaliza (quarantined: false).
    if (meta.materialType === 'verified-answer') {
        return { bucket: 'clean', conflict: null };
    }

    // Loopback 4 (runbook): ya-cuarentenado se mantiene cuarentenado (no se
    // des-cuarentena), pero se re-deriva la razon contra el registro actual.
    if (isQuarantined(meta)) {
        let materialState = null;
        try {
            materialState = await resolveMaterialState(meta);
        } catch (err) {
            return { bucket: 'failed' };
        }
        const conflict = materialState
            ? detectVectorConflict(meta, materialState)
            : { conflict: true, reasons: ['no-authoritative-material'], expectedSubjectId: null, expectedClassIds: [] };
        const bucket = conflict.reasons.includes('no-authoritative-material') ? 'unresolvable' : 'quarantined';
        // Patch de review #6: devolver SIEMPRE el conflicto (aun cuando ya no hay
        // mismatch) para que buildQuarantineMetadata reciba expectedSubjectId/
        // expectedClassIds poblados del registro autoritativo actual.
        return { bucket, conflict };
    }

    let materialState = null;
    try {
        materialState = await resolveMaterialState(meta);
    } catch (err) {
        console.warn(`[Quarantine] Lookup error para materialId=${meta.materialId}, subjectId=${meta.subjectId}: ${err.message} (se cuenta como failed, no se cuarentena)`);
        return { bucket: 'failed' };
    }

    if (!materialState) {
        return {
            bucket: 'unresolvable',
            conflict: { conflict: true, reasons: ['no-authoritative-material'], expectedSubjectId: null, expectedClassIds: [] },
        };
    }

    const conflict = detectVectorConflict(meta, materialState);
    if (conflict.conflict) {
        const bucket = conflict.reasons.includes('no-authoritative-material') ? 'unresolvable' : 'quarantined';
        return { bucket, conflict };
    }
    return { bucket: 'clean', conflict: null };
}

/**
 * Modo auditoria/cuarentena: escanea todo el indice, clasifica cada vector y
 * (en live) re-upsertea los conflictivos con `quarantined: true` y normaliza
 * los limpios con `quarantined: false`.
 *
 * @returns {Promise<number>} exit code (0 ok, 1 incompleto, 2 aborto)
 */
export async function quarantineMode({ checkpointFile, resume, isDryRun }) {
    const runId = uuidv4();
    const startTime = Date.now();
    const dryRun = Boolean(isDryRun);
    const mode = dryRun ? 'quarantine-dry-run' : 'quarantine';
    const configuredNamespace = (process.env.PINECONE_NAMESPACE || '').trim() || null;

    // Contadores hoisted al outer scope para que el catch emita conteos parciales (Loopback 1).
    // En resume se REBUILDEN desde cero (patch de review #1/#2): los candidatos
    // restaurados se re-cuentan; el checkpoint no es una snapshot de conteos.
    let scanned = 0;
    let failedCount = 0;
    let incompleteBatchSeen = false;
    let completedBatches = 0; // ultimo batch COMPLETO (sin missingIds) — el resume reanuda desde aca
    let lastKnownTotalIds = 0;
    const quarantineCandidates = [];
    const cleanCandidates = [];
    const failedVectors = [];
    const seenIds = new Set(); // ids restaurados del checkpoint (patch de review #2)

    const writeRunCheckpoint = (totalIds) => {
        if (dryRun) return;
        writeCheckpoint(checkpointFile, {
            completedBatches,
            totalIds,
            counts: {
                scanned,
                clean: cleanCandidates.length,
                quarantined: quarantineCandidates.filter((c) => c.bucket === 'quarantined').length,
                unresolvable: quarantineCandidates.filter((c) => c.bucket === 'unresolvable').length,
                failed: failedCount,
            },
            extra: {
                kind: CHECKPOINT_KIND,
                quarantineCandidates: quarantineCandidates.map(({ id, metadata }) => ({ id, metadata })),
                cleanCandidates: cleanCandidates.map(({ id, metadata }) => ({ id, metadata })),
                failedVectors: failedVectors.map(({ id, metadata }) => ({ id, metadata })),
                incompleteBatchSeen,
            },
        });
    };

    const emitFailure = (errorCategory, errorMessage, overrides = {}) => {
        // Dry-run no emite telemetria (patch de review #11): es un preview offline.
        if (dryRun) return;
        return trackVectorQuarantineRun({
            runId, mode,
            scanned,
            clean: cleanCandidates.length,
            quarantined: quarantineCandidates.filter((c) => c.bucket === 'quarantined').length,
            unresolvable: quarantineCandidates.filter((c) => c.bucket === 'unresolvable').length,
            failed: failedCount,
            quarantineReasons: {},
            durationMs: Date.now() - startTime,
            success: false,
            errorCategory,
            errorMessage,
            ...overrides,
        });
    };

    try {
        // ── 0. Cargar checkpoint + validar kind (fail-fast ANTES de listar/escanear) ──
        // Patch de review #7: el checkpoint debe pertenecer a ESTE runner (marker
        // kind:'quarantine'), no al de la migracion classId.
        let checkpoint = null;
        if (resume) checkpoint = loadCheckpoint(checkpointFile);
        if (checkpoint && checkpoint.extra?.kind !== CHECKPOINT_KIND) {
            console.error(`[Quarantine] ABORT: el checkpoint ${checkpointFile} no pertenece al runner de cuarentena (falta marker kind:'${CHECKPOINT_KIND}'). Puede ser el checkpoint de la migracion classId; usa otro archivo.`);
            await emitFailure('CHECKPOINT_KIND_MISMATCH', `checkpoint kind mismatch en ${checkpointFile}`);
            return 2;
        }

        // ── 1. Listar + guardia de truncamiento (namespace-aware, patch de review #3/#13) ──
        const allIds = await listAllVectorIds();
        lastKnownTotalIds = allIds.length;
        const stats = await getIndexStats();

        let expectedVectorCount = null;
        if (stats && typeof stats === 'object') {
            if (configuredNamespace) {
                expectedVectorCount = stats.namespaces?.[configuredNamespace]?.vectorCount;
                if (expectedVectorCount == null) {
                    console.warn(`[Quarantine] No se pudo resolver el conteo del namespace '${configuredNamespace}' en getIndexStats; se omite la guardia de truncamiento (solo se escanea ese namespace).`);
                    expectedVectorCount = allIds.length;
                }
            } else if (stats.totalVectorCount != null) {
                expectedVectorCount = Number(stats.totalVectorCount);
            }
        }
        if (expectedVectorCount != null && expectedVectorCount !== allIds.length) {
            console.error(`[Quarantine] ABORT: el listado de IDs quedo truncado (${allIds.length} de ${expectedVectorCount} vectores). No se ejecuta la auditoria.`);
            await emitFailure('LISTING_TRUNCATED', `listing truncated: ${allIds.length}/${expectedVectorCount}`);
            return 2;
        }
        const numBatches = Math.ceil(allIds.length / SCAN_BATCH_SIZE);

        // ── 2. Resume plan ──
        if (checkpoint) warnIfIndexChanged(checkpoint, allIds.length);
        const { startIndex, resumed } = buildResumePlan(checkpoint, allIds.length, SCAN_BATCH_SIZE);
        if (resumed) {
            console.log(`[Quarantine] Reanudando desde el batch ${Math.floor(startIndex / SCAN_BATCH_SIZE)} de ${numBatches}; omitiendo batches ya procesados.`);
        }

        if (checkpoint) {
            completedBatches = Number.isInteger(checkpoint.completedBatches) ? checkpoint.completedBatches : 0;

            const qRestored = Array.isArray(checkpoint.extra?.quarantineCandidates) ? checkpoint.extra.quarantineCandidates : [];
            const cRestored = Array.isArray(checkpoint.extra?.cleanCandidates) ? checkpoint.extra.cleanCandidates : [];
            const fRestored = Array.isArray(checkpoint.extra?.failedVectors) ? checkpoint.extra.failedVectors : [];

            const restored = [
                ...qRestored.map((m) => ({ ...m, bucket: null, conflict: null })),
                ...cRestored.map((m) => ({ ...m, bucket: 'clean', conflict: null })),
                ...fRestored.map((m) => ({ ...m, bucket: null, conflict: null })),
            ];

            // Patch #2: los ids restaurados no se re-procesan si el batch re-escanado
            // los vuelve a traer (evita doble upsert / conteos inflados).
            for (const cand of restored) {
                seenIds.add(String(cand.id));
            }
            // Patch #1: NO heredar el flag incompleteBatchSeen del checkpoint; el
            // re-scan del batch incompleto decide si el run sigue incompleto.
            incompleteBatchSeen = false;

            if (restored.length > 0) {
                console.log(`[Quarantine] Re-clasificando ${restored.length} candidatos restaurados del checkpoint contra el registro autoritativo actual...`);
                for (const cand of restored) {
                    scanned += 1;
                    const classified = await classifyVector({ id: cand.id, metadata: cand.metadata });
                    if (classified.bucket === 'failed') {
                        failedCount += 1;
                        failedVectors.push({ id: cand.id, metadata: cand.metadata });
                    } else if (classified.bucket === 'clean') {
                        cleanCandidates.push({ id: cand.id, values: [], metadata: cand.metadata, bucket: 'clean', conflict: null });
                    } else {
                        quarantineCandidates.push({
                            id: cand.id, values: [], metadata: cand.metadata,
                            bucket: classified.bucket, conflict: classified.conflict,
                        });
                    }
                }
            }
        }

        // ── 3. Scan + clasificacion ──
        for (let i = startIndex; i < allIds.length; i += SCAN_BATCH_SIZE) {
            const batchIndex = Math.floor(i / SCAN_BATCH_SIZE);
            const idBatch = allIds.slice(i, i + SCAN_BATCH_SIZE);
            const { vectors: fetched, missingIds } = await fetchVectorsByIds(idBatch);

            for (const vector of fetched) {
                if (seenIds.has(String(vector.id))) continue; // patch #2: ya restaurado del checkpoint
                scanned += 1;
                const classified = await classifyVector(vector);
                if (classified.bucket === 'failed') {
                    failedCount += 1;
                    failedVectors.push({ id: vector.id, metadata: vector.metadata || {} });
                    continue;
                }
                if (classified.bucket === 'clean') {
                    cleanCandidates.push({
                        id: vector.id, values: vector.values || [], metadata: vector.metadata || {},
                        bucket: 'clean', conflict: null,
                    });
                } else {
                    quarantineCandidates.push({
                        id: vector.id, values: vector.values || [], metadata: vector.metadata || {},
                        bucket: classified.bucket, conflict: classified.conflict,
                    });
                }
            }

            if (missingIds.length > 0) {
                incompleteBatchSeen = true;
                failedCount += missingIds.length;
                for (const id of missingIds) {
                    console.warn(`[Quarantine] Vector id=${id} no encontrado en el fetch; se cuenta como failed y el batch NO se checkpointea como completo.`);
                }
            }

            // Checkpoint por batch solo cuando el batch esta completo (Loopback 1b);
            // un batch con missingIds se re-procesa en el resume.
            if (missingIds.length === 0) {
                completedBatches = batchIndex + 1;
                writeRunCheckpoint(allIds.length);
            }
        }

        const allCandidates = [...quarantineCandidates, ...cleanCandidates];

        // ── 4. Reconciliacion de valores (ensureVectorValues) ──
        let finalClean;
        let finalQuarantined;
        let finalUnresolvable;
        let finalFailed;
        let survivors = [];

        if (dryRun) {
            // Dry-run: sin writes, sin ensureVectorValues. Los conteos reflejan la clasificacion.
            finalClean = cleanCandidates.length;
            finalQuarantined = quarantineCandidates.filter((c) => c.bucket === 'quarantined').length;
            finalUnresolvable = quarantineCandidates.filter((c) => c.bucket === 'unresolvable').length;
            finalFailed = failedCount;
        } else {
            const { vectors: withValues } = await ensureVectorValues(
                allCandidates.map(({ id, values, metadata }) => ({ id, values, metadata }))
            );
            const withValuesById = new Map(withValues.map((v) => [v.id, v]));
            for (const c of allCandidates) {
                // Patch de review #5: mismo contrato que el path de reindex — un
                // candidato omitido O con values vacios cuenta como failed y se
                // excluye de ambos upserts (nunca se re-upsertea con values:[]).
                const fresh = withValuesById.get(c.id);
                if (!fresh || !Array.isArray(fresh.values) || fresh.values.length === 0) {
                    failedCount += 1;
                    failedVectors.push({ id: c.id, metadata: c.metadata });
                    continue;
                }
                survivors.push({ ...c, values: fresh.values, metadata: fresh.metadata });
            }
            finalClean = survivors.filter((c) => c.bucket === 'clean').length;
            finalQuarantined = survivors.filter((c) => c.bucket === 'quarantined').length;
            finalUnresolvable = survivors.filter((c) => c.bucket === 'unresolvable').length;
            finalFailed = failedCount;
        }

        const finalScanned = scanned;
        const success = finalFailed === 0 && !incompleteBatchSeen;

        const quarantineSurvivors = survivors.filter((c) => c.bucket !== 'clean');
        const cleanSurvivors = survivors.filter((c) => c.bucket === 'clean');

        // El reporte/quarantineReasons se construye desde la fuente reconciliada:
        // survivors (payloads reales post-ensureVectorValues) en live, y desde la
        // clasificacion completa en dry-run (no hay payloads).
        const quarantineSource = dryRun ? quarantineCandidates : quarantineSurvivors;

        const reasonsFor = (c) => {
            if (c.conflict?.reasons && c.conflict.reasons.length > 0) return c.conflict.reasons;
            if (c.metadata?.quarantineReason) return [c.metadata.quarantineReason];
            return [c.bucket === 'unresolvable' ? 'no-authoritative-material' : 'quarantined'];
        };

        // Loopback 5: TODA razon de un conflicto dual cuenta en quarantineReasons.
        const quarantineReasons = {};
        for (const c of quarantineSource) {
            for (const reason of reasonsFor(c)) {
                quarantineReasons[reason] = (quarantineReasons[reason] || 0) + 1;
            }
        }

        const quarantineReport = quarantineSource.map((c) => ({
            id: c.id,
            materialId: c.metadata.materialId || null,
            subjectId: c.metadata.subjectId || null,
            classIds: Array.isArray(c.metadata.classIds) ? c.metadata.classIds : (c.metadata.classId ? [c.metadata.classId] : []),
            expectedSubjectId: c.conflict?.expectedSubjectId !== undefined ? c.conflict.expectedSubjectId : null,
            expectedClassIds: c.conflict && Array.isArray(c.conflict.expectedClassIds) ? c.conflict.expectedClassIds : [],
            quarantineReason: reasonsFor(c).join(','),
        }));

        // ── 5. Backup pre-cuarentena (live) ──
        if (!dryRun && survivors.length > 0) {
            await saveJson(QUARANTINE_CONTAINER, `${runId}.json`, {
                runId,
                exportedAt: new Date().toISOString(),
                mode,
                vectorCount: survivors.length,
                vectors: survivors.map((v) => ({ id: v.id, values: v.values, metadata: v.metadata })),
            });
            console.log(`[Quarantine] Backup pre-cuarentena escrito en vector-quarantine/${runId}.json (${survivors.length} vectores con values).`);
        }

        // ── 6. Upserts (live) ──
        if (!dryRun) {
            if (quarantineSurvivors.length > 0) {
                const quarantinePayloads = quarantineSurvivors.map((c) => ({
                    id: c.id,
                    values: c.values,
                    metadata: buildQuarantineMetadata(c.metadata, c.conflict || {
                        reasons: [c.bucket === 'unresolvable' ? 'no-authoritative-material' : 'quarantined'],
                        expectedSubjectId: null,
                        expectedClassIds: [],
                    }),
                }));
                await upsertChunks(quarantinePayloads);
                console.log(`[Quarantine] ${quarantinePayloads.length} vectores marcados en cuarentena (quarantined: true).`);
            }
            if (cleanSurvivors.length > 0) {
                const cleanPayloads = cleanSurvivors.map((c) => ({
                    id: c.id,
                    values: c.values,
                    metadata: { ...c.metadata, quarantined: false },
                }));
                await upsertChunks(cleanPayloads);
                console.log(`[Quarantine] ${cleanPayloads.length} vectores limpios normalizados (quarantined: false).`);
            }

            // Loopback 5: el reporte se escribe SIEMPRE (incluso con 0 cuarentenados).
            const reportBlob = `${runId}-report.json`;
            await saveJson(QUARANTINE_CONTAINER, reportBlob, {
                runId,
                mode,
                exportedAt: new Date().toISOString(),
                counts: {
                    scanned: finalScanned,
                    clean: finalClean,
                    quarantined: finalQuarantined,
                    unresolvable: finalUnresolvable,
                    failed: finalFailed,
                },
                quarantineReasons,
                quarantineCount: quarantineReport.length,
                vectors: quarantineReport,
            });
            console.log(`[Quarantine] Reporte de auditoria escrito en vector-quarantine/${reportBlob}.`);
        }

        // ── 7. Checkpoint: remover en exito; preservar si fallo (Loopback 2) ──
        if (!dryRun) {
            if (success) {
                removeCheckpoint(checkpointFile);
            } else {
                writeCheckpoint(checkpointFile, {
                    // NO marcar como completos los batches que tuvieron missingIds:
                    // el resume debe reanudar desde el ultimo batch COMPLETO.
                    completedBatches,
                    totalIds: allIds.length,
                    counts: {
                        scanned: finalScanned,
                        clean: finalClean,
                        quarantined: finalQuarantined,
                        unresolvable: finalUnresolvable,
                        failed: finalFailed,
                    },
                    extra: {
                        kind: CHECKPOINT_KIND,
                        quarantineCandidates: quarantineSurvivors.map(({ id, metadata }) => ({ id, metadata })),
                        cleanCandidates: cleanSurvivors.map(({ id, metadata }) => ({ id, metadata })),
                        failedVectors: failedVectors.map(({ id, metadata }) => ({ id, metadata })),
                        incompleteBatchSeen,
                    },
                });
                console.warn(`[Quarantine] Run incompleto (failed=${finalFailed}). Checkpoint preservado en ${checkpointFile} para --resume.`);
            }
        }

        // ── 8. Summary + telemetria ──
        const durationMs = Date.now() - startTime;
        console.log('');
        console.log('=== Quarantine Summary ===');
        console.log(`Mode:               ${dryRun ? 'DRY RUN' : 'LIVE'}`);
        console.log(`Scanned:            ${finalScanned}`);
        console.log(`Clean:              ${finalClean}`);
        console.log(`Quarantined:        ${finalQuarantined}`);
        console.log(`Unresolvable:       ${finalUnresolvable}`);
        console.log(`Failed:             ${finalFailed}`);
        console.log(`Success:            ${success}`);
        console.log(`Duration:           ${(durationMs / 1000).toFixed(2)}s`);
        console.log('========================');
        if (!success) {
            console.warn(`[Quarantine] Run incompleto. Usá --resume para reintentar los ${finalFailed} vectores fallidos.`);
        }

        // Dry-run: preview offline, sin telemetria (patch de review #11). El exit
        // code y el summary siguen propagando el success computado.
        if (!dryRun) {
            await trackVectorQuarantineRun({
                runId, mode, scanned: finalScanned, clean: finalClean,
                quarantined: finalQuarantined, unresolvable: finalUnresolvable, failed: finalFailed,
                quarantineReasons, durationMs, success,
            });
        }

        return success ? 0 : 1;
    } catch (err) {
        const durationMs = Date.now() - startTime;
        const cleanCount = cleanCandidates.length;
        const quarantinedCount = quarantineCandidates.filter((c) => c.bucket === 'quarantined').length;
        const unresolvableCount = quarantineCandidates.filter((c) => c.bucket === 'unresolvable').length;

        // Patch de review #4: un fallo a mitad de run (upsert/saveJson network) no
        // debe perder el estado de scan — persistir checkpoint parcial (best-effort)
        // para permitir --resume.
        if (!dryRun) {
            try {
                writeCheckpoint(checkpointFile, {
                    completedBatches,
                    totalIds: lastKnownTotalIds,
                    counts: {
                        scanned,
                        clean: cleanCount,
                        quarantined: quarantinedCount,
                        unresolvable: unresolvableCount,
                        failed: failedCount,
                    },
                    extra: {
                        kind: CHECKPOINT_KIND,
                        quarantineCandidates: quarantineCandidates.map(({ id, metadata }) => ({ id, metadata })),
                        cleanCandidates: cleanCandidates.map(({ id, metadata }) => ({ id, metadata })),
                        failedVectors: failedVectors.map(({ id, metadata }) => ({ id, metadata })),
                        incompleteBatchSeen,
                    },
                });
            } catch (cpErr) {
                console.warn(`[Quarantine] No se pudo escribir checkpoint parcial tras el error: ${cpErr.message}`);
            }
        }

        if (err instanceof CliExitError) {
            await emitFailure(err.category, err.message);
            console.error(`[Quarantine] Abortado: ${err.message}`);
            return err.exitCode;
        }

        await emitFailure('QUARANTINE_ERROR', err.message);
        console.error('[Quarantine] Error fatal:', err);
        return 1;
    }
}

/**
 * Resuelve el lectureDate para los chunks re-indexados.
 * Orden (Loopback 5): `processed.lectureDate` → metadata de chunk existente →
 * `date`/`lectureDate` de la clase. NUNCA processing timestamps
 * (`processedAt`/`uploadedAt`). Devuelve null si no hay valor (la clave se
 * omite en el upsert, nunca se escribe `undefined`).
 *
 * @param {object} processed - Blob procesado del material.
 * @param {Array<{id: string, metadata: object}>} existingVectors - Vectores existentes.
 * @param {string[]} [classIds] - classIds autoritativos para resolver la clase.
 */
export async function resolveLectureDate(processed, existingVectors, classIds = []) {
    if (processed?.lectureDate) return processed.lectureDate;

    for (const v of existingVectors || []) {
        if (v.metadata?.lectureDate) return v.metadata.lectureDate;
    }

    // Patch de review #10: recorrer TODOS los classIds y usar la primera clase
    // que tenga date/lectureDate (no solo classIds[0]).
    const classIdList = Array.isArray(classIds) ? classIds : [];
    if (classIdList.length > 0) {
        try {
            const subjectId = processed?.subjectId;
            if (subjectId) {
                const classes = await listClassesBySubject(subjectId);
                for (const cid of classIdList) {
                    const target = classes.find((c) => String(c.id) === String(cid));
                    if (target?.date) return target.date;
                    if (target?.lectureDate) return target.lectureDate;
                }
            }
        } catch (err) {
            console.warn(`[Reindex] No se pudo resolver lectureDate de la clase (no bloqueante): ${err.message}`);
        }
    }

    return null;
}

/**
 * Captura todos los vectores existentes de un material usando listado paginado
 * con guardias anti-loop (seen-token + max-pages) y aborta (exit 2) si cualquier
 * fetch devuelve missingIds — el delete nunca debe superar al backup (Loopback 3/4).
 *
 * @param {string} materialId
 * @param {{limit?: number, maxPages?: number}} [options]
 */
export async function fetchExistingChunksPaginated(materialId, { limit = FETCH_PAGE_LIMIT, maxPages = REINDEX_MAX_PAGES } = {}) {
    const all = [];
    const seenTokens = new Set();
    let paginationToken;
    let pageCount = 0;

    do {
        const result = await listVectorIds({ prefix: `${materialId}-chunk-`, limit, paginationToken });
        pageCount += 1;

        if (result.vectorIds.length > 0) {
            const { vectors, missingIds } = await fetchVectorsByIds(result.vectorIds);
            if (missingIds.length > 0) {
                throw new CliExitError(
                    `No se pudieron fetchear ${missingIds.length} vectores existentes de ${materialId} (missingIds); abortando antes de borrar.`,
                    2,
                    'REINDEX_FETCH_MISSING',
                );
            }
            all.push(...vectors);
        }

        paginationToken = result.pagination?.next;
        if (paginationToken) {
            if (seenTokens.has(paginationToken)) {
                throw new CliExitError(`Paginacion ciclica en el listado de vectores de ${materialId}; abortando antes de borrar.`, 2, 'REINDEX_PAGINATION_LOOP');
            }
            seenTokens.add(paginationToken);
        }
        if (pageCount >= maxPages && paginationToken) {
            throw new CliExitError(`Se alcanzaron ${maxPages} paginas listando vectores de ${materialId}; abortando antes de borrar (captura incompleta).`, 2, 'REINDEX_MAX_PAGES');
        }
    } while (paginationToken);

    return all;
}

function resolveMaterialPriorityFallback(materialType) {
    const mt = String(materialType || '').toLowerCase();
    return mt === 'bibliography' ? 'secondary' : 'primary';
}

/**
 * Verifica el reindex post-upsert con reintento/backoff (eventual consistency
 * de Pinecone) y fetch por batches (<=500 ids). El chequeo de classIds corre
 * SIEMPRE: autoritativo → processed blob → si ambos estan vacios, exige que el
 * vector tambien este vacio (Loopback 4/5).
 *
 * @param {object} opts
 * @param {string} opts.materialId
 * @param {string} opts.subjectId
 * @param {number} opts.expectedChunkCount - Nuevo chunk count (no el stale).
 * @param {string[]} opts.expectedClassIds
 * @param {string} opts.expectedMaterialType
 * @param {object} [opts.processed]
 * @param {number} [opts.retries=3]
 * @param {number} [opts.retryDelayMs=1000]
 */
export async function verifyReindex({
    materialId,
    subjectId,
    expectedChunkCount,
    expectedClassIds = [],
    expectedMaterialType,
    processed,
    retries = 3,
    retryDelayMs = 1000,
}) {
    const expectedClassList = (Array.isArray(expectedClassIds) && expectedClassIds.length > 0)
        ? expectedClassIds
        : (Array.isArray(processed?.classIds) ? processed.classIds : []);

    const ids = Array.from({ length: expectedChunkCount }, (_, i) => `${materialId}-chunk-${i}`);

    let allVectors = [];
    let lastError = null;
    for (let attempt = 1; attempt <= Math.max(1, Number(retries) || 1); attempt++) {
        allVectors = [];
        try {
            for (let i = 0; i < ids.length; i += VERIFY_FETCH_BATCH) {
                const batch = ids.slice(i, i + VERIFY_FETCH_BATCH);
                const { vectors, missingIds } = await fetchVectorsByIds(batch);
                if (missingIds.length > 0) {
                    throw new Error(`missingIds=${missingIds.length} (ej: ${missingIds[0]})`);
                }
                allVectors.push(...vectors);
            }
            break;
        } catch (err) {
            lastError = err;
            if (attempt < retries) {
                console.warn(`[Reindex] Verificacion intento ${attempt}/${retries} fallo (eventual consistency): ${err.message}`);
                await new Promise((r) => setTimeout(r, retryDelayMs));
            }
        }
    }

    if (allVectors.length !== expectedChunkCount) {
        console.error(`[Reindex] Verificacion: se esperaban ${expectedChunkCount} vectores, se obtuvieron ${allVectors.length}.${lastError ? ` Ultimo error: ${lastError.message}` : ''}`);
        return false;
    }

    for (const v of allVectors) {
        const meta = v.metadata || {};
        if (meta.quarantined === true) {
            console.error(`[Reindex] Verificacion: vector ${v.id} sigue cuarentenado.`);
            return false;
        }
        if (String(meta.subjectId) !== String(subjectId)) {
            console.error(`[Reindex] Verificacion: vector ${v.id} subjectId=${meta.subjectId}, esperado=${subjectId}.`);
            return false;
        }
        if (String(meta.materialId) !== String(materialId)) {
            console.error(`[Reindex] Verificacion: vector ${v.id} materialId=${meta.materialId}.`);
            return false;
        }
        if (String(meta.materialType) !== String(expectedMaterialType)) {
            console.error(`[Reindex] Verificacion: vector ${v.id} materialType=${meta.materialType}, esperado=${expectedMaterialType}.`);
            return false;
        }
        // Patch de review #9: comparar classIds como SETS (order-insensitive) y
        // validar el campo singular classId (si presente) contra el conjunto.
        const vectorClassIds = Array.isArray(meta.classIds) ? meta.classIds : (meta.classId ? [meta.classId] : []);
        const normVectorSet = new Set(vectorClassIds.map(String));
        const normExpectedSet = new Set(expectedClassList.map(String));
        const setsEqual = normVectorSet.size === normExpectedSet.size
            && [...normExpectedSet].every((id) => normVectorSet.has(id));
        if (!setsEqual) {
            console.error(`[Reindex] Verificacion: vector ${v.id} classIds=${JSON.stringify([...normVectorSet])}, esperado=${JSON.stringify([...normExpectedSet])}.`);
            return false;
        }
        if (meta.classId !== undefined && meta.classId !== null && String(meta.classId) !== ''
            && !normVectorSet.has(String(meta.classId))) {
            console.error(`[Reindex] Verificacion: vector ${v.id} classId=${meta.classId} no esta en classIds=${JSON.stringify([...normVectorSet])}.`);
            return false;
        }
    }

    // Patch de review #8: un material acortado (10 chunks → 3) deja huerfanos
    // 3..9 que el fetch por id 0..n-1 no detecta. Confirmar que el conteo total
    // de vectores con prefijo ${materialId}-chunk- iguala el nuevo chunkCount.
    const prefixCount = await countVectorsByPrefix(`${materialId}-chunk-`);
    if (prefixCount !== expectedChunkCount) {
        console.error(`[Reindex] Verificacion: el material ${materialId} tiene ${prefixCount} vectores con prefijo ${materialId}-chunk-, se esperaban ${expectedChunkCount} (puede haber huerfanos o faltantes).`);
        return false;
    }

    return true;
}

/**
 * Cuenta vectores por prefijo recorriendo la paginacion (sin fallar por
 * missingIds — solo se necesita el conteo).
 * @param {string} prefix
 */
async function countVectorsByPrefix(prefix) {
    let count = 0;
    let paginationToken;
    const seenTokens = new Set();
    let pageCount = 0;

    do {
        const result = await listVectorIds({ prefix, limit: FETCH_PAGE_LIMIT, paginationToken });
        count += result.vectorIds.length;
        paginationToken = result.pagination?.next;
        pageCount += 1;

        if (paginationToken) {
            if (seenTokens.has(paginationToken)) break;
            seenTokens.add(paginationToken);
        }
        if (pageCount >= REINDEX_MAX_PAGES) break;
    } while (paginationToken);

    return count;
}

/**
 * Modo reindex de un material corregido: borra los vectores en cuarentena y
 * re-embebe (re-chunk 512/50) desde el blob procesado autoritativo con metadata
 * correcta (`quarantined: false` siempre presente).
 *
 * @returns {Promise<number>} exit code (0 ok, 1 verify-failed, 2 aborto)
 */
export async function reindexMaterialMode({ subjectId, materialId, isDryRun }) {
    const runId = uuidv4();
    const startTime = Date.now();
    const dryRun = Boolean(isDryRun);
    const mode = 'reindex';

    try {
        // ── 1. Registro autoritativo + cross-check de subjectId (Loopback 3) ──
        let authoritative = null;
        try {
            authoritative = await getMaterialState(subjectId, materialId);
            if (!authoritative) authoritative = await getMaterialStateById(materialId);
        } catch (err) {
            throw new CliExitError(`Error resolviendo el material ${materialId} en Table Storage: ${err.message}`, 2, 'MATERIAL_LOOKUP_FAILED');
        }
        if (!authoritative) {
            throw new CliExitError(`No se encontro el material ${materialId} en Table Storage.`, 2, 'MATERIAL_NOT_FOUND');
        }
        if (String(authoritative.subjectId) !== String(subjectId)) {
            throw new CliExitError(
                `El subjectId provisto (${subjectId}) no coincide con el registro autoritativo del material ${materialId} (${authoritative.subjectId}).`,
                2,
                'SUBJECT_MISMATCH',
            );
        }

        // ── 2. Blob procesado (source of truth para re-embedding) ──
        const processed = (await loadJson(CONTAINER_PROCESSED, `${materialId}.json`)) || {};
        const text = processed?.extractedText || processed?.text || '';
        if (!text || typeof text !== 'string' || text.trim() === '') {
            throw new CliExitError(`El blob procesado ${materialId}.json no tiene texto extraido para re-chunkear.`, 2, 'NO_EXTRACTED_TEXT');
        }

        // ── 3. Re-chunk (512 tokens, 50 overlap) ──
        const chunks = chunkText(text, 512, 50);
        if (chunks.length === 0) {
            throw new CliExitError(`El re-chunk de ${materialId} genero 0 chunks; abortando antes de borrar vectores.`, 2, 'ZERO_CHUNKS');
        }

        // ── 4. Captura paginada de vectores existentes ANTES de borrar ──
        const existingVectors = await fetchExistingChunksPaginated(materialId, { limit: FETCH_PAGE_LIMIT, maxPages: REINDEX_MAX_PAGES });

        // ── 5. Refetch de values para el backup; abort (exit 2) si algo falla ──
        // Patch de review #11: en dry-run NO se hace el refetch (es un preview
        // offline, sin lecturas extra a Pinecone).
        let existingWithValues;
        if (dryRun) {
            existingWithValues = existingVectors;
        } else {
            const ensured = await ensureVectorValues(existingVectors);
            if (ensured.skippedCount > 0) {
                throw new CliExitError(
                    `No se pudieron re-obtener values de ${ensured.skippedCount} vectores existentes de ${materialId}; abortando antes de borrar (el backup estaria incompleto).`,
                    2,
                    'REINDEX_BACKUP_INCOMPLETE',
                );
            }
            existingWithValues = ensured.vectors;
        }

        // ── 6. Metadata autoritativa ──
        // Pass-6 fix: normalizeClassIds tolera classIds como array, JSON string o
        // comma-split (misma convencion que vector-audit).
        const classIds = (Array.isArray(authoritative.classIds) && authoritative.classIds.length > 0)
            ? normalizeClassIds(authoritative.classIds)
            : (processed?.classIds ? normalizeClassIds(processed.classIds) : []);
        const materialType = authoritative.type || processed?.materialType || processed?.type || 'transcript';

        const lectureDate = await resolveLectureDate(processed, existingWithValues, classIds);

        // ── 7. Embeddings (dry-run: placeholder, sin quota) ──
        let embeddings;
        if (dryRun) {
            embeddings = chunks.map(() => [0]);
        } else {
            const { embeddings: embs } = await generateEmbeddingsBatch(chunks.map((c) => (typeof c === 'string' ? c : (c.text || ''))));
            embeddings = embs;
            // Patch de review #12: nunca upsertear menos embeddings que chunks
            // (undefined/partial values tras el delete).
            if (!Array.isArray(embeddings) || embeddings.length !== chunks.length) {
                throw new CliExitError(
                    `generateEmbeddingsBatch devolvio ${Array.isArray(embeddings) ? embeddings.length : 0} embeddings para ${chunks.length} chunks; abortando antes de borrar.`,
                    2,
                    'EMBEDDING_COUNT_MISMATCH',
                );
            }
        }

        const existingById = new Map(existingWithValues.map((v) => [v.id, v]));
        const newChunks = chunks.map((chunk, chunkIndex) => {
            const existing = existingById.get(`${materialId}-chunk-${chunkIndex}`);
            const metadata = {
                subjectId,
                classId: classIds[0] || null,
                classIds,
                materialId,
                materialType,
                materialPriority: authoritative.priority || processed?.priority || processed?.materialPriority || resolveMaterialPriorityFallback(materialType),
                chunkIndex,
                sourceFilename: authoritative.filename || processed?.filename || `${materialId}`,
                text: typeof chunk === 'string' ? chunk : (chunk.text || ''),
                quarantined: false,
            };
            if (existing?.metadata?.slideTitle) metadata.slideTitle = existing.metadata.slideTitle;
            if (lectureDate) metadata.lectureDate = lectureDate;
            return { id: `${materialId}-chunk-${chunkIndex}`, values: embeddings[chunkIndex], metadata };
        });

        if (dryRun) {
            console.log(`[Reindex] DRY RUN — re-indexaria ${newChunks.length} chunks para materialId=${materialId} (subjectId=${subjectId}, classIds=${JSON.stringify(classIds)}, materialType=${materialType})`);
            // Dry-run: preview offline, sin telemetria (patch de review #11).
            return 0;
        }

        // ── 8. Backup pre-delete (Loopback 2/3) ──
        await saveJson(QUARANTINE_CONTAINER, `${runId}-reindex-backup.json`, {
            runId,
            exportedAt: new Date().toISOString(),
            materialId,
            mode: 'reindex-backup',
            vectorCount: existingWithValues.length,
            vectors: existingWithValues.map((v) => ({ id: v.id, values: v.values, metadata: v.metadata })),
        });
        console.log(`[Reindex] Backup pre-delete escrito en vector-quarantine/${runId}-reindex-backup.json (${existingWithValues.length} vectores con values).`);

        // ── 9. Delete + upsert (embed-before-delete garantizado: ya hay embeddings) ──
        await deleteVectorsByMaterialId(materialId);
        await upsertChunks(newChunks);

        // ── 10. Machine-readable ids + chunkCount writeback (Loopback 2) ──
        // Pass-6 fix: un fallo del blob post-mutacion no debe marcar fallida una
        // reindexacion ya correcta; se loguea y se continua (no bloqueante).
        try {
            await saveJson(QUARANTINE_CONTAINER, `${runId}-quarantined-material-ids.json`, {
                runId,
                materialId,
                chunkCount: newChunks.length,
                quarantinedMaterialIds: [materialId],
                exportedAt: new Date().toISOString(),
            });
        } catch (idsBlobErr) {
            console.warn(`[Reindex] No se pudo escribir ${runId}-quarantined-material-ids.json (no bloqueante): ${idsBlobErr.message}`);
        }
        try {
            await upsertMaterialState({ ...authoritative, materialId, subjectId, chunkCount: newChunks.length }, 'Merge');
            console.log(`[Reindex] chunkCount=${newChunks.length} escrito de vuelta al estado del material.`);
        } catch (writebackErr) {
            console.warn(`[Reindex] No se pudo escribir chunkCount de vuelta (no bloqueante): ${writebackErr.message}`);
        }

        // ── 11. Verificacion post-reindex (Loopback 1/2/4/5) ──
        const verified = await verifyReindex({
            materialId,
            subjectId,
            expectedChunkCount: newChunks.length,
            expectedClassIds: classIds,
            expectedMaterialType: materialType,
            processed,
        });
        if (!verified) {
            console.error(`[Reindex] Verificacion fallida para ${materialId}. Restauracion: re-upsert de los vectores de vector-quarantine/${runId}-reindex-backup.json (ver docs/quarantine-reindex-runbook.md). Re-run es idempotente-safe.`);
            await trackVectorQuarantineRun({ runId, mode, materialId, chunkCount: newChunks.length, durationMs: Date.now() - startTime, success: false, errorCategory: 'REINDEX_VERIFY_FAILED' });
            return 1;
        }

        await trackVectorQuarantineRun({ runId, mode, materialId, chunkCount: newChunks.length, durationMs: Date.now() - startTime, success: true });
        console.log(`[Reindex] ${materialId} reindexado OK (${newChunks.length} chunks).`);
        return 0;
    } catch (err) {
        const durationMs = Date.now() - startTime;
        // Loopback 4: abort paths emiten telemetria success:false antes de re-throw.
        // Dry-run no emite telemetria (patch de review #11).
        if (!dryRun) {
            if (err instanceof CliExitError) {
                await trackVectorQuarantineRun({ runId, mode, materialId, durationMs, success: false, errorCategory: err.category, errorMessage: err.message });
            } else {
                await trackVectorQuarantineRun({ runId, mode, materialId, durationMs, success: false, errorCategory: 'REINDEX_ERROR', errorMessage: err.message });
            }
        }
        console.error(`[Reindex] ${err instanceof CliExitError ? 'Abortado' : 'Error fatal'}: ${err.message}`);
        throw err;
    }
}

/**
 * Entry point del CLI. Retorna el exit code (no llama a process.exit).
 */
export async function runCli(argv = process.argv.slice(2), env = process.env) {
    const args = parseQuarantineArgs(argv, env);

    if (args.showHelp) {
        printUsage();
        return 0;
    }

    if (args.reindexMaterialInvalid) {
        console.error('[Quarantine] --reindex-material requiere formato <subjectId>:<materialId> (ej: arq-software-2026:mat-123). Abortando sin escanear (exit 2).');
        return 2;
    }

    if (args.reindexMaterial) {
        if (args.resume) {
            console.warn('[Reindex] ADVERTENCIA: --resume no aplica en modo reindex (el reindex es idempotente por material). Se ignora.');
        }
        try {
            return await reindexMaterialMode({
                subjectId: args.reindexMaterial.subjectId,
                materialId: args.reindexMaterial.materialId,
                isDryRun: args.isDryRun,
            });
        } catch (err) {
            if (err instanceof CliExitError) return err.exitCode;
            console.error('[Reindex] Error fatal:', err);
            return 1;
        }
    }

    return await quarantineMode({ checkpointFile: args.checkpointFile, resume: args.resume, isDryRun: args.isDryRun });
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
    const code = await runCli();
    process.exit(code);
}
