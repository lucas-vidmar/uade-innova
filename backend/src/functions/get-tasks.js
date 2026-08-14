import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { withAuth } from '../middleware/with-auth.js';
/**
 * get-tasks.js — GET /api/tasks?studentId={id}
 * Retorna las tareas priorizadas del alumno desde el SGA.
 */
import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';
import { loadJson } from '../services/storage.js';
import { CONFIG } from '../services/config.js';

const CONTAINER_TASKS = CONFIG.containers.tasks;

app.http('get-tasks', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'tasks',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        context.log('get-tasks triggered');

        const studentId = request.query.get('studentId');
        if (!studentId) {
            return {
                status: 400,
                body: JSON.stringify({ error: 'Parámetro requerido: studentId' }),
            };
        }

        // Security Check: Identity validation
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

        // Cargar tareas desde storage; si no hay, devolver array vacío
        let tasks = [];
        try {
            const saved = await loadJson(CONTAINER_TASKS, `${studentId}.json`);
            if (Array.isArray(saved)) tasks = saved;
        } catch (err) {
            context.log(`[get-tasks] No tasks found for student ${studentId}: ${err.message}`);
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tasks),
        };
    }))
});
