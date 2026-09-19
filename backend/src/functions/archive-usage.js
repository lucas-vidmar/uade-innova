import { app } from '@azure/functions';
import { getArchiveUsage } from '../services/archive-usage.js';
import { validateFrontDoorId } from '../services/auth-utils.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { withAuth } from '../middleware/with-auth.js';

app.http('archive-usage', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'archive-usage',
    handler: withCorrelation(withAuth(async (request, context) => {
        try {
            if (!validateFrontDoorId(request)) {
                return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
            }

            const subjectId = request.query.get('subjectId') || undefined;
            const semester = request.query.get('semester') || undefined;

            context.log(`[ArchiveUsage] Fetching archive usage — subjectId=${subjectId}, semester=${semester}`);

            const result = await getArchiveUsage({ subjectId, semester });

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result),
            };
        } catch (err) {
            context.error('[ArchiveUsage] Error:', err.message, err.stack);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    totalArchiveBlobs: 0,
                    totalArchiveSizeGB: 0,
                    bySubject: [],
                    bySemester: [],
                    error: err.message,
                    timestamp: new Date().toISOString(),
                }),
            };
        }
    }, { roles: ['Director', 'Admin'] }))
});
