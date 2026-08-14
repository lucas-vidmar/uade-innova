import { withCorrelation } from '../middleware/with-correlation.js';
import { withAuth } from '../middleware/with-auth.js';
import { validateFrontDoorId, parseClientPrincipal, getAuthenticatedUser } from '../services/auth-utils.js';
import { getEnrollment, RATINGS_TABLE } from '../services/state-store.js';
import { getTableClient } from '../services/storage.js';
import { computeWinner } from '../services/significance.js';
import { app } from '@azure/functions';
import { CONFIG } from '../services/config.js';

app.http('get-sat-analytics', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'sat-analytics',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const subjectId = request.query.get('subjectId');
        const classId = request.query.get('classId') || '';
        const rawDays = request.query.get('days');
        const ALLOWED_DAYS = [7, 14, 30];
        const days = ALLOWED_DAYS.includes(Number(rawDays)) ? Number(rawDays) : 30;

        if (!subjectId) {
            return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        const principal = parseClientPrincipal(request);
        const userRoles = principal?.userRoles || [];
        const isTeacherOrDirector = userRoles.includes('Docente') || userRoles.includes('Director') || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';

        if (!isTeacherOrDirector) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Solo docentes/directores pueden acceder a esta métrica' }) };
        }

        try {
            const tableClient = getTableClient(RATINGS_TABLE);
            const entities = [];

            const result = tableClient.listEntities({
                queryOptions: {
                    filter: `PartitionKey eq '${subjectId.replace(/'/g, "''")}'`,
                },
            });

            const startDate = new Date();
            startDate.setUTCHours(0, 0, 0, 0);
            startDate.setUTCDate(startDate.getUTCDate() - (days - 1));

            for await (const entity of result) {
                if (classId && entity.classId !== classId) continue;
                const createdAt = entity.createdAt ? new Date(entity.createdAt) : null;
                if (!createdAt || isNaN(createdAt) || createdAt < startDate) continue;
                entities.push(entity);
            }

            const segments = {};
            for (const entity of entities) {
                const version = entity.promptVersion || 'default';
                if (!segments[version]) {
                    segments[version] = { promptVersion: version, rated: 0, positive: 0, satScore: 0 };
                }
                segments[version].rated++;
                if ((entity.rating || '') === 'positive') {
                    segments[version].positive++;
                }
            }

            const resultArray = Object.values(segments);
            for (const seg of resultArray) {
                seg.satScore = seg.rated > 0 ? Math.round((seg.positive / seg.rated) * 100) / 100 : 0;
            }

            const minRated = CONFIG.sat.minRatedThreshold;
            const winner = computeWinner(resultArray, minRated);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ segments: resultArray, total: entities.length, filter: { subjectId, classId: classId || null, windowDays: days }, winner }),
            };
        } catch (err) {
            context.error(`[sat-analytics] Error subjectId=${subjectId} classId=${classId || 'none'}:`, err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno obteniendo métricas SAT' }) };
        }
    })),
});
