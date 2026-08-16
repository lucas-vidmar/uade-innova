/**
 * services/vector-audit.js — Conflicto-detection puro para vectores RAG
 * (Story 10.17 / Issue #263 — QA-002).
 *
 * Funciones puras (sin I/O) usadas por el runner de cuarentena y por el
 * post-filter de rag-query/global-search. La fuente de verdad para clasificar
 * un vector es el registro autoritativo del `Material` (Table Storage).
 */

/**
 * Normaliza un valor de classIds a un array de strings.
 * - Array → filtrado/mapeado a strings.
 * - String JSON que parsea a array → se usa ese array.
 * - String JSON que parsea a NO-array (ej: '"class-01"') → fallback a
 *   comma-split (Loopback 2: nunca un array vacio silencioso).
 * - Cualquier otra string → comma-split.
 */
export function normalizeClassIds(value) {
    if (Array.isArray(value)) {
        return value.filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map(String);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map(String);
            }
            if (typeof parsed === 'string' && parsed.trim()) {
                return [parsed.trim()];
            }
            if (typeof parsed === 'number') {
                return [String(parsed)];
            }
            // parsed es objeto/booleano → fallback a comma-split
        } catch {
            // not JSON — fall through to comma-split
        }
        return trimmed.split(',').map((v) => v.trim()).filter(Boolean);
    }
    return [];
}

/**
 * Resuelve el registro autoritativo (`{ subjectId, classIds }`) a partir del
 * estado del `Material` en Table Storage, usando el registro autoritativo como
 * ground truth (NO el metadata del vector).
 *
 * @param {object} vectorMetadata - Metadata del vector (no usado para autoridad,
 *   solo compatibilidad de firma).
 * @param {object|null} materialState - Estado autoritativo del material, o null
 *   si no existe registro.
 * @returns {{subjectId: string|null, classIds: string[]}}
 *   - `materialState` null → `{ subjectId: null, classIds: [] }` (no hay registro).
 *   - Fila sin `partitionKey` ni `subjectId` → `{ subjectId: null, ... }`
 *     (Loopback 5: no se puede resolver; no es un blanket subjectId-mismatch).
 */
export function resolveAuthoritativeRecord(vectorMetadata, materialState) {
    if (!materialState) {
        return { subjectId: null, classIds: [] };
    }

    const subjectId = materialState.partitionKey || materialState.subjectId || null;

    let classIds = normalizeClassIds(materialState.classIds);
    if (typeof materialState.classIds === 'string') {
        try {
            const parsed = JSON.parse(materialState.classIds);
            if (!Array.isArray(parsed)) {
                // Loopback 2: string JSON no-array → comma-split (nunca vacio silencioso)
                classIds = normalizeClassIds(materialState.classIds);
            }
        } catch {
            classIds = normalizeClassIds(materialState.classIds);
        }
    }

    return { subjectId, classIds };
}

/**
 * Detecta si el metadata de un vector entra en conflicto con su registro
 * autoritativo.
 *
 * @param {object} vectorMetadata - Metadata del vector (subjectId/classIds/classId).
 * @param {object|null} materialState - Registro autoritativo del material, o null.
 * @returns {{conflict: boolean, reasons: string[], expectedSubjectId: string|null, expectedClassIds: string[]}}
 */
