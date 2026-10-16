/**
 * #428 — Estado de publicación único.
 *
 * El estado de publicación vivía en dos lugares que se contradecían:
 * `summaryReady` en la clase y `validated` en el resumen. El docente no sabía
 * qué veía el alumnado y la alumna podía abrir una clase que el docente creía
 * en borrador. Ahora hay un único estado explícito con tres valores, y los
 * booleanos heredados pasan a ser espejos derivados de ese estado:
 *
 *   - `summaryReady` (clase)   = (publicationState === 'publicado')
 *   - `validated`    (derivado) = (publicationState === 'publicado')
 *
 * Los datos ya guardados sin `publicationState` se interpretan como `publicado`
 * cuando su booleano heredado estaba en true, para no retirar contenido que la
 * unidad ya estaba viendo.
 */

export const PUBLICATION_STATES = ['borrador', 'pendiente_de_aval', 'publicado'];

export const DEFAULT_PUBLICATION_STATE = 'borrador';

export const PUBLICATION_STATE_LABELS = {
    borrador: 'Borrador',
    pendiente_de_aval: 'Pendiente de aval',
    publicado: 'Publicado',
};

export const PUBLICATION_STATE_DESCRIPTIONS = {
    borrador: 'No visible para el alumnado. Sólo vos podés verlo.',
    pendiente_de_aval: 'No visible para el alumnado: enviado a revisión y esperando el aval.',
    publicado: 'Visible para el alumnado de la unidad y avisado en su centro de notificaciones.',
};

export function isPublicationState(value) {
    return PUBLICATION_STATES.includes(String(value ?? '').trim());
}

/**
 * Normaliza un estado explícito y, cuando falta, lo deriva del booleano heredado.
 * @param {string|undefined|null} value estado explícito
 * @param {boolean} legacyPublished valor heredado (`summaryReady` o `validated`)
 */
export function normalizePublicationState(value, legacyPublished = false) {
    const raw = String(value ?? '').trim();
    if (PUBLICATION_STATES.includes(raw)) return raw;
    return legacyPublished === true ? 'publicado' : DEFAULT_PUBLICATION_STATE;
}

export function isPublished(state) {
    return state === 'publicado';
}

/** Estado de un derivado (resumen, mapa conceptual, guión de podcast). */
export function resolveAssetPublicationState(asset = {}) {
    const safe = asset || {};
    return normalizePublicationState(safe.publicationState, safe.validated === true);
}

/** Estado de una clase, tal como lo ve el docente y lo respeta el alumnado. */
export function resolveClassPublicationState(classData = {}) {
    const safe = classData || {};
    return normalizePublicationState(safe.publicationState, safe.summaryReady === true);
}

function appendPublicationHistory(history, entry) {
    const list = Array.isArray(history) ? history.filter((item) => item && typeof item === 'object') : [];
    list.push(entry);
    // El historial es la constancia de ida y vuelta (publicar / retirar /
    // reenviar a revisión); se conservan los últimos cambios y no se borra.
    return list.slice(-20);
}

export function nextPublicationHistory(history, entry) {
    return appendPublicationHistory(history, entry);
}

/**
 * Aplica una transición de estado a un derivado dejando constancia de quién,
 * cuándo y por qué. Mantiene el espejo `validated` coherente con el estado.
 */
export function applyPublicationStateToAsset(asset = {}, { state, by, at, reason } = {}) {
    const safe = asset || {};
    const previousState = resolveAssetPublicationState(safe);
    const changedAt = at || new Date().toISOString();
    const changedBy = by || 'docente';
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : undefined;

    const next = {
        ...safe,
        publicationState: state,
        publicationChangedBy: changedBy,
        publicationChangedAt: changedAt,
        publicationChangedReason: cleanReason,
        publicationHistory: appendPublicationHistory(safe.publicationHistory, {
            from: previousState,
            to: state,
            by: changedBy,
            at: changedAt,
            reason: cleanReason,
        }),
        // Espejo de lectura del contrato heredado.
        validated: isPublished(state),
    };

    if (isPublished(state)) {
        next.validatedBy = changedBy;
        next.validatedAt = changedAt;
    }

    return next;
}
