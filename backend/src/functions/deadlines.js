import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { loadJson, saveJson } from '../services/storage.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getEnrollment } from '../services/state-store.js';

const CONTAINER_DEADLINES = 'deadlines';

function getTodayIso() {
    return new Date().toISOString().slice(0, 10);
}

function dayBefore(dateStr) {
    const base = new Date(`${dateStr}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() - 1);
    return base.toISOString().slice(0, 10);
}

function normalizeDeadline(deadline = {}) {
    const classIds = Array.isArray(deadline.classIds) && deadline.classIds.length > 0
        ? [...new Set(deadline.classIds.map(String).filter(Boolean))]
        : (deadline.classId ? [String(deadline.classId)] : []);
    return {
        id: deadline.id,
        title: deadline.title,
        description: deadline.description || '',
        subjectId: deadline.subjectId,
        classId: classIds[0] || null,
        classIds,
        dueDate: deadline.dueDate,
        timezone: deadline.timezone || null,
        notifyOnDayBefore: deadline.notifyOnDayBefore !== false,
        notifyOnDayOf: deadline.notifyOnDayOf !== false,
        weight: deadline.weight || 0,
        status: deadline.status || 'pending',
        // UJ-36: si la fecha se movió, la anterior debe seguir siendo
        // identificable como reemplazada (no se puede reconstruir si se pisa).
        previousDueDate: deadline.previousDueDate || null,
        previousDueDateAt: deadline.previousDueDateAt || null,
        changeReason: deadline.changeReason || null,
        createdAt: deadline.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

app.http('get-deadlines', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'deadlines',
    handler: withCorrelation(withAuth(async (request) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const subjectId = request.query.get('subjectId');

        if (!subjectId) {
            return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        // Security Check: Enrollment-based access control
        const principal = parseClientPrincipal(request);
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const roles = principal?.userRoles || [];
        const isDirector = roles.includes('Director');

        if (!isDirector) {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.status !== 'active') {
                    // Fail secure: block access
                    return {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'No tienes acceso a las fechas de esta materia.' })
                    };
                }
            } catch (enrollmentErr) {
                // Fail secure
                return { status: 500, body: JSON.stringify({ error: 'Error al verificar permisos de acceso.' }) };
            }
        }

        const deadlines = await loadJson(CONTAINER_DEADLINES, `${subjectId}.json`) || [];
        return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(deadlines) };
    })),
});

app.http('save-deadline', {
    methods: ['POST', 'PUT'],
    authLevel: 'anonymous',
    route: 'deadlines',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
        }

        const body = await request.json();
        const hasClass = body?.classIds?.length || body?.classId;
        if (!body?.subjectId || !hasClass || !body?.title || !body?.dueDate) {
            return { status: 400, body: JSON.stringify({ error: 'Faltan campos requeridos: subjectId, classId(s), title, dueDate' }) };
        }

        const subjectId = body.subjectId;

        // Security Check: Enrollment-based access control
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const isDirector = principal?.userRoles?.includes('Director');

        if (!isDirector) {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
                    return {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'No tienes permisos para modificar fechas en esta materia.' })
                    };
                }
            } catch (enrollmentErr) {
                return { status: 500, body: JSON.stringify({ error: 'Error al verificar permisos de docente.' }) };
            }
        }
        const current = await loadJson(CONTAINER_DEADLINES, `${subjectId}.json`) || [];
        const deadline = normalizeDeadline({
            ...body,
            id: body.id || `deadline-${Date.now()}`,
        });

        // UJ-36: al mover la fecha, la anterior tiene que quedar identificable
        // como reemplazada (y el aviso tiene que mencionarla) para que nadie
        // siga organizándose sobre una fecha que ya no rige. Antes se pisaba
        // dueDate sin guardar la anterior ni el motivo y el aviso llevaba sólo
        // la fecha nueva ("ahora vence el ..."), sin decir qué quedó sin efecto.
        const existingDeadline = current.find(d => d.id === deadline.id);
        const previousDue = existingDeadline ? String(existingDeadline.dueDate || '') : '';
        const newDue = String(deadline.dueDate || '');
        const dateChanged = Boolean(existingDeadline)
            && previousDue.slice(0, 10) !== newDue.slice(0, 10);
        if (dateChanged) {
            deadline.previousDueDate = existingDeadline.dueDate;
            deadline.previousDueDateAt = new Date().toISOString();
            const reason = typeof body.changeReason === 'string' ? body.changeReason.trim().slice(0, 500) : '';
            if (reason) deadline.changeReason = reason;
        }

        const next = [
            ...current.filter(d => d.id !== deadline.id),
            deadline,
        ].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

        await saveJson(CONTAINER_DEADLINES, `${subjectId}.json`, next);

        // Notify students when deadline is created or updated
        try {
            const isNew = !existingDeadline;
            if (isNew || dateChanged) {
                const fmt = (d) => new Date(d).toLocaleDateString('es-AR');
                const changeMessage = `${deadline.title}: la fecha cambió del ${fmt(existingDeadline.dueDate)} al ${fmt(deadline.dueDate)}`
                    + (deadline.changeReason ? ` (Motivo: ${deadline.changeReason})` : '');
                const { upsertNotificationForSubject } = await import('../services/notification-store.js');
                await upsertNotificationForSubject(subjectId, {
                    id: `notif-deadline-change-${deadline.id}`,
                    type: 'deadline',
                    title: isNew ? 'Nueva tarea: ' + deadline.title : 'Fecha actualizada: ' + deadline.title,
                    message: isNew
                        ? deadline.title + ' — Fecha: ' + fmt(deadline.dueDate)
                        : changeMessage,
                    createdAt: new Date().toISOString(),
                    unread: true,
                    targetHash: '#/student/calendar',
                    subjectId,
                    recipientUserIds: [],
                    origin: 'deadline-save',
                });
                context.log('[Deadlines] Notification sent for deadline:', deadline.id);
            }
        } catch (notifErr) {
            context.warn('[Deadlines] Failed to send notification (non-blocking):', notifErr.message);
        }

        return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(deadline) };
    })),
});

app.http('delete-deadline', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'deadlines/{deadlineId}',
    handler: withCorrelation(withAuth(async (request) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
        }

        const deadlineId = request.params.deadlineId;
        const subjectId = request.query.get('subjectId');
        if (!subjectId || !deadlineId) {
            return { status: 400, body: JSON.stringify({ error: 'Faltan campos requeridos: subjectId, deadlineId' }) };
        }

        const userId = principal?.userId || principal?.oid || 'anonymous';
        const isDirector = principal?.userRoles?.includes('Director');

        if (!isDirector) {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
                    return {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'No tienes permisos para modificar fechas en esta materia.' })
                    };
                }
            } catch (enrollmentErr) {
                return { status: 500, body: JSON.stringify({ error: 'Error al verificar permisos de docente.' }) };
            }
        }

        const current = await loadJson(CONTAINER_DEADLINES, `${subjectId}.json`) || [];
        const next = current.filter(d => d.id !== deadlineId);
        await saveJson(CONTAINER_DEADLINES, `${subjectId}.json`, next);

        return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
    })),
});

app.http('get-deadline-reminders', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'deadline-reminders',
    handler: withCorrelation(withAuth(async (request) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const subjectId = request.query.get('subjectId');

        if (!subjectId) {
            return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        // Security Check: Enrollment-based access control
        const principal = parseClientPrincipal(request);
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const roles = principal?.userRoles || [];
        const isDirector = roles.includes('Director');

        if (!isDirector) {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.status !== 'active') {
                    return {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'No tienes acceso a los recordatorios de esta materia.' })
                    };
                }
            } catch (enrollmentErr) {
                return { status: 500, body: JSON.stringify({ error: 'Error al verificar permisos de acceso.' }) };
            }
        }

        const today = request.query.get('today') || getTodayIso();
        const deadlines = await loadJson(CONTAINER_DEADLINES, `${subjectId}.json`) || [];

        const reminders = deadlines.flatMap((deadline) => {
            const dueDate = deadline.dueDate.slice(0, 10);
            const items = [];
            if (deadline.notifyOnDayBefore && today === dayBefore(dueDate)) {
                items.push({ ...deadline, reminderType: 'day-before' });
            }
            if (deadline.notifyOnDayOf && today === dueDate) {
                items.push({ ...deadline, reminderType: 'day-of' });
            }
            return items;
        });

        return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reminders) };
    })),
});