export function detectVectorConflict(vectorMetadata, materialState) {
    const meta = vectorMetadata && typeof vectorMetadata === 'object' ? vectorMetadata : {};

    // Registro autoritativo genuinamente ausente → unresolvable (quarantine).
    if (materialState === null || materialState === undefined) {
        return {
            conflict: true,
            reasons: ['no-authoritative-material'],
            expectedSubjectId: null,
            expectedClassIds: [],
        };
    }

    const authoritative = resolveAuthoritativeRecord(meta, materialState);
    const reasons = [];

    // Loopback 5: fila de material sin partitionKey/subjectId → metadata-incomplete
    // (nunca un blanket subjectId-mismatch para todos los vectores que la referencian).
    if (authoritative.subjectId === null) {
        return {
            conflict: true,
            reasons: ['metadata-incomplete'],
            expectedSubjectId: null,
            expectedClassIds: authoritative.classIds,
        };
    }

    const vectorClassIds = normalizeClassIds(meta.classIds ?? (meta.classId ? [meta.classId] : []));
    const hasSubjectId = Boolean(meta.subjectId);
    const hasClassIds = vectorClassIds.length > 0;

    // Loopback 5: vector sin subjectId NI classIds → metadata-incomplete (quarantine,
    // no se normaliza silenciosamente como clean).
    if (!hasSubjectId && !hasClassIds) {
        reasons.push('metadata-incomplete');
    }

    // Pass-6 fix: vector con subjectId correcto pero SIN classIds mientras el
    // registro autoritativo SI tiene classIds → pierde el scope por clase y se
    // filtraria como clean; se marca metadata-incomplete (quarantine).
    if (hasSubjectId && !hasClassIds && authoritative.classIds.length > 0) {
        reasons.push('metadata-incomplete');
    }

    if (hasSubjectId && String(meta.subjectId) !== String(authoritative.subjectId)) {
        reasons.push('subjectId-mismatch');
    }

    // Loopback 1: TODA entrada del array classIds del vector debe estar contenida
    // en el classIds autoritativo; cualquier miembro no autoritativo es mismatch.
    for (const entry of vectorClassIds) {
        if (!authoritative.classIds.includes(String(entry))) {
            reasons.push('classId-mismatch');
            break;
        }
    }

    return {
        conflict: reasons.length > 0,
        reasons,
        expectedSubjectId: authoritative.subjectId,
        expectedClassIds: authoritative.classIds,
    };
}

/**
 * Construye el metadata de cuarentena para un vector conflictivo.
 * Preserva todos los campos originales y agrega el flag `quarantined: true`
 * más la razon/contexto para el reporte de auditoria.
 *
 * @param {object} originalMetadata - Metadata actual del vector.
 * @param {{reasons?: string[], expectedSubjectId?: string|null, expectedClassIds?: string[]}} conflictResult
 * @returns {object} Metadata listo para re-upsert con flag de cuarentena.
 */
export function buildQuarantineMetadata(originalMetadata, conflictResult) {
    const meta = originalMetadata && typeof originalMetadata === 'object' ? originalMetadata : {};
    const conflict = conflictResult && typeof conflictResult === 'object' ? conflictResult : {};

    const reasons = Array.isArray(conflict.reasons) ? conflict.reasons : [];
    const expectedSubjectId = conflict.expectedSubjectId !== undefined ? conflict.expectedSubjectId : null;
    const expectedClassIds = Array.isArray(conflict.expectedClassIds) ? conflict.expectedClassIds : [];

    return {
        ...meta,
        quarantined: true,
        quarantineReason: reasons.length > 0 ? reasons.join(',') : 'quarantined',
        quarantinedAt: new Date().toISOString(),
        conflictSubjectId: meta.subjectId !== undefined && meta.subjectId !== null ? String(meta.subjectId) : null,
        conflictClassId: Array.isArray(meta.classIds) && meta.classIds.length > 0
            ? String(meta.classIds[0])
            : (meta.classId !== undefined && meta.classId !== null ? String(meta.classId) : null),
        expectedSubjectId,
        expectedClassIds,
    };
}

/**
 * Detecta si un metadata de vector esta marcado como cuarentenado.
 * Matcheo leniente (Loopback 2/3/5): trim + lowercase consistente sobre todas
 * las formas string (`true`/`yes`/`1`/`on`) ademas del booleano `true` y el
 * numerico `1`.
 *
 * @param {object} metadata
 * @returns {boolean}
 */
export function isQuarantined(metadata) {
    if (!metadata || typeof metadata !== 'object') return false;
    const raw = metadata.quarantined;
    if (raw === true) return true;
    if (typeof raw === 'number') return raw === 1;
    if (typeof raw === 'string') {
        return ['true', 'yes', '1', 'on'].includes(raw.trim().toLowerCase());
    }
    return false;
}
