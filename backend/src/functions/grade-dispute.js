import { app } from '@azure/functions';
import { parseClientPrincipal, validateFrontDoorId, getAuthenticatedUser } from '../services/auth-utils.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { upsertNotificationForSubject } from '../services/notification-store.js';
import { v4 as uuidv4 } from 'uuid';

app.http('grade-dispute', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'grade-dispute',
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }
        try {
            const { taskId, reason } = await request.json();
            const { userId, sanitizedId } = getAuthenticatedUser(request);
            const detail = String(reason || '').trim();

            if (!taskId || detail.length < 20) {
                return { status: 400, body: JSON.stringify({ error: 'Faltan campos requeridos: taskId y reason (min 20 caracteres)' }) };
            }

            const disputeId = `dispute-${uuidv4().replace(/-/g, '').slice(0, 12)}`;
            const now = new Date().toISOString();

            await upsertNotificationForSubject('default', {
                id: disputeId,
                type: 'grade',
                title: 'Disputa de nota recibida',
                message: `El alumno ${sanitizedId} disputó la nota de la tarea ${taskId}: ${detail}`,
                createdAt: now,
                unread: true,
                targetHash: '#/teacher/dashboard',
                subjectId: 'default',
                recipientUserIds: [],
                origin: 'grade-dispute',
            });

            context.log(`[GradeDispute] dispute recorded (disputeId=${disputeId}, taskId=${taskId})`);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, disputeId }),
            };
        } catch (err) {
            context.error('Error processing grade dispute:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    }),
});
