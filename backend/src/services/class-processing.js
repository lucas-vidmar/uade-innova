/**
 * class-processing.js — #419 (UJ-43)
 *
 * "Clases procesadas" cannot be the same number as "Clases cargadas". The
 * director dashboard painted `totalClasses` (the number of rows in the Classes
 * table) under both labels, and the KPI export did the same, so the second
 * metric was identical to the first by construction and could not inform
 * anything about how much material actually got processed.
 *
 * Criterion (product decision, 2026-10-16): a class is *processed* when it has
 * at least one approved derivative — a synthesis (class-summaries) or a concept
 * map (class-maps) endorsed by the teacher. A class with material loaded but no
 * approved derivative is *loaded*, not processed. Teacher endorsement is
 * recorded in two places and either one counts: `validated === true` on the
 * derivative asset, or the class-level approval mark (`summaryReady`) that the
 * teacher's publish action persists on the Classes table.
 *
 * When the data is not enough to decide for a given class (unreadable row, or a
 * derivative that exists but cannot be read), the class is reported as NOT
 * COMPUTABLE instead of being counted as processed.
 */
import { getTableClient, listBlobs, loadJson } from './storage.js';
import { CONFIG } from './config.js';

export const CLASS_PROCESSED_CRITERIA = 'Clase procesada: tiene al menos una síntesis o un mapa avalado por el docente '
    + '(aprobación registrada en la clase o en el derivado). Una clase con material cargado pero sin derivado avalado '
    + 'cuenta como cargada, no como procesada.';

// Class AI assets live scoped by subject since #328.
const SUMMARY_CONTAINER = 'class-summaries';
const MAP_CONTAINER = 'class-maps';
const DERIVATIVE_CONTAINERS = [SUMMARY_CONTAINER, MAP_CONTAINER];

/** A derivative counts as approved only with the teacher's explicit validation. */
export function isApprovedDerivative(asset) {
    return !!asset && asset.validated === true;
}

/** The publish action persists the teacher's approval on the class row itself. */
export function isClassMarkedApproved(entity) {
    return !!entity && entity.summaryReady === true;
}

/**
 * Mirrors `loadSubjectScopedAsset` (#328): the subject-scoped blob wins; the
 * legacy `{classId}.json` blob is only honored when it belongs to the same
 * subject (or carries no subjectId at all). Only names that exist in the
 * listing are read, so missing derivatives cost nothing.
 */
export function resolveDerivativeBlobName(blobNames, subjectId, classId) {
    const scoped = subjectId ? `${subjectId}/${classId}.json` : null;
    if (scoped && blobNames.has(scoped)) return { name: scoped, scoped: true };
    const legacy = `${classId}.json`;
    if (blobNames.has(legacy)) return { name: legacy, scoped: false };
    return null;
}

function keepLegacyForSubject(asset, subjectId, scoped) {
    if (scoped) return true;
    if (!asset || !asset.subjectId || !subjectId) return true;
    return String(asset.subjectId) === String(subjectId);
}

async function loadDerivative(container, blobNames, subjectId, classId) {
    const resolved = resolveDerivativeBlobName(blobNames, subjectId, classId);
    if (!resolved) return { asset: null, readFailed: false };
    try {
        const asset = await loadJson(container, resolved.name);
        if (!keepLegacyForSubject(asset, subjectId, resolved.scoped)) return { asset: null, readFailed: false };
        return { asset, readFailed: false };
    } catch (err) {
        // The name was listed, so the blob exists: failing to read it is a
        // missing datum, not an absent derivative.
        return { asset: null, readFailed: true, error: err };
    }
}

/**
 * Counts the population of the Classes table once, classifying each row:
 * loaded (total), processed (has an approved derivative) and not computable.
 *
 * @param {{ log?: { warn?: Function } }} [context]
 * @returns {Promise<{ totalClasses: number, processedClasses: number, notComputableClasses: number, criteria: string }>}
 */
export async function computeClassProcessingStats(context) {
    const result = {
        totalClasses: 0,
        processedClasses: 0,
        notComputableClasses: 0,
        criteria: CLASS_PROCESSED_CRITERIA,
    };

    const blobNamesByContainer = new Map();
    for (const container of DERIVATIVE_CONTAINERS) {
        try {
            blobNamesByContainer.set(container, new Set(await listBlobs(container)));
        } catch (err) {
            context?.log?.warn?.(`[class-processing] Could not list ${container}: ${err.message}`);
            blobNamesByContainer.set(container, new Set());
        }
    }

    try {
        const classesClient = getTableClient(CONFIG.tables.classes);
        for await (const entity of classesClient.listEntities()) {
            result.totalClasses++;

            const classId = entity?.rowKey || entity?.classId || entity?.id;
            const subjectId = entity?.partitionKey || entity?.subjectId || '';
            if (!classId) {
                result.notComputableClasses++;
                continue;
            }
            if (isClassMarkedApproved(entity)) {
                result.processedClasses++;
                continue;
            }

            let approved = false;
            let readFailed = false;
            for (const container of DERIVATIVE_CONTAINERS) {
                const { asset, readFailed: failed } = await loadDerivative(
                    container,
                    blobNamesByContainer.get(container),
                    subjectId,
                    classId,
                );
                if (failed) readFailed = true;
                if (isApprovedDerivative(asset)) approved = true;
            }

            if (approved) result.processedClasses++;
            else if (readFailed) result.notComputableClasses++;
        }
    } catch (err) {
        context?.log?.warn?.(`[class-processing] Could not count classes: ${err.message}`);
    }

    return result;
}
