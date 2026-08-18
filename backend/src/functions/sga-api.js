import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { loadJson } from '../services/storage.js';
import { CONFIG } from '../services/config.js';

const CONTAINER_TASKS = CONFIG.containers.tasks;

app.http('sga-get-tasks', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'sga/tasks',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const studentId = request.query.get('studentId');
        if (!studentId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Parámetro requerido: studentId' }) };
        }

        // Security Check: Identity validation (self or director)
        const principal = parseClientPrincipal(request);
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const roles = principal?.userRoles || [];
        const isDirector = roles.includes('Director');
        if (!isDirector && studentId !== userId) {
            return {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'No tienes permiso para ver las tareas de otro estudiante.' })
            };
        }

        let tasks = [];
        try {
            const saved = await loadJson(CONTAINER_TASKS, `${studentId}.json`);
            if (Array.isArray(saved)) tasks = saved;
        } catch (err) {
            context.log(`[sga-get-tasks] No tasks found for student ${studentId}: ${err.message}`);
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tasks),
        };
    })),
});

app.http('sga-get-attendance', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'sga/attendance',
    handler: withCorrelation(withAuth(async (request) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some((role) => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
        }

        const subjectId = request.query.get('subjectId');
        if (!subjectId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Parámetro requerido: subjectId' }) };
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ average: null, critical: null, trend: null, subjectId, updatedAt: null }),
        };
    })),
});

app.http('sga-get-teacher-alerts', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'sga/teacher-alerts',
    handler: withCorrelation(withAuth(async (request) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some((role) => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
        }

        const subjectId = request.query.get('subjectId');
        if (!subjectId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Parámetro requerido: subjectId' }) };
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([]),
        };
    })),
});

app.http('sga-get-early-alerts', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'sga/early-alerts',
    handler: withCorrelation(withAuth(async (request) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const subjectId = request.query.get('subjectId');
        if (!subjectId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Parámetro requerido: subjectId' }) };
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([]),
        };
    })),
});
