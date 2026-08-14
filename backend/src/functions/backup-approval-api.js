import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { saveApproval, getApproval, revokeApproval, listActiveApprovals } from '../services/backup-approval.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { CategorizedError } from '../services/error-categories.js';

app.http('backup-approval', {
    methods: ['GET', 'POST', 'DELETE'],
    authLevel: 'anonymous',
    route: 'backup-approval',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const principal = parseClientPrincipal(request);
        const roles = principal?.userRoles || [];
        if (!roles.includes('Director')) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Se requieren permisos de Director' }) };
        }

        try {
            if (request.method === 'POST') {
                const body = typeof request.body === 'string' ? JSON.parse(request.body) : (request.body || {});
                const { subjectId } = body;
                if (!subjectId) {
                    return {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'subjectId is required' }),
                    };
                }

                const approval = await saveApproval({
                    subjectId,
                    approvedBy: principal?.userId || 'unknown',
                });

                context.log(`[BackupApproval] Approval created for subject=${subjectId} by ${approval.approvedBy}, expires=${approval.expiresAt}`);

                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        subjectId: approval.subjectId,
                        approvedAt: approval.approvedAt,
                        expiresAt: approval.expiresAt,
                    }),
                };
            }

            if (request.method === 'DELETE') {
                const url = new URL(request.url);
                const subjectId = url.searchParams.get('subjectId');
                if (!subjectId) {
                    return {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'subjectId query parameter is required' }),
                    };
                }

                await revokeApproval({ subjectId });
                context.log(`[BackupApproval] Approval revoked for subject=${subjectId}`);
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ revoked: true, subjectId }),
                };
            }

            const url = new URL(request.url);
            const subjectId = url.searchParams.get('subjectId');

            if (subjectId) {
                const approval = await getApproval({ subjectId });
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(approval || { approved: false, subjectId }),
                };
            }

            const activeApprovals = await listActiveApprovals();
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ count: activeApprovals.length, approvals: activeApprovals }),
            };
        } catch (err) {
            const status = err instanceof CategorizedError && err.status ? err.status : 500;
            context.error('[BackupApproval] Error:', err);
            return {
                status,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: err.message, code: err.code || 'BACKUP_APPROVAL_ERROR' }),
            };
        }
    })),
});
