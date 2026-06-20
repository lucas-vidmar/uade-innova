import { app } from '@azure/functions';
import { parseClientPrincipal, validateFrontDoorId, getAuthenticatedUser } from '../services/auth-utils.js';
import { getEnrollment } from '../services/state-store.js';
import { getSubjectWeights, upsertSubjectWeights, DEFAULT_WEIGHTS } from '../services/subject-weights.js';
import { withCorrelation } from '../middleware/with-correlation.js';

app.http('subject-weights-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'subject-weights/{subjectId}',
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const subjectId = request.params.subjectId;
        if (!subjectId) return { status: 400, body: JSON.stringify({ error: 'subjectId es requerido.' }) };
        try {
            const result = await getSubjectWeights(subjectId);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: result.weights, defaults: result.defaults }),
            };
        } catch (err) {
            context.error('[SubjectWeights] Error getting weights:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error al obtener la configuración de pesos.' }) };
        }
    })
});

app.http('subject-weights-put', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'subject-weights/{subjectId}',
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const subjectId = request.params.subjectId;
        if (!subjectId) return { status: 400, body: JSON.stringify({ error: 'subjectId es requerido.' }) };
        const principal = parseClientPrincipal(request);
        const userRoles = principal?.userRoles || [];
        const isDirectorOrAdmin = userRoles.includes('Director') || userRoles.includes('Admin');
        const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isDirectorOrAdmin && !isDev) {
            const isTeacher = userRoles.includes('Docente');
            if (!isTeacher) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Se requiere rol Docente, Director o Admin.' }) };
            const { userId } = getAuthenticatedUser(request);
            const enrollment = await getEnrollment(subjectId, userId).catch(() => null);
            if (!enrollment || enrollment.role !== 'teacher') {
                return { status: 403, body: JSON.stringify({ error: 'Forbidden - No estás asignado como docente de esta materia.' }) };
            }
        }
        let body;
        try {
            body = await request.json();
        } catch {
            return { status: 400, body: JSON.stringify({ error: 'Body JSON inválido.' }) };
        }
        const weights = body.weights || body;
        const { userId } = getAuthenticatedUser(request);
        try {
            const result = await upsertSubjectWeights(subjectId, weights, userId);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: result.weights, defaults: result.defaults }),
            };
        } catch (err) {
            context.error('[SubjectWeights] Error upserting weights:', err);
            return { status: 400, body: JSON.stringify({ error: err.message || 'Error al guardar la configuración de pesos.' }) };
        }
    })
});
