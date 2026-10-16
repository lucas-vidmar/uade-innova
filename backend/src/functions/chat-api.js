import { withCorrelation } from '../middleware/with-correlation.js';
import { withAuth } from '../middleware/with-auth.js';
import { validateFrontDoorId, parseClientPrincipal, getAuthenticatedUser } from '../services/auth-utils.js';
import { getEnrollment, upsertCorrection, listCorrections, getCorrection, getConversation, listConversationsByUser, deleteConversation, RATINGS_TABLE } from '../services/state-store.js';
import { CONFIG } from '../services/config.js';
import { v4 as uuidv4 } from 'uuid';
/**
 * chat-api.js — Azure Functions para feedback e historial de chat
 */
import { app } from '@azure/functions';
import { saveJson, loadJson, listBlobs, deleteBlob, getTableClient } from '../services/storage.js';

const CONTAINER_CHAT = 'chat-logs';
const CONTAINER_TEACHER_ALERTS = 'teacher-alerts';
const CONTAINER_CLASSES = CONFIG.containers.classes;

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

async function resolveClassName(subjectId, classId) {
    if (!subjectId || !classId) return '';
    try {
        const classes = await loadJson(CONTAINER_CLASSES, `${subjectId}.json`);
        if (!Array.isArray(classes)) return '';
        const match = classes.find((c) => String(c.id) === String(classId));
        return match?.title ? String(match.title) : '';
    } catch {
        return '';
    }
}

function missingKeywordTeacherMessage(keyword, className) {
    const base = `Un alumno reportó que el concepto '${keyword}' no aparece en los materiales`;
    return className ? `${base} de ${className}` : `${base} de la materia`;
}

// ── GET /api/chat-history?subjectId={id} ─────────────────────────────
app.http('get-chat-history', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'chat-history',
    handler: withCorrelation(withAuth(async (request, context) => {
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

            // #331: conversations saved via PUT /api/conversations/{id}
            // (ChatWidget auto-save) live in the Conversations table, not in
            // chat-logs blobs. Merge them so just-created chats surface in
            // Chats recientes instead of vanishing until the next RAG turn
            // writes a chat-log. Dedupe by sessionId: a session already
            // present from chat-logs keeps the richer (sourced) blob entry.
            try {
                const conversations = await listConversationsByUser(userId, subjectId);
                const knownSessions = new Set(history.map((h) => h.sessionId || h.id).filter(Boolean));
                for (const c of conversations || []) {
                    const sessionId = c.conversationId;
                    if (!sessionId || knownSessions.has(sessionId)) continue;
                    knownSessions.add(sessionId);
                    const msgs = Array.isArray(c.messages) ? c.messages : [];
                    const lastAssistant = [...msgs].reverse().find((m) => m?.role === 'assistant');
                    history.push({
                        id: sessionId,
                        sessionId,
                        subjectId: c.subjectId || subjectId,
                        question: c.firstQuestion || msgs.find((m) => m?.role === 'user')?.content || '',
                        answer: lastAssistant?.content || '',
                        sources: lastAssistant?.sources || [],
                        messageCount: c.messageCount || msgs.length,
                        timestamp: c.lastMessageAt || c.createdAt || new Date().toISOString(),
                        createdAt: c.createdAt || c.lastMessageAt || new Date().toISOString(),
                    });
                }
            } catch (mergeErr) {
                context.warn?.('[chat-history] Could not merge conversations table (non-blocking):', mergeErr?.message || mergeErr);
            }

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
    }))
});


