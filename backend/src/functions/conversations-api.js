import { withCorrelation } from '../middleware/with-correlation.js';
import { withAuth } from '../middleware/with-auth.js';
import { validateFrontDoorId, parseClientPrincipal, getAuthenticatedUser } from '../services/auth-utils.js';
import { getEnrollment, saveConversation, getConversation, listConversationsByUser, deleteConversation } from '../services/state-store.js';
import { app } from '@azure/functions';

app.http('save-conversation', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'conversations/{id}',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const { subjectId, messages } = await request.json();
            const conversationId = request.params.id;
            const { userId, sanitizedId } = getAuthenticatedUser(request);

            if (!conversationId || !subjectId) {
                return { status: 400, body: JSON.stringify({ error: 'Faltan campos requeridos: conversationId, subjectId' }) };
            }

            if (!Array.isArray(messages) || messages.length === 0) {
                return { status: 400, body: JSON.stringify({ error: 'No hay mensajes para guardar' }) };
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

            const existing = await getConversation(userId, conversationId);

            const saved = await saveConversation({
                userId,
                conversationId,
                subjectId,
                messages,
                createdAt: existing?.createdAt,
                lastMessageAt: new Date().toISOString(),
            });

            context.log(`[conversations] Saved conversation ${conversationId} for user ${sanitizedId}`);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, conversationId: saved.conversationId }),
            };
        } catch (err) {
            context.error('Error guardando conversación:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    })),
});

app.http('list-conversations', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'conversations',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const subjectId = request.query.get('subjectId');
            const { userId, sanitizedId } = getAuthenticatedUser(request);

            if (!subjectId) {
                return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };
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

            const conversations = await listConversationsByUser(userId, subjectId);

            const summary = conversations.map((c) => ({
                conversationId: c.conversationId,
                subjectId: c.subjectId,
                firstQuestion: c.firstQuestion,
                messageCount: c.messageCount,
                lastMessageAt: c.lastMessageAt,
                createdAt: c.createdAt,
            }));

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(summary),
            };
        } catch (err) {
            context.error('Error listando conversaciones:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    })),
});

app.http('get-conversation', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'conversations/{id}',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const conversationId = request.params.id;
            const subjectId = request.query.get('subjectId');
            const { userId, sanitizedId } = getAuthenticatedUser(request);

            if (!conversationId || !subjectId) {
                return { status: 400, body: JSON.stringify({ error: 'Faltan conversationId o subjectId' }) };
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

            const conversation = await getConversation(userId, conversationId);

            if (!conversation) {
                return { status: 404, body: JSON.stringify({ error: 'Conversación no encontrada' }) };
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(conversation),
            };
        } catch (err) {
            context.error('Error obteniendo conversación:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    })),
});

app.http('delete-conversation', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'conversations/{id}',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const conversationId = request.params.id;
            const subjectId = request.query.get('subjectId');
            const { userId, sanitizedId } = getAuthenticatedUser(request);

            if (!conversationId || !subjectId) {
                return { status: 400, body: JSON.stringify({ error: 'Faltan conversationId o subjectId' }) };
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

            const deleted = await deleteConversation(userId, conversationId);

            if (!deleted) {
                return { status: 404, body: JSON.stringify({ error: 'Conversación no encontrada' }) };
            }

            context.log(`[conversations] Deleted conversation ${conversationId} for user ${sanitizedId}`);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true }),
            };
        } catch (err) {
            context.error('Error eliminando conversación:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    })),
});
