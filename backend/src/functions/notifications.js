import { app } from '@azure/functions';
import { validateFrontDoorId } from '../services/auth-utils.js';
import { listNotificationsBySubject } from '../services/notification-store.js';

const MOCK_NOTIFICATIONS = [
    {
        id: 'notif-grade-001',
        type: 'grade',
        title: 'Nueva nota publicada',
        message: 'Quiz Online — Estilos Arquitectónicos: 8.5',
        createdAt: '2026-03-20T11:10:00Z',
        unread: true,
        targetHash: '#/student/tasks',
        subjectId: 'arq-software-2026',
    },
    {
        id: 'notif-summary-001',
        type: 'summary',
        title: 'Resumen validado por docente',
        message: 'Clase 2 — Estilos Arquitectónicos ya tiene resumen validado.',
        createdAt: '2026-03-18T09:00:00Z',
        unread: true,
        targetHash: '#/student/dashboard',
        subjectId: 'arq-software-2026',
    },
    {
        id: 'notif-material-001',
        type: 'material',
        title: 'Nuevo material disponible',
        message: 'Se cargó clase2_estilos.pptx en Clase 2.',
        createdAt: '2026-03-17T18:45:00Z',
        unread: false,
        targetHash: '#/student/class/class-02',
        subjectId: 'arq-software-2026',
    },
    {
        id: 'notif-summary-002',
        type: 'summary',
        title: 'Resumen validado por docente',
        message: 'Clase 1 — Introducción ya tiene resumen validado.',
        createdAt: '2026-03-16T15:20:00Z',
        unread: false,
        targetHash: '#/student/dashboard',
        subjectId: 'diseno-sistemas-2026',
    },
];

function normalizeLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(Math.max(Math.floor(parsed), 1), 50);
}

function normalizeNotification(item = {}, idx = 0) {
    const type = ['grade', 'summary', 'material'].includes(item.type) ? item.type : 'material';
    return {
        id: item.id || `notif-${Date.now()}-${idx}`,
        type,
        title: String(item.title || 'Nueva notificación'),
        message: String(item.message || 'Tienes una actualización académica.'),
        createdAt: item.createdAt || new Date().toISOString(),
        unread: item.unread !== false,
        targetHash: item.targetHash || '#/student/dashboard',
        subjectId: item.subjectId || null,
        recipientUserIds: Array.isArray(item.recipientUserIds) ? item.recipientUserIds : [],
        origin: item.origin || 'seed',
    };
}

function canReceiveNotification(item, userId) {
    if (!userId) return true;
    const recipients = Array.isArray(item?.recipientUserIds) ? item.recipientUserIds : [];
    if (recipients.length === 0) return true;
    return recipients.includes(userId);
}

app.http('get-notifications', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'notifications',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const userId = request.query.get('userId') || null;
        const subjectId = request.query.get('subjectId') || null;
        const limit = normalizeLimit(request.query.get('limit'));

        let persisted = [];
        if (subjectId) {
            try {
                persisted = await listNotificationsBySubject(subjectId);
            } catch (err) {
                context.error(`[notifications] error loading persisted notifications for ${subjectId}: ${err.message}`);
            }
        }

        const data = [...persisted, ...MOCK_NOTIFICATIONS]
            .filter((item) => !subjectId || item.subjectId === subjectId)
            .filter((item) => canReceiveNotification(item, userId))
            .map((item, idx) => normalizeNotification(item, idx))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, limit);

        context.log(`[notifications] returning ${data.length} records (subjectId=${subjectId || 'all'}, userId=${userId || 'anonymous'})`);

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        };
    },
});
