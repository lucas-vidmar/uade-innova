import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { loadJson, saveJson } from '../services/storage.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getEnrollment } from '../services/state-store.js';

const CONTAINER_CLASS_TIMELINES = 'class-timelines';

function json(status, payload) {
    return { status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

/**
 * Scoped blob loader (#328): class timelines were keyed only by classId
 * (`{classId}.json`), so `class-01` collided across subjects (dasi-1c2023 vs
 * arq-software-2026). Reads prefer the scoped path `{subjectId}/{classId}.json`
 * and fall back to the legacy blob only when its embedded subjectId matches
 * (or is absent for pre-subject payloads).
 */
export async function loadScopedTimeline(subjectId, classId) {
    const scoped = await loadJson(CONTAINER_CLASS_TIMELINES, `${subjectId}/${classId}.json`).catch(() => null);
    if (scoped) return scoped;
    const legacy = await loadJson(CONTAINER_CLASS_TIMELINES, `${classId}.json`).catch(() => null);
    if (!legacy) return null;
    if (legacy.subjectId && String(legacy.subjectId) !== String(subjectId)) return null;
    return legacy;
}

async function requireSubjectEnrollment(request, context, subjectId) {
    const principal = parseClientPrincipal(request);
    const roles = principal?.userRoles || [];
    if (roles.includes('Docente') || roles.includes('Director') || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') {
        return null;
    }
    const userId = principal?.userId || principal?.oid || 'anonymous';
    try {
        const enrollment = await getEnrollment(subjectId, userId);
        if (!enrollment || enrollment.status !== 'active') {
            return json(403, { error: 'No tienes acceso a esta materia.' });
        }
    } catch {
        return json(500, { error: 'Error al verificar permisos de acceso.' });
    }
    return null;
}

app.http('get-class-timeline', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'class-timeline/{classId}',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const classId = request.params.classId;
        if (!classId) {
            return { status: 400, body: JSON.stringify({ error: 'Falta classId' }) };
        }

        // #328: scope by (subjectId, classId) — subjectId is required so a
        // classId shared across subjects never leaks cross-subject content.
        const subjectId = request.query?.get?.('subjectId');
        if (!subjectId) {
            return json(400, { error: 'Falta subjectId' });
        }

        const denied = await requireSubjectEnrollment(request, context, subjectId);
        if (denied) return denied;

        const timeline = await loadScopedTimeline(subjectId, classId);
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(timeline || { classId, subjectId, sections: [], markers: [] }),
        };
    })),
});

app.http('save-class-timeline', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'class-timeline/{classId}',
    handler: withCorrelation(withAuth(async (request) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
        }

        const classId = request.params.classId;
        const body = await request.json();

        // #328: persist under the scoped path so subjects never overwrite
        // each other's timeline for a shared classId.
        const subjectId = body.subjectId;
        if (!subjectId) {
            return json(400, { error: 'subjectId es requerido' });
        }

        const payload = {
            classId,
            subjectId: body.subjectId,
            sections: Array.isArray(body.sections) ? body.sections : [],
            markers: Array.isArray(body.markers) ? body.markers : [],
            updatedAt: new Date().toISOString(),
            updatedBy: principal?.userDetails || 'teacher',
        };

        await saveJson(CONTAINER_CLASS_TIMELINES, `${subjectId}/${classId}.json`, payload);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        };
    })),
});
