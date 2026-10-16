import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { parseClientPrincipal, validateFrontDoorId, getAuthenticatedUser } from '../services/auth-utils.js';
import { getEnrollment } from '../services/state-store.js';
import { getSubjectWeights, upsertSubjectWeights, DEFAULT_WEIGHTS } from '../services/subject-weights.js';
import { withCorrelation } from '../middleware/with-correlation.js';

// La ponderación de fuentes configura el acervo de una unidad: la lee quien la
// enseña o quien conduce. El GET se servía sin roles y el handler no miraba la
// identidad, así que un cliente sin sesión recibía la configuración vigente
// (#434). Mismo alcance que el PUT de la misma ruta.
const WEIGHTS_ROLES = ['Docente', 'Director', 'Admin'];

app.http('subject-weights-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'subject-weights/{subjectId}',
    handler: withCorrelation(withAuth(async (request, context) => {
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
            // Una docente alcanza la unidad en la que está asignada como docente.
            const { userId } = getAuthenticatedUser(request);
            const enrollment = await getEnrollment(subjectId, userId).catch(() => null);
            if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
                return { status: 403, body: JSON.stringify({ error: 'Forbidden - No estás asignado como docente de esta materia.' }) };
            }
        }

        try {
            const result = await getSubjectWeights(subjectId);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                // UJ-11 paso 6: la constancia de la decisión (quién, cuándo y con
                // qué fundamento) tiene que poder leerse desde afuera.
                body: JSON.stringify({
                    data: result.weights,
                    defaults: result.defaults,
                    updatedBy: result.updatedBy || null,
                    updatedAt: result.updatedAt || null,
                    reason: result.reason || '',
                }),
            };
        } catch (err) {
            context.error('[SubjectWeights] Error getting weights:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error al obtener la configuración de pesos.' }) };
        }
    }, { roles: WEIGHTS_ROLES })),
});

app.http('subject-weights-put', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'subject-weights/{subjectId}',
    handler: withCorrelation(withAuth(async (request, context) => {
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
        const reason = typeof body.reason === 'string' ? body.reason : '';
        const { userId } = getAuthenticatedUser(request);
        try {
            const result = await upsertSubjectWeights(subjectId, weights, userId, reason);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: result.weights,
                    defaults: result.defaults,
                    updatedBy: result.updatedBy || null,
                    updatedAt: result.updatedAt || null,
                    reason: result.reason || '',
                }),
            };
        } catch (err) {
            context.error('[SubjectWeights] Error upserting weights:', err);
            return { status: 400, body: JSON.stringify({ error: err.message || 'Error al guardar la configuración de pesos.' }) };
        }
    }))
});
