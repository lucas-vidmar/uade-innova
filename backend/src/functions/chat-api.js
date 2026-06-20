import { withCorrelation } from '../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal, getAuthenticatedUser } from '../services/auth-utils.js';
import { getEnrollment, upsertCorrection, RATINGS_TABLE } from '../services/state-store.js';
import { v4 as uuidv4 } from 'uuid';
/**
 * chat-api.js — Azure Functions para feedback e historial de chat
 */
import { app } from '@azure/functions';
import { saveJson, loadJson, listBlobs, deleteBlob, getTableClient } from '../services/storage.js';

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
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const subjectId = request.query.get('subjectId');
        const { userId, sanitizedId } = getAuthenticatedUser(request);

        if (!subjectId) {
            return { status: 400, body: 'Falta subjectId' };
        }

        // Enrollment access check — students must be enrolled
        const principal = parseClientPrincipal(request);
        const userRoles = principal?.userRoles || [];
        const isTeacherOrDirector = userRoles.includes('Docente') || userRoles.includes('Director') || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isTeacherOrDirector) {
            const enrollment = await getEnrollment(subjectId, userId).catch(() => null);
            if (!enrollment || enrollment.status !== 'active') {
                context.log(`[Enrollment] Chat history denied: userId=${userId}, subjectId=${subjectId}`);
                return {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        success: false,
                        error: { code: 'ENROLLMENT_REQUIRED', message: 'No estás matriculado en esta materia. Contactá a administración.' },
                    }),
                };
            }
        }

        try {
            const prefix = `${sanitizedId}/${subjectId}/`;
            const blobNames = await listBlobs(CONTAINER_CHAT, prefix);
            
            // Cargar todos los mensajes
            const history = [];

            for (const name of blobNames) {
                const data = await loadJson(CONTAINER_CHAT, name);
                if (data) history.push(data);
            }

            history.forEach((item) => {
                if (!item.sessionId) {
                    item.sessionId = item.id || null;
                }
            });

            // Ordenar cronológicamente por timestamp (más antiguo primero)
            history.sort((a, b) => new Date(a.timestamp || a.createdAt || 0) - new Date(b.timestamp || b.createdAt || 0));

            // Devolver los últimos 50 en orden cronológico (para permitir scroll en historial)
            const recent = history.slice(-50);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(recent)
            };
        } catch (error) {
            context.error('Error cargando historial de chat:', error);
            return { status: 500, body: 'Error interno cargando historial' };
        }
    })
});


// ── DELETE /api/chat-history?subjectId={id} ──────────────────────────
app.http('delete-chat-history', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'chat-history',
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const subjectId = request.query.get('subjectId');
        const { userId, sanitizedId } = getAuthenticatedUser(request);

        if (!subjectId) return { status: 400, body: 'Falta subjectId' };

        // Security Check: Enrollment-based access control
        const principal = parseClientPrincipal(request);
        const userRoles = principal?.userRoles || [];
        const isTeacherOrDirector = userRoles.includes('Docente') || userRoles.includes('Director') || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';

        if (!isTeacherOrDirector) {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.status !== 'active') {
                    return { status: 403, body: JSON.stringify({ error: 'No tienes acceso a esta materia.' }) };
                }
            } catch (err) {
                return { status: 500, body: JSON.stringify({ error: 'Error verificando permisos.' }) };
            }
        }

        try {
            const prefix = `${sanitizedId}/${subjectId}/`;
            const blobNames = await listBlobs(CONTAINER_CHAT, prefix);
            
            for (const name of blobNames) {
                await deleteBlob(CONTAINER_CHAT, name);
            }

            return { status: 200, body: JSON.stringify({ success: true, count: blobNames.length }) };
        } catch (err) {
            context.error('Error eliminando historial:', err);
            return { status: 500, body: 'Error interno' };
        }
    })
});

// ── POST /api/chat-feedback ──────────────────────────────────────────
app.http('chat-feedback', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'chat-feedback',
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const { messageId, subjectId, isPositive } = await request.json();
            const { userId, sanitizedId } = getAuthenticatedUser(request);

            if (!messageId || !subjectId) {
                return { status: 400, body: 'Faltan campos messageId o subjectId' };
            }

            // Security Check: Enrollment-based access control
            const principal = parseClientPrincipal(request);
            const userRoles = principal?.userRoles || [];
            const isTeacherOrDirector = userRoles.includes('Docente') || userRoles.includes('Director') || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';

            if (!isTeacherOrDirector) {
                try {
                    const enrollment = await getEnrollment(subjectId, userId);
                    if (!enrollment || enrollment.status !== 'active') {
                        return { status: 403, body: JSON.stringify({ error: 'No estás matriculado en esta materia.' }) };
                    }
                } catch (err) {
                    return { status: 500, body: JSON.stringify({ error: 'Error verificando permisos.' }) };
                }
            }
        

            const blobPath = `${sanitizedId}/${subjectId}/${messageId}.json`;
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
    })
});

