/**
 * functions/vector-index-api.js — Superficie de inspección y reparación del
 * índice de conocimiento por unidad (issue #452, UJ-59).
 *
 * Por qué existe: `vector-health` informa métricas agregadas del índice
 * (`getIndexStats`) y no hay ninguna superficie que responda "qué fragmentos
 * están indexados para esta unidad" ni que permita sacar del índice un material
 * que quedó asociado a la unidad equivocada. El clasificador de conflicto
 * (`services/vector-audit.js`) y la marca de cuarentena ya existían, pero sólo
 * se invocaban desde `scripts/quarantine-reindex-vectors.js`, fuera del producto.
 *
 *   GET  /api/vector-index?subjectId=<id>
 *     Lista cada material presente en el índice para esa unidad con su veredicto
 *     contra el registro autoritativo (Material en Table Storage):
 *       ok                  — coincide con su registro
 *       orphan              — no hay registro autoritativo (material de otra
 *                             unidad/retirado: el índice lo sirve y el producto
 *                             no lo reconoce)
 *       mismatch            — el registro existe pero el metadata no coincide
 *                             (subjectId/classIds)
 *       metadata-incomplete — registro o metadata insuficiente para decidir
 *     `truncated: true` cuando el escaneo se cortó por la cota de costo: la
 *     lista nunca se presenta como cerrada si no lo es.
 *
 *   POST /api/vector-index/quarantine
 *     body: { subjectId, materialIds: [], force?: boolean, reason?: string }
 *     Saca del índice (cuarentena, `quarantined: true`) los materiales pedidos,
 *     re-verifica después de escribir, deja el registro de la corrida en el
 *     contenedor `vector-quarantine/` y emite telemetría. Un material sin
 *     conflicto no se toca salvo `force: true`.
 *
 * Roles: Docente (con matrícula activa en la unidad), Director y Admin.
 */
import { app } from '@azure/functions';
import { v4 as uuidv4 } from 'uuid';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { listAllVectorIds, fetchVectorsByIds, upsertChunks, getIndexStats } from '../services/vector-store.js';
import { getMaterialState, getEnrollment } from '../services/state-store.js';
import { detectVectorConflict, buildQuarantineMetadata, isQuarantined } from '../services/vector-audit.js';
import { saveJson } from '../services/storage.js';
import { trackVectorQuarantineRun } from '../services/telemetry.js';

const FETCH_BATCH_SIZE = 500;
// Cota de costo por corrida: el escaneo es O(índice) y esto corre en Consumption.
const MAX_SCANNED_VECTORS = 20000;
const MAX_MATERIALS_PER_REQUEST = 200;
const QUARANTINE_CONTAINER = 'vector-quarantine';
const VERIFY_ATTEMPTS = 3;
const VERIFY_DELAY_MS = 1000;

const SCOPE_ROLES = ['docente', 'director', 'admin'];

