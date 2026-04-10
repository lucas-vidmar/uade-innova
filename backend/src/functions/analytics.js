import { app } from '@azure/functions';
import { listBlobs, loadJson } from '../services/storage.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';

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
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const subjectId = request.query.get('subjectId');
        if (!subjectId) {
            return { status: 400, body: 'Falta subjectId' };
        }

        try {
            const principal = parseClientPrincipal(request);
            const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';

            if (!isAuthorized) {
                return { status: 403, body: "Forbidden - Teacher access required" };
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
            context.log.error('Error procesando analitica:', err);
            return { status: 500, body: 'Error interno procesando analitica' };
        }
    }
});