// ── DELETE /api/chat-history?subjectId={id}[&sessionId={id}] ──────────
// El listado de "Chats recientes" se arma con los blobs de chat-logs (un blob
// por turno), no con la tabla Conversations. Borrar sólo la fila de
// Conversations dejaba el hilo reaparecer en el listado y accesible por
// enlace directo, así que el borrado de un hilo tiene que alcanzar a las dos
// representaciones: los blobs de sus turnos y su fila de Conversations.
// Sin `sessionId` se mantiene el borrado completo del historial.
app.http('delete-chat-history', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'chat-history',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const subjectId = request.query.get('subjectId');
        const sessionId = request.query.get('sessionId');
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

            let deletedBlobs = 0;
            let deletedConversations = 0;

            if (sessionId) {
                for (const name of blobNames) {
                    const log = await loadJson(CONTAINER_CHAT, name);
                    const blobSessionId = log?.sessionId || log?.id || null;
                    if (blobSessionId !== sessionId) continue;
                    await deleteBlob(CONTAINER_CHAT, name);
                    deletedBlobs += 1;
                }
                const conversationDeleted = await deleteConversation(userId, sessionId).catch(() => false);
                deletedConversations = conversationDeleted ? 1 : 0;
                context.log(`[chat-history] Hilo ${sessionId} borrado (blobs=${deletedBlobs}, conversaciones=${deletedConversations}, user=${sanitizedId}, subject=${subjectId})`);
            } else {
                for (const name of blobNames) {
                    await deleteBlob(CONTAINER_CHAT, name);
                    deletedBlobs += 1;
                }
                try {
                    const conversations = await listConversationsByUser(userId, subjectId);
                    for (const conversation of conversations || []) {
                        if (!conversation?.conversationId) continue;
                        if (await deleteConversation(userId, conversation.conversationId)) deletedConversations += 1;
                    }
                } catch (convErr) {
                    context.warn?.(`[chat-history] No se pudieron borrar las conversaciones guardadas: ${convErr?.message || convErr}`);
                }
                context.log(`[chat-history] Historial completo borrado (blobs=${deletedBlobs}, conversaciones=${deletedConversations}, user=${sanitizedId}, subject=${subjectId})`);
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, count: deletedBlobs, conversationsDeleted: deletedConversations, sessionId: sessionId || null }),
            };
        } catch (err) {
            context.error('Error eliminando historial:', err);
            return { status: 500, body: 'Error interno' };
        }
    }))
});

// ── POST /api/chat-feedback ──────────────────────────────────────────
// #330: todas las respuestas son JSON con Content-Type explícito — el
// frontend hace `res.json()` y un body de texto plano ('Mensaje no...')
// rompía con `SyntaxError: Unexpected token 'M'` tragado en silencio.
app.http('chat-feedback', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'chat-feedback',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        let payload;
        try {
            payload = await request.json();
        } catch {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Body JSON inválido', code: 'INVALID_JSON' }) };
        }
        try {
            const { messageId, subjectId, isPositive } = payload || {};
            const { userId, sanitizedId } = getAuthenticatedUser(request);

            if (!messageId || !subjectId) {
                return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Faltan campos messageId o subjectId', code: 'MISSING_FIELDS' }) };
            }

            // Security Check: Enrollment-based access control
            const principal = parseClientPrincipal(request);
            const userRoles = principal?.userRoles || [];
            const isTeacherOrDirector = userRoles.includes('Docente') || userRoles.includes('Director') || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';

            if (!isTeacherOrDirector) {
                try {
                    const enrollment = await getEnrollment(subjectId, userId);
                    if (!enrollment || enrollment.status !== 'active') {
                        return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No estás matriculado en esta materia.' }) };
                    }
                } catch (err) {
                    return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error verificando permisos.' }) };
                }
            }
        

            const blobPath = `${sanitizedId}/${subjectId}/${messageId}.json`;
            const log = await loadJson(CONTAINER_CHAT, blobPath);

            if (!log) {
                return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Mensaje no encontrado', code: 'MESSAGE_NOT_FOUND' }) };
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
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error interno' }) };
        }
    }))
});

// ── POST /api/chat-rate ──────────────────────────────────────────────
app.http('chat-rate', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'chat-rate',
    handler: withCorrelation(withAuth(async (request, context) => {
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
    }))
});

