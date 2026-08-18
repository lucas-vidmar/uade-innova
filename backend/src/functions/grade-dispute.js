import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { parseClientPrincipal, validateFrontDoorId, getAuthenticatedUser } from '../services/auth-utils.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { upsertNotificationForSubject } from '../services/notification-store.js';
import { loadJson, saveJson } from '../services/storage.js';
import { CONFIG } from '../services/config.js';
import { getEnrollmentsBySubject } from '../services/state-store.js';
import { v4 as uuidv4 } from 'uuid';

const CONTAINER_TASKS = CONFIG.containers.tasks;
const CONTAINER_DISPUTES = process.env.AZURE_STORAGE_CONTAINER_DISPUTES || 'disputes-config';

async function resolveTeacherIds(subjectId) {
    try {
        const enrollments = await getEnrollmentsBySubject(subjectId);
        return enrollments
            .filter((e) => e.role === 'teacher' && e.status === 'active')
            .map((e) => e.userId)
            .filter(Boolean);
    } catch {
        return [];
    }
}

app.http('grade-dispute', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'grade-dispute',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }
        try {
            const body = await request.json();
            const { taskId, reason, taskTitle, studentName, subjectId } = body || {};
            const { userId, sanitizedId } = getAuthenticatedUser(request);
            const detail = String(reason || '').trim();
            const resolvedSubjectId = String(subjectId || 'default').trim();

            if (!taskId || detail.length < 20) {
                return { status: 400, body: JSON.stringify({ error: 'Faltan campos requeridos: taskId y reason (min 20 caracteres)' }) };
            }

            const disputeId = `dispute-${uuidv4().replace(/-/g, '').slice(0, 12)}`;
            const now = new Date().toISOString();
            const displayName = String(studentName || '').trim() || String(sanitizedId || userId || 'alumno');
            const taskLabel = String(taskTitle || '').trim() || String(taskId || '');

            // Persist dispute record (per subject)
            const disputes = (await loadJson(CONTAINER_DISPUTES, `${resolvedSubjectId}.json`)) || [];
            const disputeRecord = {
                disputeId,
                taskId: String(taskId),
                taskTitle: taskLabel,
                studentId: String(userId || sanitizedId || 'anonymous'),
                studentName: displayName,
                reason: detail,
                originalGrade: body.originalGrade ?? null,
                status: 'open',
                subjectId: resolvedSubjectId,
                createdAt: now,
            };
            disputes.push(disputeRecord);
            await saveJson(CONTAINER_DISPUTES, `${resolvedSubjectId}.json`, disputes);

            // Persist disputed status on the student's task
            const studentKey = String(userId || sanitizedId || 'anonymous').replace(/[^a-zA-Z0-9]/g, '_');
            const tasks = (await loadJson(CONTAINER_TASKS, `${studentKey}.json`)) || [];
            if (Array.isArray(tasks)) {
                const idx = tasks.findIndex((t) => String(t.id) === String(taskId));
                if (idx >= 0) {
                    tasks[idx] = { ...tasks[idx], status: 'disputed' };
                    await saveJson(CONTAINER_TASKS, `${studentKey}.json`, tasks);
                }
            }

            const teacherIds = await resolveTeacherIds(resolvedSubjectId);
            await upsertNotificationForSubject(resolvedSubjectId, {
                id: disputeId,
                type: 'grade',
                title: 'Disputa de nota recibida',
                message: `El alumno ${displayName} disputó la nota de ${taskLabel}`,
                createdAt: now,
                unread: true,
                targetHash: '#/teacher/dashboard',
                subjectId: resolvedSubjectId,
                recipientUserIds: teacherIds,
                origin: 'grade-dispute',
            });

            context.log(`[GradeDispute] dispute recorded (disputeId=${disputeId}, taskId=${taskId}, subjectId=${resolvedSubjectId}, recipients=${teacherIds.length})`);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, disputeId }),
            };
        } catch (err) {
            context.error('Error processing grade dispute:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    })),
});
