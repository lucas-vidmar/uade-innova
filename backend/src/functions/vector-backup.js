import { app } from '@azure/functions';
import { runVectorBackup, listBackupRuns } from '../services/vector-backup.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { CategorizedError } from '../services/error-categories.js';
import { withCorrelation } from '../middleware/with-correlation.js';

app.http('vector-backup', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'vector-backup',
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const principal = parseClientPrincipal(request);
        const roles = principal?.userRoles || [];
        if (!roles.includes('Director') && !roles.includes('Docente')) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Se requieren permisos de Docente o Director' }) };
        }

        try {
            if (request.method === 'GET') {
                const runs = await listBackupRuns();
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ runs, count: runs.length }),
                };
            }

            const body = typeof request.body === 'string' ? JSON.parse(request.body) : (request.body || {});
            const mode = body.mode === 'backup+cleanup' ? 'backup+cleanup' : 'backup-only';
            const subjectScope = body.subjectScope || null;

            const result = await runVectorBackup({ mode, subjectScope });

            context.log(`[VectorBackup] ${mode} completado: runId=${result.runId}, vectors=${result.vectorCount}, durationMs=${result.durationMs}`);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result),
            };
        } catch (err) {
            const status = err instanceof CategorizedError && err.status ? err.status : 500;
            context.error('[VectorBackup] Error:', err);

            return {
                status,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    error: err.message,
                    code: err.code || 'VECTOR_BACKUP_ERROR',
                }),
            };
        }
    })
});