// ── POST /api/chat-report-issue ──────────────────────────────────────
app.http('chat-report-issue', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'chat-report-issue',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const { messageId, subjectId, issueDetail, question, answer, type, classId: reportClassId } = await request.json();
            const { userId, sanitizedId } = getAuthenticatedUser(request);
            const detail = String(issueDetail || '').trim();
            const reportType = type === 'missing-info' ? 'missing-info' : type === 'missing-keyword' ? 'missing-keyword' : 'ai-feedback-issue';

            if (!messageId || !subjectId) {
                return { status: 400, body: JSON.stringify({ error: 'Faltan campos messageId o subjectId' }) };
            }
            if (reportType === 'missing-keyword' && detail.length < 2) {
                return { status: 400, body: JSON.stringify({ error: 'El concepto reportado es obligatorio.' }) };
            }

            const now = new Date().toISOString();

            let resolvedQuestion = question || '';
            let resolvedAnswer = answer || '';
            let resolvedClassId = '';
            let blobFound = false;

            const blobPath = `${sanitizedId}/${subjectId}/${messageId}.json`;
            try {
                const log = await loadJson(CONTAINER_CHAT, blobPath);
                if (log) {
                    blobFound = true;
                    resolvedQuestion = resolvedQuestion || log.question || '';
                    resolvedAnswer = resolvedAnswer || log.answer || '';
                    resolvedClassId = log.classId || (Array.isArray(log.classes) ? log.classes[0] : '') || '';
                    log.reportedIssue = {
                        reportedAt: now,
                        detail,
                        reporterUserId: userId,
                        status: 'open',
                    };
                    await saveJson(CONTAINER_CHAT, blobPath, log);
                }
            } catch (blobErr) {
                context.warn(`[chat-report-issue] Could not load/save chat log blob (non-fatal): ${blobErr?.message || blobErr}`);
            }

            const alertId = `${reportType === 'missing-keyword' ? 'missing-kw' : 'ai-issue'}-${messageId}`;
            const resolvedClassIdFinal = reportClassId || resolvedClassId || '';
            const keywordMessage = reportType === 'missing-keyword'
                ? missingKeywordTeacherMessage(detail, await resolveClassName(subjectId, resolvedClassIdFinal))
                : '';
            const alert = {
                id: alertId,
                type: reportType,
                status: 'open',
                subjectId,
                messageId,
                reporterUserId: userId,
                question: resolvedQuestion,
                answerExcerpt: String(resolvedAnswer).slice(0, 240),
                issueDetail: detail || 'Sin detalle adicional provisto por el alumno.',
                keyword: reportType === 'missing-keyword' ? detail : undefined,
                message: keywordMessage || undefined,
                classId: resolvedClassIdFinal,
                createdAt: now,
            };

            await saveJson(CONTAINER_TEACHER_ALERTS, `${subjectId}/${alertId}.json`, alert);

            try {
              const correctionId = uuidv4().replace(/-/g, '');
              await upsertCorrection({
                correctionId,
                subjectId,
                classId: resolvedClassIdFinal || 'unknown',
                studentId: userId,
                question: resolvedQuestion,
                originalAnswer: String(resolvedAnswer).slice(0, 2000),
                issueDetail: detail || 'Sin detalle adicional provisto por el alumno.',
                message: keywordMessage || '',
                messageId,
                type: reportType,
                status: 'pending',
                createdAt: now,
              });
              context.log(`[chat-report-issue] correction persisted (correctionId=${correctionId})`);
            } catch (dbErr) {
              context.error('[chat-report-issue] Failed to persist correction to tables:', dbErr);
            }

            context.log(`[chat-report-issue] issue reported (subject=${subjectId}, messageId=${messageId}, type=${reportType}, blobFound=${blobFound})`);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, alertId }),
            };
        } catch (err) {
            context.error('Error reportando issue de chat:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    }))
});

