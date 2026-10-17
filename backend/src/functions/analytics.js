import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { listBlobs, loadJson } from '../services/storage.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getEnrollment } from '../services/state-store.js';
import { computeSafetyRate } from '../services/safety-rate.js';
import { resolveSafetyStatus, structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';

const CONTAINER_CHAT = 'chat-logs';

/**
 * Normaliza una pregunta para agrupar consultas idénticas sin romperla en
 * tokens: la analítica docente debe mostrar preguntas accionables, no palabras
 * sueltas (#336).
 */
function normalizeQuestion(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

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
            return structuredErrorResponse(403, 'Forbidden - Invalid Front Door ID', ErrorCategory.AUTH, 'FRONTDOOR_INVALID');
        }

        const subjectId = request.query.get('subjectId');
        if (!subjectId) {
            return structuredErrorResponse(400, 'Falta subjectId', ErrorCategory.VALIDATION, 'MISSING_SUBJECT');
        }

        try {
            const principal = parseClientPrincipal(request);
            // Application identity resolved from the allowlist (Story 10.24):
            // the pilot data key (e.g. doc-001) so enrollment lookups match.
            const userId = context.user?.id || principal?.userId || principal?.oid || 'anonymous';
            const roles = principal?.userRoles || [];
            const isDirector = roles.includes('Director');
            const isTeacher = roles.includes('Docente');

            if (!isDirector) {
                if (!isTeacher && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development') {
                    return structuredErrorResponse(403, 'Forbidden - Teacher access required', ErrorCategory.AUTH, 'FORBIDDEN');
                }
                
                // Enrollment check for teachers in production
                if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development') {
                    const enrollment = await getEnrollment(subjectId, userId);
                    if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
                        context.warn(`[Analytics] Unauthorized access: User ${userId} is not an active teacher for ${subjectId}`);
                        return structuredErrorResponse(403, 'No tienes permisos de docente para esta materia. Contactá a administración o verificá tu inscripción.', ErrorCategory.AUTH, 'ENROLLMENT_INACTIVE');
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
            // Lectura por encuentro (#420, UJ-50): agrupa las consultas por los
            // encuentros de su alcance (`classIds`) para poder leer qué se preguntó
            // en cada uno, no sólo el agregado de la unidad.
            const classMap = new Map();

            for (const blobName of recentBlobs) {
                const log = await loadJson(CONTAINER_CHAT, blobName);
                if (!log || !log.question) continue;

                // Top Questions: agrupar por pregunta completa normalizada para
                // mostrar cadenas accionables en vez de tokens sueltos (#336).
                const rawQuestion = String(log.question).trim();
                if (!rawQuestion) continue;
                const key = normalizeQuestion(rawQuestion);
                const display = rawQuestion.length > 140 ? `${rawQuestion.slice(0, 140)}…` : rawQuestion;
                const questionEntry = questionMap.get(key) || { text: display, count: 0 };
                questionEntry.count++;
                questionMap.set(key, questionEntry);

                // Cada consulta se atribuye a los encuentros de su alcance. `all`
                // no es un encuentro: es "toda la unidad", así que no entra acá.
                const logClasses = (Array.isArray(log.classIds) ? log.classIds : (log.classId ? [log.classId] : []))
                    .map((c) => String(c || '').trim())
                    .filter((c) => c && c !== 'all');
                for (const classId of logClasses) {
                    const classEntry = classMap.get(classId) || { classId, questionCount: 0, questions: new Map() };
                    classEntry.questionCount++;
                    const classQuestion = classEntry.questions.get(key) || { text: display, count: 0 };
                    classQuestion.count++;
                    classEntry.questions.set(key, classQuestion);
                    classMap.set(classId, classEntry);
                }

                // Friction Topics: la pregunta completa con feedback es el tópico.
                if (log.feedback === 'negative' || log.feedback === 'positive') {
                    const topicDisplay = rawQuestion.length > 80 ? `${rawQuestion.slice(0, 80)}…` : rawQuestion;
                    const stats = frictionMap.get(key) || { topic: topicDisplay, queries: 0, unresolved: 0 };
                    stats.queries++;
                    if (log.feedback === 'negative') stats.unresolved++;
                    frictionMap.set(key, stats);
                }
            }

            // Formatear resultados para el frontend
            const topQuestions = Array.from(questionMap.values())
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);

            const frictionTopics = Array.from(frictionMap.values())
                .sort((a, b) => b.unresolved - a.unresolved)
                .slice(0, 4);

            // Lectura por encuentro (#420, UJ-50): cada encuentro con sus consultas.
            const byClass = Array.from(classMap.values())
                .sort((a, b) => String(a.classId).localeCompare(String(b.classId)))
                .map((entry) => ({
                    classId: entry.classId,
                    questionCount: entry.questionCount,
                    topQuestions: Array.from(entry.questions.values())
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 5),
                }));

            // Fallback si no hay datos
            if (topQuestions.length === 0) {
                topQuestions.push({ text: 'Sin datos aún', count: 1 });
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topQuestions,
                    frictionTopics,
                    byClass
                })
            };

        } catch (err) {
            context.error('Error procesando analitica:', err);
            return structuredErrorResponse(500, 'Error interno procesando analitica', ErrorCategory.INTERNAL, 'INTERNAL_ERROR');
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
            return structuredErrorResponse(403, 'Forbidden - Invalid Front Door ID', ErrorCategory.AUTH, 'FRONTDOOR_INVALID');
        }

        const subjectId = request.query.get('subjectId');
        const rawDays = request.query.get('days');
        const ALLOWED_DAYS = [7, 14, 30];
        const days = ALLOWED_DAYS.includes(Number(rawDays)) ? Number(rawDays) : 30;

        try {
            const principal = parseClientPrincipal(request);
            // Application identity resolved from the allowlist (Story 10.24).
            const userId = context.user?.id || principal?.userId || principal?.oid || 'anonymous';
            const roles = principal?.userRoles || [];
            const isDirector = roles.includes('Director');
            const isTeacher = roles.includes('Docente');

            if (!isDirector) {
                if (!isTeacher && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development') {
                    return structuredErrorResponse(403, 'Forbidden - Teacher access required', ErrorCategory.AUTH, 'FORBIDDEN');
                }

                if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development' && subjectId) {
                    const enrollment = await getEnrollment(subjectId, userId);
                    if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
                        context.warn(`[SafetyRate] Unauthorized access: User ${userId} is not an active teacher for ${subjectId}`);
                        return structuredErrorResponse(403, 'No tienes permisos de docente para esta materia. Contactá a administración o verificá tu inscripción.', ErrorCategory.AUTH, 'ENROLLMENT_INACTIVE');
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
            return structuredErrorResponse(500, 'Error interno calculando Tasa Fallo Seguro', ErrorCategory.INTERNAL, 'INTERNAL_ERROR');
        }
    }))
});
