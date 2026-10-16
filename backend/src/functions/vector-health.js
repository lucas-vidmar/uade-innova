import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { getIndexStats } from '../services/vector-store.js';
import { getVectorMetrics } from '../services/vector-metrics.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { withCorrelation } from '../middleware/with-correlation.js';

app.http('vector-health', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'vector-health',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const principal = parseClientPrincipal(request);
        const roles = principal?.userRoles || [];
        // 'authenticated' NO es un rol: withAuth lo agrega a toda sesión
        // (with-auth.js:116), así que incluirlo aquí dejaba la superficie de
        // operación abierta a cualquier identidad con sesión —alumnado
        // incluido— y publicaba el host del depósito vectorial (#468).
        // Los roles de operación son los mismos que su hermana
        // vector-health-snapshots-api.js, más Admin, que es el único
        // consumidor (frontend/src/pages/admin/Dashboard.js).
        const OPERATIVE_ROLES = ['Docente', 'Director', 'Admin'];
        if (!roles.some((r) => OPERATIVE_ROLES.includes(r))) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Se requieren permisos de Docente, Director o Admin' }) };
        }

        try {
            const windowMinutes = parseInt(request.query.get('window')) || 5;
            const stats = await getIndexStats();
            const metrics = getVectorMetrics(windowMinutes);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'pinecone',
                    endpoint: process.env.PINECONE_HOST || null,
                    indexName: process.env.PINECONE_INDEX_NAME || null,
                    stats,
                    latencyMs: metrics.latencyMs,
                    failureRatio: metrics.failureRatio,
                    metricsWindow: metrics.windowMinutes,
                    metricsSampleCount: metrics.sampleCount,
                    timestamp: new Date().toISOString(),
                }),
            };
        } catch (err) {
            context.error('[Vector Health] Error obteniendo estado del índice:', err);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'pinecone',
                    // No devolver err.message: puede arrastrar el host del
                    // depósito y detalle de infraestructura al cliente (#468).
                    error: 'No se pudo obtener el estado del índice.',
                }),
            };
        }
    }))
});
