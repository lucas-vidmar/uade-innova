/**
 * chat-api.js — Azure Functions para feedback e historial de chat
 */
import { app } from '@azure/functions';
import { saveJson, loadJson, listBlobs } from '../services/storage.js';

const CONTAINER_CHAT = 'chat-logs';

// ── GET /api/chat-history?subjectId={id} ─────────────────────────────
app.http('get-chat-history', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'chat-history',
    handler: async (request, context) => {
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