function jsonResponse(status, payload) {
    return { status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

function hasRole(principal, role) {
    return (principal?.userRoles || []).some((r) => String(r).trim().toLowerCase() === role);
}

/**
 * Autoriza por unidad: Director y Admin son transversales; un Docente necesita
 * matrícula activa en la unidad (mismo criterio que `get-classes`).
 */
async function authorizeSubject(request, subjectId) {
    const principal = parseClientPrincipal(request);
    if (!principal) {
        return { error: jsonResponse(401, { error: 'Se requiere autenticación.', code: 'AUTH_REQUIRED' }) };
    }
    if (hasRole(principal, 'director') || hasRole(principal, 'admin')) {
        return { userId: principal.userId || principal.oid || null };
    }
    if (!SCOPE_ROLES.some((role) => hasRole(principal, role))) {
        return { error: jsonResponse(403, { error: 'Forbidden - Docente, Director o Admin', code: 'ROLE_REQUIRED' }) };
    }

    const userId = principal.userId || principal.oid || 'anonymous';
    try {
        const enrollment = await getEnrollment(subjectId, userId);
        if (!enrollment || enrollment.status !== 'active') {
            return { error: jsonResponse(403, { error: 'No tenés acceso a esta unidad.', code: 'ENROLLMENT_INACTIVE' }) };
        }
    } catch (err) {
        return { error: jsonResponse(500, { error: `No se pudo verificar el acceso: ${err.message}`, code: 'ENROLLMENT_CHECK_FAILED' }) };
    }
    return { userId };
}

function normalizeSubjectId(raw) {
    const value = String(raw || '').trim();
    return value && value !== 'undefined' && value !== 'null' ? value : '';
}

/**
 * Trae los vectores del índice cuyo metadata declara pertenecer a la unidad.
 * Devuelve `truncated` cuando se alcanzó la cota y quedaron páginas sin leer.
 */
export async function collectSubjectVectors(subjectId, deps = {}) {
    const listAll = deps.listAllVectorIds || listAllVectorIds;
    const fetchByIds = deps.fetchVectorsByIds || fetchVectorsByIds;

    const allIds = await listAll();
    const truncated = allIds.length > MAX_SCANNED_VECTORS;
    const ids = truncated ? allIds.slice(0, MAX_SCANNED_VECTORS) : allIds;

    const vectors = [];
    for (let i = 0; i < ids.length; i += FETCH_BATCH_SIZE) {
        const batch = ids.slice(i, i + FETCH_BATCH_SIZE);
        const { vectors: fetched } = await fetchByIds(batch);
        for (const vector of fetched) {
            const meta = vector.metadata || {};
            if (String(meta.subjectId || '') !== String(subjectId)) continue;
            vectors.push(vector);
        }
    }

    return { vectors, scanned: ids.length, truncated };
}

/**
 * Total de vectores que el propio índice declara tener (#452, UJ-59). Se usa
 * para distinguir "la unidad no tiene fragmentos indexados" de "el escaneo no
 * enumeró nada": `/vectors/list` puede devolver vacío mientras el índice sí
 * tiene vectores, y una lista vacía no debe presentarse como la verdad de la
 * unidad. Devuelve `null` cuando no se pudo leer el total (no se inventa 0).
 */
export async function readIndexTotalVectorCount(deps = {}) {
    const stats = deps.getIndexStats || getIndexStats;
    try {
        const payload = await stats();
        const total = Number(payload?.totalVectorCount);
        return Number.isFinite(total) ? total : null;
    } catch {
        return null;
    }
}

/**
 * El escaneo no enumeró ningún vector pero el índice declara tener vectores:
 * la lectura falló y no hay que tratarla como "unidad sin material indexado".
 */
export function isBlindScan(scanned, indexTotalVectorCount) {
    return Number(scanned) === 0 && Number(indexTotalVectorCount) > 0;
}

function verdictFor(meta, materialState) {
    const conflict = detectVectorConflict(meta, materialState);
    if (!materialState) return { verdict: 'orphan', reasons: ['no-authoritative-material'], conflict };
    if (conflict.conflict && conflict.reasons.includes('metadata-incomplete')) return { verdict: 'metadata-incomplete', reasons: conflict.reasons, conflict };
    if (conflict.conflict) return { verdict: 'mismatch', reasons: conflict.reasons, conflict };
    return { verdict: 'ok', reasons: [], conflict };
}

/**
 * Agrupa por materialId y clasifica cada grupo contra su registro autoritativo.
 */
export async function classifySubjectVectors(subjectId, vectors, deps = {}) {
    const resolveMaterial = deps.getMaterialState || getMaterialState;

    const byMaterial = new Map();
    for (const vector of vectors) {
        const meta = vector.metadata || {};
        const materialId = meta.materialId || vector.id;
        const entry = byMaterial.get(materialId) || { materialId, vectors: [], metadata: meta };
        entry.vectors.push(vector);
        byMaterial.set(materialId, entry);
    }

    const groups = [];
    for (const entry of byMaterial.values()) {
        let materialState = null;
        let lookupFailed = false;
        try {
            materialState = await resolveMaterial(subjectId, entry.materialId);
        } catch {
            lookupFailed = true;
        }

        const { verdict, reasons, conflict } = lookupFailed
            ? { verdict: 'metadata-incomplete', reasons: ['material-lookup-failed'], conflict: null }
            : verdictFor(entry.metadata, materialState);

        groups.push({
            materialId: entry.materialId,
            sourceFilename: entry.metadata.sourceFilename || null,
            materialType: entry.metadata.materialType || null,
            classId: entry.metadata.classId ?? entry.metadata.classIds?.[0] ?? null,
            classIds: Array.isArray(entry.metadata.classIds) ? entry.metadata.classIds : [],
            chunkCount: entry.vectors.length,
            quarantined: entry.vectors.every((v) => isQuarantined(v.metadata)),
            registered: Boolean(materialState),
            verdict,
            reasons,
            expectedSubjectId: conflict?.expectedSubjectId ?? null,
            expectedClassIds: conflict?.expectedClassIds ?? [],
        });
    }

    groups.sort((a, b) => (a.verdict === 'ok' ? 1 : 0) - (b.verdict === 'ok' ? 1 : 0)
        || String(a.sourceFilename || a.materialId).localeCompare(String(b.sourceFilename || b.materialId)));
    return groups;
}

function summarize(groups) {
    const counts = { ok: 0, orphan: 0, mismatch: 0, 'metadata-incomplete': 0 };
    let quarantined = 0;
    for (const group of groups) {
        counts[group.verdict] = (counts[group.verdict] || 0) + 1;
        if (group.quarantined) quarantined += 1;
    }
    return { ...counts, materials: groups.length, quarantined };
}

app.http('vector-index', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'vector-index',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

        const subjectId = normalizeSubjectId(request.query?.get?.('subjectId'));
        if (!subjectId) return jsonResponse(400, { error: 'Falta subjectId', code: 'MISSING_SUBJECT' });

        const authz = await authorizeSubject(request, subjectId);
        if (authz.error) return authz.error;

        try {
            const { vectors, scanned, truncated } = await collectSubjectVectors(subjectId);
            const indexTotalVectorCount = await readIndexTotalVectorCount();
            if (isBlindScan(scanned, indexTotalVectorCount)) {
                context.warn?.(`[VectorIndex] Escaneo ciego para ${subjectId}: scanned=0 con índice de ${indexTotalVectorCount} vectores.`);
                return jsonResponse(502, {
                    error: `No se pudo leer el índice de la unidad: el escaneo no enumeró ningún vector aunque el índice declara tener ${indexTotalVectorCount}. No se presenta una lista vacía como si la unidad no tuviera material indexado.`,
                    code: 'INDEX_SCAN_INCOMPLETE',
                    subjectId,
                    scanned,
                    indexTotalVectorCount,
                    correlationId: context?.correlationId || null,
                });
            }
            const groups = await classifySubjectVectors(subjectId, vectors);
            return jsonResponse(200, {
                subjectId,
                scanned,
                truncated,
                indexTotalVectorCount,
                totalInUnit: vectors.length,
                counts: summarize(groups),
                groups,
                generatedAt: new Date().toISOString(),
                correlationId: context?.correlationId || null,
            });
        } catch (err) {
            context.error('[VectorIndex] Error leyendo el índice:', err);
            return jsonResponse(500, { error: `No se pudo leer el índice: ${err.message}`, code: 'INDEX_READ_FAILED', correlationId: context?.correlationId || null });
        }
    })),
});

