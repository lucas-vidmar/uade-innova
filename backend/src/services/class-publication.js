import { loadJson, saveJson } from './storage.js';
import { listClassesBySubject, upsertClassPublicationState } from './state-store.js';
import { dispatchClassSummaryNotification, retractClassSummaryNotification } from './notification-store.js';
import {
    applyPublicationStateToAsset,
    isPublicationState,
    isPublished,
    resolveClassPublicationState,
} from './publication-state.js';
import { CONFIG } from '../config.js';

const CONTAINER_CLASSES = CONFIG.containers.classes;

// Los derivados de una clase comparten el mismo estado de publicación: el
// docente decide una vez y el alumnado ve exactamente eso.
export const DERIVED_ASSET_CONTAINERS = ['class-summaries', 'class-maps', 'class-audio-scripts'];

/** #328: los activos se guardan con alcance de materia en `{subjectId}/{classId}.json`. */
export async function loadSubjectScopedAsset(container, subjectId, classId) {
    const scoped = await loadJson(container, `${subjectId}/${classId}.json`).catch(() => null);
    if (scoped) return scoped;
    const legacy = await loadJson(container, `${classId}.json`).catch(() => null);
    if (!legacy) return null;
    if (legacy.subjectId && String(legacy.subjectId) !== String(subjectId)) return null;
    return legacy;
}

function hasSummaryContent(asset) {
    if (!asset) return false;
    const summary = asset.summary;
    const text = typeof summary === 'string' ? summary : (summary?.content || '');
    return String(text || '').trim().length > 0;
}

export async function loadClassData(subjectId, classId) {
    try {
        const classes = await listClassesBySubject(subjectId);
        const fromTable = classes.find((item) => String(item.id) === String(classId));
        if (fromTable) return fromTable;
    } catch {
        // La tabla puede no estar disponible: seguimos con el blob.
    }
    const list = await loadJson(CONTAINER_CLASSES, `${subjectId}.json`).catch(() => null);
    if (!Array.isArray(list)) return null;
    return list.find((item) => String(item?.id) === String(classId)) || null;
}

async function patchClassBlob(subjectId, classId, change) {
    const list = await loadJson(CONTAINER_CLASSES, `${subjectId}.json`).catch(() => null);
    if (!Array.isArray(list)) return false;
    const idx = list.findIndex((item) => String(item?.id) === String(classId));
    if (idx < 0) return false;
    const next = [...list];
    next[idx] = {
        ...next[idx],
        publicationState: change.state,
        summaryReady: isPublished(change.state),
        publicationChangedBy: change.by,
        publicationChangedAt: change.at,
        publicationChangedReason: change.reason,
    };
    await saveJson(CONTAINER_CLASSES, `${subjectId}.json`, next);
    return true;
}

export class PublicationStateError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'PublicationStateError';
        this.status = status;
    }
}

/**
 * #428 — Único camino de escritura del estado de publicación.
 *
 * Escribe el mismo estado en la clase (tabla y blob) y en todos sus derivados
 * existentes, deja constancia de quién y cuándo, y hace que el aviso de
 * «resumen validado» sea consecuencia del estado: se emite sólo al publicar y
 * se retira cuando la clase deja de estar publicada.
 */
export async function applyClassPublicationChange({
    subjectId,
    classId,
    state,
    by,
    reason,
    origin = 'class-publication',
} = {}) {
    if (!subjectId || !classId) {
        throw new PublicationStateError('subjectId y classId son requeridos', 400);
    }
    if (!isPublicationState(state)) {
        throw new PublicationStateError(`Estado de publicación inválido: ${state}`, 400);
    }

    const classData = await loadClassData(subjectId, classId);
    if (!classData) {
        throw new PublicationStateError('Clase no encontrada', 404);
    }

    const previousState = resolveClassPublicationState(classData);
    if (previousState === state) {
        return {
            changed: false,
            subjectId,
            classId,
            previousState,
            publicationState: state,
            summaryReady: isPublished(state),
            derivados: [],
        };
    }

    const summaryAsset = await loadSubjectScopedAsset('class-summaries', subjectId, classId);
    if (isPublished(state) && !hasSummaryContent(summaryAsset)) {
        throw new PublicationStateError('La clase no tiene un resumen para publicar.', 409);
    }

    const change = {
        state,
        by: by || 'docente',
        at: new Date().toISOString(),
        reason: typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : undefined,
    };

    const derivados = [];
    for (const container of DERIVED_ASSET_CONTAINERS) {
        const asset = await loadSubjectScopedAsset(container, subjectId, classId);
        if (!asset || Object.keys(asset).length === 0) continue;
        const updated = applyPublicationStateToAsset(asset, change);
        await saveJson(container, `${subjectId}/${classId}.json`, updated);
        derivados.push(container);
    }

    await upsertClassPublicationState(subjectId, classId, {
        publicationState: state,
        by: change.by,
        at: change.at,
        reason: change.reason,
        classData,
    });
    await patchClassBlob(subjectId, classId, change);

    // El aviso acompaña al hecho de publicar; con la clase retirada no se emite
    // y el aviso anterior desaparece para no anunciar algo que ya no se puede abrir.
    let notification;
    if (isPublished(state)) {
        notification = await dispatchClassSummaryNotification({
            subjectId,
            classData: { ...classData, publicationState: state },
            origin,
            change,
        });
    } else {
        notification = await retractClassSummaryNotification(subjectId, classId);
    }

    return {
        changed: true,
        subjectId,
        classId,
        previousState,
        publicationState: state,
        summaryReady: isPublished(state),
        changedBy: change.by,
        changedAt: change.at,
        reason: change.reason,
        derivados,
        notification,
    };
}
