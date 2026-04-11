import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
/**
 * chat-api.js — Azure Functions para feedback e historial de chat
 */
import { app } from '@azure/functions';
import { saveJson, loadJson, listBlobs } from '../services/storage.js';

const CONTAINER_CHAT = 'chat-logs';
const CONTAINER_TEACHER_ALERTS = 'teacher-alerts';

function normalizeLimit(value, fallback = 20) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.floor(parsed), 1), 50);
}

function canReadTeacherAlerts(principal) {
    if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') return true;
    const roles = principal?.userRoles || [];
    return roles.includes('Docente') || roles.includes('Director');
}

// ── GET /api/chat-history?subjectId={id} ─────────────────────────────
app.http('get-chat-history', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'chat-history',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const subjectId = request.query.get('subjectId');
        const userId = request.user?.id || 'anonymous';
        const userIdSanitized = userId.replace(/[^a-zA-Z0-9]/g, '_');

        if (!subjectId) {
            return { status: 400, body: 'Falta subjectId' };
        }

        try {
            const prefix = `${userIdSanitized}/${subjectId}/`;
            const blobNames = await listBlobs(CONTAINER_CHAT, prefix);
            
            // Cargar los últimos 10 mensajes
            const recentBlobs = blobNames.reverse().slice(0, 10);
            const history = [];

            for (const name of recentBlobs) {
                const data = await loadJson(CONTAINER_CHAT, name);
                if (data) history.push(data);
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(history.reverse()) // Volver a orden cronológico
            };
        } catch (err) {
            context.error('Error obteniendo historial:', err);
            return { status: 500, body: 'Error interno' };
        }
    }
});

// ── POST /api/chat-feedback ──────────────────────────────────────────
app.http('chat-feedback', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'chat-feedback',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const { messageId, subjectId, isPositive } = await request.json();
            const userId = request.user?.id || 'anonymous';
            const userIdSanitized = userId.replace(/[^a-zA-Z0-9]/g, '_');

            if (!messageId || !subjectId) {
                return { status: 400, body: 'Faltan campos messageId o subjectId' };
            }

            const blobPath = `${userIdSanitized}/${subjectId}/${messageId}.json`;
            const log = await loadJson(CONTAINER_CHAT, blobPath);

            if (!log) {
                return { status: 404, body: 'Mensaje no encontrado' };
            }

            log.feedback = isPositive ? 'positive' : 'negative';
            log.feedbackAt = new Date().toISOString();

            await saveJson(CONTAINER_CHAT, blobPath, log);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, feedback: log.feedback })
            };
        } catch (err) {
            context.error('Error procesando feedback:', err);
            return { status: 500, body: 'Error interno' };
        }
    }
});

// ── POST /api/chat-report-issue ──────────────────────────────────────
app.http('chat-report-issue', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'chat-report-issue',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const { messageId, subjectId, issueDetail } = await request.json();
            const principal = parseClientPrincipal(request);
            const userId = principal?.oid || request.user?.id || 'anonymous';
            const userIdSanitized = String(userId).replace(/[^a-zA-Z0-9]/g, '_');
            const detail = String(issueDetail || '').trim();

            if (!messageId || !subjectId) {
                return { status: 400, body: JSON.stringify({ error: 'Faltan campos messageId o subjectId' }) };
            }

            const blobPath = `${userIdSanitized}/${subjectId}/${messageId}.json`;
            const log = await loadJson(CONTAINER_CHAT, blobPath);

            if (!log) {
                return { status: 404, body: JSON.stringify({ error: 'Mensaje no encontrado' }) };
            }

            const now = new Date().toISOString();
            log.reportedIssue = {
                reportedAt: now,
                detail: detail || 'Sin detalle adicional provisto por el alumno.',
                reporterUserId: userId,
                status: 'open',
            };

            await saveJson(CONTAINER_CHAT, blobPath, log);

            const alertId = `ai-issue-${messageId}`;
            const alert = {
                id: alertId,
                type: 'ai-feedback-issue',
                status: 'open',
                subjectId,
                messageId,
                reporterUserId: userId,
                question: log.question || '',
                answerExcerpt: String(log.answer || '').slice(0, 240),
                issueDetail: detail || 'Sin detalle adicional provisto por el alumno.',
                createdAt: now,
            };

            await saveJson(CONTAINER_TEACHER_ALERTS, `${subjectId}/${alertId}.json`, alert);

            context.log(`[chat-report-issue] issue reported (subject=${subjectId}, messageId=${messageId})`);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, alertId }),
            };
        } catch (err) {
            context.error('Error reportando issue de chat:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    }
});

// ── GET /api/teacher/ai-feedback-alerts?subjectId={id}&limit={n} ─────
app.http('teacher-ai-feedback-alerts', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'teacher/ai-feedback-alerts',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const principal = parseClientPrincipal(request);
        if (!canReadTeacherAlerts(principal)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Teacher/Director access required' }) };
        }

        const subjectId = request.query.get('subjectId');
        const limit = normalizeLimit(request.query.get('limit'));

        if (!subjectId) {
            return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        try {
            const blobNames = await listBlobs(CONTAINER_TEACHER_ALERTS, `${subjectId}/`);
            const items = [];

            for (const name of blobNames) {
                const alert = await loadJson(CONTAINER_TEACHER_ALERTS, name);
                if (alert) items.push(alert);
            }

            items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(items.slice(0, limit)),
            };
        } catch (err) {
            context.error('Error obteniendo alertas de feedback IA:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    },
});