// ── GET /api/student-reports?subjectId={id} ──────────────────────────
app.http('student-reports', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'student-reports',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const subjectId = request.query.get('subjectId');
        if (!subjectId) {
            return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        const { userId, sanitizedId } = getAuthenticatedUser(request);

        const principal = parseClientPrincipal(request);
        const userRoles = principal?.userRoles || [];
        const isTeacherOrDirector = userRoles.includes('Docente') || userRoles.includes('Director') || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isTeacherOrDirector) {
            // Application id resolved from the allowlist (Story 10.24): matches
            // the pilot student keys (alu-001) in Enrollments and corrections.
            const studentUserId = context.user?.id || userId;
            const enrollment = await getEnrollment(subjectId, studentUserId).catch(() => null);
            if (!enrollment || enrollment.status !== 'active') {
                return { status: 403, body: JSON.stringify({ error: 'No estás matriculado en esta materia.', errorCategory: 'AUTH', code: 'ENROLLMENT_INACTIVE' }) };
            }
        }

        try {
            const allCorrections = await listCorrections(subjectId);
            const selfUserId = context.user?.id || userId;
            const myReports = allCorrections
                .filter(c => c.studentId === selfUserId)
                .map(c => ({
                    correctionId: c.correctionId,
                    question: c.question,
                    issueDetail: c.issueDetail,
                    status: c.status,
                    classId: c.classId,
                    createdAt: c.createdAt,
                    resolvedAt: c.resolvedAt,
                    comments: c.comments || '',
                }))
                .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, data: myReports, count: myReports.length }),
            };
        } catch (err) {
            context.error('[student-reports] Error:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno obteniendo reportes.' }) };
        }
    })),
});

// ── GET /api/corrections-chat-context?subjectId={id}&correctionId={id} ─
app.http('corrections-chat-context', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'corrections-chat-context',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden' }) };

        const subjectId = request.query.get('subjectId');
        const correctionId = request.query.get('correctionId');
        if (!subjectId || !correctionId) {
            return { status: 400, body: JSON.stringify({ error: 'Faltan subjectId y correctionId' }) };
        }

        const principal = parseClientPrincipal(request);
        const isTeacherOrDirector = principal?.userRoles?.some(r => ['Docente', 'Director'].includes(r)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isTeacherOrDirector) {
            return { status: 403, body: JSON.stringify({ error: 'Acceso denegado.' }) };
        }

        try {
            const correction = await getCorrection(subjectId, correctionId);
            if (!correction) {
                return { status: 404, body: JSON.stringify({ error: 'Corrección no encontrada.' }) };
            }

            const { userId } = getAuthenticatedUser(request);
            const messageId = correction.messageId;

            // 1. Intentar cargar el chat log de ese mensaje específico
            let chatLog = null;
            if (messageId) {
                try {
                    chatLog = await loadJson(CONTAINER_CHAT, `${userId}/${subjectId}/${messageId}.json`);
                } catch { }
            }

            // 2. Si el chat log tiene sessionId, cargar la conversación completa
            let messages = [];
            if (chatLog?.sessionId) {
                try {
                    const conversation = await getConversation(chatLog.sessionId, subjectId);
                    if (conversation?.messages) {
                        messages = conversation.messages;
                    }
                } catch { }
            }

            // 3. Fallback: construir mensajes desde el chat log
            if (messages.length === 0 && chatLog) {
                messages = [
                    { role: 'user', content: chatLog.question || '' },
                    { role: 'assistant', content: chatLog.answer || '' },
                ];
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, data: { messages, chatLog } }),
            };
        } catch (err) {
            context.error('[corrections-chat-context] Error:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno.' }) };
        }
    })),
});

// ── GET /api/teacher/ai-feedback-alerts?subjectId={id}&limit={n} ─────
app.http('teacher-ai-feedback-alerts', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'teacher/ai-feedback-alerts',
    handler: withCorrelation(withAuth(async (request, context) => {
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
    })),
});
