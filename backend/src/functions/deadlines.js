import { app } from '@azure/functions';
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
    return {
        id: deadline.id,
        title: deadline.title,
        description: deadline.description || '',
        subjectId: deadline.subjectId,
        classId: deadline.classId,
        dueDate: deadline.dueDate,
        notifyOnDayBefore: deadline.notifyOnDayBefore !== false,
        notifyOnDayOf: deadline.notifyOnDayOf !== false,
        createdAt: deadline.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

app.http('get-deadlines', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'deadlines',
    handler: async (request) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

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
    },
});

app.http('save-deadline', {
    methods: ['POST', 'PUT'],
    authLevel: 'anonymous',
    route: 'deadlines',
    handler: async (request) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
        }

        const body = await request.json();
        if (!body?.subjectId || !body?.classId || !body?.title || !body?.dueDate) {
            return { status: 400, body: JSON.stringify({ error: 'Faltan campos requeridos: subjectId, classId, title, dueDate' }) };
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

        const next = [
            ...current.filter(d => d.id !== deadline.id),
            deadline,
        ].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

        await saveJson(CONTAINER_DEADLINES, `${subjectId}.json`, next);

        return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(deadline) };
    },
});

app.http('get-deadline-reminders', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'deadline-reminders',
    handler: async (request) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

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
    },
});