async function verifyQuarantined(subjectId, materialIds, deps = {}) {
    const listAll = deps.listAllVectorIds || listAllVectorIds;
    const fetchByIds = deps.fetchVectorsByIds || fetchVectorsByIds;

    for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
        const { vectors } = await collectSubjectVectors(subjectId, { listAllVectorIds: listAll, fetchVectorsByIds: fetchByIds });
        const pending = vectors.filter((v) => materialIds.includes(v.metadata?.materialId));
        const notQuarantined = pending.filter((v) => !isQuarantined(v.metadata));
        if (pending.length > 0 && notQuarantined.length === 0) {
            return { verified: true, remaining: [], attempts: attempt };
        }
        if (attempt < VERIFY_ATTEMPTS) await new Promise((r) => setTimeout(r, VERIFY_DELAY_MS));
    }

    const { vectors } = await collectSubjectVectors(subjectId, { listAllVectorIds: listAll, fetchVectorsByIds: fetchByIds });
    const remaining = [...new Set(vectors
        .filter((v) => materialIds.includes(v.metadata?.materialId) && !isQuarantined(v.metadata))
        .map((v) => v.metadata?.materialId))];
    return { verified: remaining.length === 0, remaining, attempts: VERIFY_ATTEMPTS };
}

app.http('vector-index-quarantine', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'vector-index/quarantine',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse(400, { error: 'Body JSON inválido', code: 'INVALID_JSON' });
        }

        const subjectId = normalizeSubjectId(body?.subjectId);
        if (!subjectId) return jsonResponse(400, { error: 'Falta subjectId', code: 'MISSING_SUBJECT' });

        const materialIds = Array.isArray(body?.materialIds)
            ? [...new Set(body.materialIds.map((id) => String(id || '').trim()).filter(Boolean))]
            : [];
        if (materialIds.length === 0) return jsonResponse(400, { error: 'Falta materialIds', code: 'MISSING_MATERIALS' });
        if (materialIds.length > MAX_MATERIALS_PER_REQUEST) {
            return jsonResponse(400, { error: `Demasiados materialIds (máximo ${MAX_MATERIALS_PER_REQUEST})`, code: 'TOO_MANY_MATERIALS' });
        }

        const force = body?.force === true;
        const authz = await authorizeSubject(request, subjectId);
        if (authz.error) return authz.error;

        const runId = uuidv4();
        const startedAt = Date.now();
        try {
            const { vectors, scanned, truncated } = await collectSubjectVectors(subjectId);
            const indexTotalVectorCount = await readIndexTotalVectorCount();
            if (isBlindScan(scanned, indexTotalVectorCount)) {
                context.warn?.(`[VectorIndex] Cuarentena abortada: escaneo ciego para ${subjectId} (scanned=0, índice de ${indexTotalVectorCount} vectores).`);
                return jsonResponse(502, {
                    error: `No se pudo purgar: el escaneo del índice no enumeró ningún vector aunque el índice declara tener ${indexTotalVectorCount}. Se aborta en vez de informar los materiales pedidos como "fuera de la unidad".`,
                    code: 'INDEX_SCAN_INCOMPLETE',
                    subjectId,
                    scanned,
                    indexTotalVectorCount,
                    correlationId: context?.correlationId || null,
                });
            }
            const groups = await classifySubjectVectors(subjectId, vectors);
            const byMaterial = new Map(groups.map((g) => [g.materialId, g]));

            const applied = [];
            const skipped = [];
            const notInUnit = [];
            const toQuarantine = [];

            for (const materialId of materialIds) {
                const group = byMaterial.get(materialId);
                if (!group) {
                    notInUnit.push(materialId);
                    continue;
                }
                if (group.verdict === 'ok' && !force) {
                    skipped.push({ materialId, verdict: group.verdict, reason: 'sin-conflicto' });
                    continue;
                }
                if (group.quarantined) {
                    skipped.push({ materialId, verdict: group.verdict, reason: 'ya-en-cuarentena' });
                    continue;
                }
                toQuarantine.push(materialId);
            }

            if (toQuarantine.length > 0) {
                const payload = vectors
                    .filter((v) => toQuarantine.includes(v.metadata?.materialId))
                    .map((v) => {
                        const group = byMaterial.get(v.metadata?.materialId);
                        return {
                            id: v.id,
                            values: v.values || [],
                            metadata: buildQuarantineMetadata(v.metadata, {
                                reasons: group?.reasons || [],
                                expectedSubjectId: group?.expectedSubjectId ?? null,
                                expectedClassIds: group?.expectedClassIds || [],
                            }),
                        };
                    });
                await upsertChunks(payload);
                for (const materialId of toQuarantine) {
                    const group = byMaterial.get(materialId);
                    applied.push({ materialId, verdict: group.verdict, reasons: group.reasons, vectors: group.chunkCount });
                }
            }

            const verification = toQuarantine.length > 0
                ? await verifyQuarantined(subjectId, toQuarantine)
                : { verified: true, remaining: [], attempts: 0 };

            const record = {
                runId,
                action: 'index-quarantine',
                subjectId,
                requestedBy: authz.userId,
                correlationId: context?.correlationId || null,
                requested: materialIds,
                applied,
                skipped,
                notInUnit,
                verification,
                scanned,
                indexTotalVectorCount,
                truncated,
                startedAt: new Date(startedAt).toISOString(),
                finishedAt: new Date().toISOString(),
            };
            let auditBlob = null;
            try {
                await saveJson(QUARANTINE_CONTAINER, `${runId}-index-quarantine.json`, record);
                auditBlob = `${QUARANTINE_CONTAINER}/${runId}-index-quarantine.json`;
            } catch (auditErr) {
                context.warn?.(`[VectorIndex] No se pudo escribir el registro de la corrida: ${auditErr.message}`);
            }

            await trackVectorQuarantineRun({
                runId,
                mode: 'index-quarantine',
                scanned: record.scanned,
                clean: groups.filter((g) => g.verdict === 'ok').length,
                quarantined: applied.length,
                unresolvable: groups.filter((g) => g.verdict === 'orphan').length,
                failed: verification.verified ? 0 : verification.remaining.length,
                durationMs: Date.now() - startedAt,
                success: verification.verified,
                errorCategory: verification.verified ? undefined : 'INDEX_QUARANTINE_UNVERIFIED',
            });

            return jsonResponse(200, { runId, subjectId, applied, skipped, notInUnit, verification, truncated, auditBlob });
        } catch (err) {
            context.error('[VectorIndex] Error en la cuarentena del índice:', err);
            await trackVectorQuarantineRun({
                runId,
                mode: 'index-quarantine',
                durationMs: Date.now() - startedAt,
                success: false,
                errorCategory: 'INDEX_QUARANTINE_FAILED',
                errorMessage: err.message,
            }).catch(() => {});
            return jsonResponse(500, { error: `No se pudo purgar el índice: ${err.message}`, code: 'INDEX_QUARANTINE_FAILED', correlationId: context?.correlationId || null });
        }
    })),
});