// ── POST /api/chat-rate ──────────────────────────────────────────────
app.http('chat-rate', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'chat-rate',
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const { sessionId, messageId, subjectId, classId, rating, comment } = await request.json();
            const { userId, sanitizedId } = getAuthenticatedUser(request);

            if (!sessionId || !messageId || !subjectId || !rating) {
                return { status: 400, body: JSON.stringify({ error: 'Faltan campos requeridos: sessionId, messageId, subjectId, rating' }) };
            }

            if (!['positive', 'negative'].includes(rating)) {
                return { status: 400, body: JSON.stringify({ error: 'rating debe ser "positive" o "negative"' }) };
            }

            const principal = parseClientPrincipal(request);
            const userRoles = principal?.userRoles || [];
            const isTeacherOrDirector = userRoles.includes('Docente') || userRoles.includes('Director') || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';

            if (!isTeacherOrDirector) {
                try {
                    const enrollment = await getEnrollment(subjectId, userId);
                    if (!enrollment || enrollment.status !== 'active') {
                        return { status: 403, body: JSON.stringify({ error: 'No estás matriculado en esta materia.' }) };
                    }
                } catch (err) {
                    return { status: 500, body: JSON.stringify({ error: 'Error verificando permisos.' }) };
                }
            }

            const tableClient = getTableClient(RATINGS_TABLE);
            try {
                await tableClient.createTable();
            } catch (createErr) {
                if (createErr.statusCode !== 409) throw createErr;
            }

            let promptVersion = '';
            try {
                const chatLog = await loadJson('chat-logs', `${sanitizedId}/${subjectId}/${messageId}.json`);
                if (chatLog?.promptVersion) promptVersion = chatLog.promptVersion;
            } catch (promptErr) {
                context.warn(`[chat-rate] Could not load chat log for promptVersion: ${promptErr?.message || promptErr}`);
            }

            await tableClient.upsertEntity({
                partitionKey: subjectId,
                rowKey: messageId,
                userId,
                subjectId,
                classId: classId || '',
                rating,
                comment: comment || '',
                promptVersion,
                createdAt: new Date().toISOString(),
            }, 'Merge');

            context.log(`[chat-rate] Rating saved: subjectId=${subjectId}, classId=${classId || 'none'}, messageId=${messageId}, rating=${rating}, userId=${sanitizedId}`);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true })
            };
        } catch (err) {
            context.error('Error guardando rating:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    })
});

// ── POST /api/chat-report-issue ──────────────────────────────────────
app.http('chat-report-issue', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'chat-report-issue',
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const { messageId, subjectId, issueDetail } = await request.json();
            const { userId, sanitizedId } = getAuthenticatedUser(request);
            const detail = String(issueDetail || '').trim();

            if (!messageId || !subjectId) {
                return { status: 400, body: JSON.stringify({ error: 'Faltan campos messageId o subjectId' }) };
            }

            const blobPath = `${sanitizedId}/${subjectId}/${messageId}.json`;
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

            try {
              const correctionId = uuidv4().replace(/-/g, '');
              await upsertCorrection({
                correctionId,
                subjectId,
                classId: log.classId || (Array.isArray(log.classes) ? log.classes[0] : '') || 'unknown',
                studentId: userId,
                question: log.question || '',
                originalAnswer: String(log.answer || '').slice(0, 2000),
                issueDetail: detail || 'Sin detalle adicional provisto por el alumno.',
                messageId,
                status: 'pending',
                createdAt: now,
              });
              context.log(`[chat-report-issue] correction persisted (correctionId=${correctionId})`);
            } catch (dbErr) {
              context.error('[chat-report-issue] Failed to persist correction to tables:', dbErr);
            }

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
    })
});

// ── GET /api/teacher/ai-feedback-alerts?subjectId={id}&limit={n} ─────
app.http('teacher-ai-feedback-alerts', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'teacher/ai-feedback-alerts',
    handler: withCorrelation(async (request, context) => {
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

        // Security Check: Subject-specific teacher enrollment
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const isDirector = principal?.userRoles?.includes('Director');

        if (!isDirector && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development') {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
                    return { status: 403, body: JSON.stringify({ error: 'No tienes permisos de docente para esta materia.' }) };
                }
            } catch (err) {
                return { status: 500, body: JSON.stringify({ error: 'Error verificando permisos de docente.' }) };
            }
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
    }),
});
