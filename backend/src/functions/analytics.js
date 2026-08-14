import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { listBlobs, loadJson } from '../services/storage.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getEnrollment } from '../services/state-store.js';
import { computeSafetyRate } from '../services/safety-rate.js';
import { resolveSafetyStatus } from '../services/error-categories.js';

const CONTAINER_CHAT = 'chat-logs';

/**
 * Normaliza y limpia una cadena para extraccion de keywords
 */
function tokenize(text) {
    if (!text) return [];
    return text.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
        .split(/\s+/)
        .filter(word => word.length > 3); // Solo palabras significativas
}

const STOP_WORDS = new Set(['para', 'como', 'esto', 'esta', 'este', 'pero', 'cuando', 'sobre', 'entre', 'donde', 'quien', 'cual', 'cuanto', 'hasta', 'desde', 'hacia']);

/**
 * GET /api/analytics?subjectId={id}
 * Procesa logs de chat para generar analitica pedagogica.
 */
app.http('get-teacher-analytics', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'analytics',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const subjectId = request.query.get('subjectId');
        if (!subjectId) {
            return { status: 400, body: 'Falta subjectId' };
        }

        try {
            const principal = parseClientPrincipal(request);
            const userId = principal?.userId || principal?.oid || 'anonymous';
            const roles = principal?.userRoles || [];
            const isDirector = roles.includes('Director');
            const isTeacher = roles.includes('Docente');

            if (!isDirector) {
                if (!isTeacher && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development') {
                    return { status: 403, body: "Forbidden - Teacher access required" };
                }
                
                // Enrollment check for teachers in production
                if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development') {
                    const enrollment = await getEnrollment(subjectId, userId);
                    if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
                        context.warn(`[Analytics] Unauthorized access: User ${userId} is not an active teacher for ${subjectId}`);
                        return { status: 403, body: "Forbidden - You are not assigned to this subject" };
                    }
                }
            }

            // 1. Listar todos los logs (limitado por prefijo si es posible, o filtrado manual)
            // Estructura: userId/subjectId/messageId.json
            const allBlobs = await listBlobs(CONTAINER_CHAT);
            const subjectBlobs = allBlobs.filter(name => name.includes(`/${subjectId}/`));

            // Para el piloto, cargamos los ultimos 200 logs para evitar timeouts
            const recentBlobs = subjectBlobs.reverse().slice(0, 200);
            
            const questionMap = new Map();
            const frictionMap = new Map();

            for (const blobName of recentBlobs) {
                const log = await loadJson(CONTAINER_CHAT, blobName);
                if (!log || !log.question) continue;

                // Procesar Top Questions (usando frases o palabras clave)
                const tokens = tokenize(log.question);
                tokens.forEach(token => {
                    if (STOP_WORDS.has(token)) return;
                    questionMap.set(token, (questionMap.get(token) || 0) + 1);
                });

                // Procesar Friction Topics (mensajes con feedback negativo)
                if (log.feedback === 'negative') {
                    // Usamos la primera palabra clave significativa como "tópico" simplificado
                    const topic = tokens.slice(0, 2).join(' ') || 'General';
                    const stats = frictionMap.get(topic) || { topic, queries: 0, unresolved: 0 };
                    stats.queries++;
                    stats.unresolved++;
                    frictionMap.set(topic, stats);
                } else if (log.feedback === 'positive') {
                    const topic = tokens.slice(0, 2).join(' ') || 'General';
                    const stats = frictionMap.get(topic) || { topic, queries: 0, unresolved: 0 };
                    stats.queries++;
                    frictionMap.set(topic, stats);
                }
            }

            // Formatear resultados para el frontend
            const topQuestions = Array.from(questionMap.entries())
                .map(([text, count]) => ({ text, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);

            const frictionTopics = Array.from(frictionMap.values())
                .sort((a, b) => b.unresolved - a.unresolved)
                .slice(0, 4);

            // Fallback si no hay datos
            if (topQuestions.length === 0) {
                topQuestions.push({ text: 'Sin datos aún', count: 1 });
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topQuestions,
                    frictionTopics
                })
            };

        } catch (err) {
            context.error('Error procesando analitica:', err);
            return { status: 500, body: 'Error interno procesando analitica' };
        }
    }))
});

// ── GET /api/safety-rate?subjectId={id} ─────────────────────────────
// Tasa Fallo Seguro: proporción de interacciones RAG que completan de forma
// segura (sin bloqueos por safety ni fallos categorizados).
app.http('get-safety-rate', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'safety-rate',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const subjectId = request.query.get('subjectId');
        const rawDays = request.query.get('days');
        const ALLOWED_DAYS = [7, 14, 30];
        const days = ALLOWED_DAYS.includes(Number(rawDays)) ? Number(rawDays) : 30;

        try {
            const principal = parseClientPrincipal(request);
            const userId = principal?.userId || principal?.oid || 'anonymous';
            const roles = principal?.userRoles || [];
            const isDirector = roles.includes('Director');
            const isTeacher = roles.includes('Docente');

            if (!isDirector) {
                if (!isTeacher && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development') {
                    return { status: 403, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
                }

                if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development' && subjectId) {
                    const enrollment = await getEnrollment(subjectId, userId);
                    if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
                        context.warn(`[SafetyRate] Unauthorized access: User ${userId} is not an active teacher for ${subjectId}`);
                        return { status: 403, body: JSON.stringify({ error: 'Forbidden - You are not assigned to this subject' }) };
                    }
                }
            }

            const data = await computeSafetyRate(context, { subjectId: subjectId || undefined, windowDays: days });

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...data,
                    status: resolveSafetyStatus(data.safetyRatePercent),
                }),
            };
        } catch (err) {
            context.error(`[SafetyRate] Error subjectId=${subjectId || 'all'}:`, err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno calculando Tasa Fallo Seguro' }) };
        }
    }))
});
