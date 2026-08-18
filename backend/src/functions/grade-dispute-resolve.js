import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { parseClientPrincipal, validateFrontDoorId, getAuthenticatedUser } from '../services/auth-utils.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { upsertNotificationForSubject } from '../services/notification-store.js';
import { loadJson, saveJson } from '../services/storage.js';
import { CONFIG } from '../services/config.js';

const CONTAINER_TASKS = CONFIG.containers.tasks;
const CONTAINER_DISPUTES = process.env.AZURE_STORAGE_CONTAINER_DISPUTES || 'disputes-config';

function isTeacherOrDirector(principal) {
    const roles = Array.isArray(principal?.userRoles) ? principal.userRoles : [];
    return roles.includes('Docente') || roles.includes('Director');
}

app.http('grade-disputes-list', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'grade-disputes',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }
        const principal = parseClientPrincipal(request);
        if (!isTeacherOrDirector(principal) && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development') {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
        }
        const subjectId = request.query.get('subjectId');
        if (!subjectId) {
            return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }
        const disputes = (await loadJson(CONTAINER_DISPUTES, `${subjectId}.json`)) || [];
        const open = Array.isArray(disputes) ? disputes.filter((d) => d.status === 'open') : [];
        context.log(`[GradeDisputes] list subjectId=${subjectId} open=${open.length}`);
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(open),
        };
    })),
});

app.http('grade-dispute-resolve', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'grade-dispute/resolve',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }
        const principal = parseClientPrincipal(request);
        if (!isTeacherOrDirector(principal) && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development') {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
        }
        try {
            const body = await request.json();
            const { disputeId, subjectId, decision, newGrade } = body || {};
            if (!disputeId || !subjectId || !['resolved', 'rejected'].includes(decision)) {
                return { status: 400, body: JSON.stringify({ error: 'Faltan campos requeridos: disputeId, subjectId, decision (resolved|rejected)' }) };
            }

            const disputes = (await loadJson(CONTAINER_DISPUTES, `${subjectId}.json`)) || [];
            const idx = Array.isArray(disputes) ? disputes.findIndex((d) => d.disputeId === disputeId) : -1;
            if (idx < 0) {
                return { status: 404, body: JSON.stringify({ error: 'Disputa no encontrada' }) };
            }

            const dispute = disputes[idx];
            const now = new Date().toISOString();
            disputes[idx] = {
                ...dispute,
                status: decision,
                resolution: decision,
                resolvedAt: now,
                resolvedGrade: decision === 'resolved' && newGrade != null ? Number(newGrade) : undefined,
            };
            await saveJson(CONTAINER_DISPUTES, `${subjectId}.json`, disputes);

            // Update the student's task
            const studentKey = String(dispute.studentId || '').replace(/[^a-zA-Z0-9]/g, '_');
            const tasks = (await loadJson(CONTAINER_TASKS, `${studentKey}.json`)) || [];
            if (Array.isArray(tasks)) {
                const tIdx = tasks.findIndex((t) => String(t.id) === String(dispute.taskId));
                if (tIdx >= 0) {
                    const next = { ...tasks[tIdx], status: 'completed' };
                    if (decision === 'resolved' && newGrade != null) {
                        next.grade = Number(newGrade);
                    }
                    tasks[tIdx] = next;
                    await saveJson(CONTAINER_TASKS, `${studentKey}.json`, tasks);
                }
            }

            const outcome = decision === 'resolved' ? 'resuelta' : 'rechazada';
            await upsertNotificationForSubject(subjectId, {
                id: `dispute-resolution-${disputeId}`,
                type: 'grade',
                title: 'Resultado de tu disputa',
                message: `Tu disputa de ${dispute.taskTitle || dispute.taskId} fue ${outcome}`,
                createdAt: now,
                unread: true,
                targetHash: '#/student/tasks',
                subjectId,
                recipientUserIds: [dispute.studentId].filter(Boolean),
                origin: 'grade-dispute-resolve',
            });

            context.log(`[GradeDisputeResolve] disputeId=${disputeId} subjectId=${subjectId} decision=${decision} taskId=${dispute.taskId}`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, disputeId }),
            };
        } catch (err) {
            context.error('Error resolving grade dispute:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    })),
});
