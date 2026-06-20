import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';
import { loadJson, saveJson } from '../services/storage.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';

const CONTAINER_CLASS_TIMELINES = 'class-timelines';

app.http('get-class-timeline', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'class-timeline/{classId}',
    handler: withCorrelation(async (request) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const classId = request.params.classId;
        if (!classId) {
            return { status: 400, body: JSON.stringify({ error: 'Falta classId' }) };
        }

        const timeline = await loadJson(CONTAINER_CLASS_TIMELINES, `${classId}.json`);
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(timeline || { classId, sections: [], markers: [] }),
        };
    }),
});

app.http('save-class-timeline', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'class-timeline/{classId}',
    handler: withCorrelation(async (request) => {
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

        const payload = {
            classId,
            subjectId: body.subjectId,
            sections: Array.isArray(body.sections) ? body.sections : [],
            markers: Array.isArray(body.markers) ? body.markers : [],
            updatedAt: new Date().toISOString(),
            updatedBy: principal?.userDetails || 'teacher',
        };

        await saveJson(CONTAINER_CLASS_TIMELINES, `${classId}.json`, payload);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        };
    }),
});
