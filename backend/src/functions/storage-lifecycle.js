import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { checkStorageLifecycleCompliance } from '../services/storage-lifecycle.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';

app.http('storage-lifecycle-compliance', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'storage-lifecycle/compliance',
    handler: withCorrelation(withAuth(async (request, context) => {
        try {
            if (!validateFrontDoorId(request)) {
                return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
            }

            const principal = parseClientPrincipal(request);
            const roles = principal?.userRoles || [];
            if (!roles.includes('Director')) {
                return { status: 403, body: JSON.stringify({ error: 'Forbidden - Se requieren permisos de Director' }) };
            }

            const result = await checkStorageLifecycleCompliance();
            context.log('[StorageLifecycle] Compliance check:', JSON.stringify(result));

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result),
            };
        } catch (err) {
            context.error('[StorageLifecycle] Error:', err.message, err.stack);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    compliant: false,
                    error: err.message,
                    timestamp: new Date().toISOString(),
                }),
            };
        }
    })),
});
