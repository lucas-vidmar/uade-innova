import { app } from '@azure/functions';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';

function buildMockTasks(studentId) {
    const now = new Date();
    const addDays = (d) => new Date(now.getTime() + d * 86400000).toISOString().slice(0, 10);

    return [
        { id: `task-${studentId}-001`, studentId, title: 'TP1: Diagrama de Arquitectura C4', dueDate: addDays(7), weight: 25, status: 'pending', classIds: ['class-01', 'class-02'], grade: null, subjectId: 'arq-software-2026' },
        { id: `task-${studentId}-002`, studentId, title: 'Quiz Online — Estilos Arquitectónicos', dueDate: addDays(-3), weight: 10, status: 'completed', classIds: ['class-02'], grade: 8.5, subjectId: 'arq-software-2026' },
        { id: `task-${studentId}-003`, studentId, title: 'Parcial 1 — Arquitectura y Patrones', dueDate: addDays(16), weight: 35, status: 'pending', classIds: ['class-01', 'class-02', 'class-03', 'class-04'], grade: null, subjectId: 'arq-software-2026' },
        { id: `task-${studentId}-004`, studentId, title: 'Lectura: Clean Architecture (caps 1-5)', dueDate: addDays(-7), weight: 5, status: 'completed', classIds: ['class-01'], grade: 10, subjectId: 'arq-software-2026' },
    ];
}

function buildMockEarlyAlerts(subjectId) {
    const alerts = [
        { id: 'alu-012', studentId: 'alu-012', name: 'Tomás García', subjectId: 'arq-software-2026', subject: 'Arq. de Software', risk: 'high', attendance: '45%', avgGrade: 4.2 },
        { id: 'alu-031', studentId: 'alu-031', name: 'Lucía Martínez', subjectId: 'diseno-sistemas-2026', subject: 'Sistemas Dist.', risk: 'medium', attendance: '62%', avgGrade: 5.1 },
        { id: 'alu-008', studentId: 'alu-008', name: 'Nicolás Peralta', subjectId: 'arq-software-2026', subject: 'Arq. de Software', risk: 'medium', attendance: '70%', avgGrade: 5.8 },
    ];
    return subjectId ? alerts.filter((item) => item.subjectId === subjectId) : alerts;
}

function buildMockAttendance(subjectId) {
    const snapshot = {
        average: 78,
        critical: 3,
        trend: 'stable',
        subjectId,
        updatedAt: new Date().toISOString(),
    };
    return snapshot;
}

app.http('sga-get-tasks', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'sga/tasks',
    handler: async (request) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const studentId = request.query.get('studentId');
        if (!studentId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Parámetro requerido: studentId' }) };
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildMockTasks(studentId)),
        };
    },
});

app.http('sga-get-early-alerts', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'sga/early-alerts',
    handler: async (request) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const subjectId = request.query.get('subjectId');
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildMockEarlyAlerts(subjectId)),
        };
    },
});

app.http('sga-get-attendance', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'sga/attendance',
    handler: async (request) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some((role) => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
        }

        const subjectId = request.query.get('subjectId');
        if (!subjectId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Parámetro requerido: subjectId' }) };
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildMockAttendance(subjectId)),
        };
    },
});
