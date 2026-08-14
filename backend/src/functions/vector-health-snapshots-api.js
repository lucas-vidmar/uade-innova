import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { listSnapshotsWithContent } from '../services/vector-health-snapshots.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';

function parseDays(rawDays) {
    if (!rawDays) return 7;
    const n = Number(rawDays);
    if (!Number.isInteger(n) || n < 1) return { error: '"days" must be a positive integer' };
    if (n > 365) return { error: '"days" must be between 1 and 365' };
    return { value: n };
}

app.http('vector-health-snapshots', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'vector-health-snapshots',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const principal = parseClientPrincipal(request);
        const roles = principal?.userRoles || [];
        if (!roles.includes('Docente') && !roles.includes('Director')) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Access restricted to Docente and Director roles' }) };
        }

        const parsed = parseDays(request.query.get('days'));
        if (parsed.error) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: false, error: { code: 'INVALID_DAYS', message: parsed.error } }),
            };
        }

        try {
            const snapshots = await listSnapshotsWithContent({ days: parsed.value });
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, data: snapshots, count: snapshots.length }),
            };
        } catch (err) {
            context.error('[VectorHealthSnapshots] Error listing snapshots:', err);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve snapshots' } }),
            };
        }
    })),
});
