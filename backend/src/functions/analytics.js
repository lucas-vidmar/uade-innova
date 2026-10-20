import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { listBlobs, loadJson } from '../services/storage.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getEnrollment, listClassesBySubject, listPendingCorrections } from '../services/state-store.js';
import { computeSafetyRate } from '../services/safety-rate.js';
import { resolveSafetyStatus, structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';
import {
    SIN_TEMA,
    SIN_TEMA_LABEL,
    ORIGENES,
    ORIGEN_LABELS,
    buildTemario,
    classifyByTopic,
    originsOfLog,
    emptyOriginCounts,
    countOrigins,
} from '../services/topic-classifier.js';

const CONTAINER_CHAT = 'chat-logs';
const MAX_QUESTIONS_PER_TEMA = 6;
const MAX_QUESTIONS_PER_CLASS = 5;

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

            // Temario de la unidad (#420): los temas que la unidad declara
            // encuentro por encuentro (`classes[].topics`). No hay mapa propio:
            // si la unidad no declara temas, todo cae en «sin tema».
            let temario = [];
            let temarioEncuentros = [];
            try {
                const classes = await listClassesBySubject(subjectId);
                temario = buildTemario(classes);
                temarioEncuentros = (classes || []).map((klass) => ({
                    classId: klass.id,
                    title: klass.title || klass.id,
                    topics: Array.isArray(klass.topics) ? klass.topics : [],
                }));
            } catch (err) {
                context.warn(`[Analytics] No se pudo leer el temario de ${subjectId}: ${err?.message || err}`);
            }

            // Reportes abiertos (#420): lo que espera respuesta de la cátedra
            // también declara el origen de una consulta.
            let pendingMessageIds = new Set();
            try {
                const pending = await listPendingCorrections(subjectId);
                pendingMessageIds = new Set(
                    (pending || []).map((correction) => String(correction.messageId || '')).filter(Boolean),
                );
            } catch (err) {
                context.warn(`[Analytics] No se pudieron leer los reportes abiertos de ${subjectId}: ${err?.message || err}`);
            }

            const questionMap = new Map();
            const frictionMap = new Map();
            // Lectura por encuentro (#420, UJ-50): agrupa las consultas por los
            // encuentros de su alcance (`classIds`) para poder leer qué se preguntó
            // en cada uno, no sólo el agregado de la unidad.
            const classMap = new Map();
            // Agrupación por tema (#420, UJ-42): un tema declarado por la unidad
            // reúne todas sus variantes de pregunta, con el origen declarado.
            const temaMap = new Map();
            const sinTemaEntry = { tema: SIN_TEMA_LABEL, key: SIN_TEMA, count: 0, origenes: emptyOriginCounts(), questions: new Map() };
            const origenesTotales = emptyOriginCounts();

            for (const blobName of recentBlobs) {
                const log = await loadJson(CONTAINER_CHAT, blobName);
                if (!log || !log.question) continue;

                // Top Questions: agrupar por pregunta completa normalizada para
                // mostrar cadenas accionables en vez de tokens sueltos (#336).
                const rawQuestion = String(log.question).trim();
                if (!rawQuestion) continue;
                const key = normalizeQuestion(rawQuestion);
                const display = rawQuestion.length > 140 ? `${rawQuestion.slice(0, 140)}…` : rawQuestion;
                const origenes = originsOfLog(log, { pendingMessageIds });
                countOrigins(origenesTotales, origenes);
                const tema = classifyByTopic(rawQuestion, temario);
                const temaLabel = tema ? tema.tema : SIN_TEMA_LABEL;
                const temaKey = tema ? tema.key : SIN_TEMA;

                const questionEntry = questionMap.get(key) || { text: display, count: 0, tema: temaLabel, temaKey, origenes: new Set() };
                questionEntry.count++;
                origenes.forEach((origen) => questionEntry.origenes.add(origen));
                questionMap.set(key, questionEntry);

                // Tema: el grupo es el tema declarado, no el texto de la pregunta.
                const temaEntry = tema
                    ? (temaMap.get(temaKey) || { tema: tema.tema, key: temaKey, declaredIn: [...tema.declaredIn], count: 0, origenes: emptyOriginCounts(), questions: new Map() })
                    : sinTemaEntry;
                temaEntry.count++;
                countOrigins(temaEntry.origenes, origenes);
                const temaQuestion = temaEntry.questions.get(key) || { text: display, count: 0, origenes: new Set() };
                temaQuestion.count++;
                origenes.forEach((origen) => temaQuestion.origenes.add(origen));
                temaEntry.questions.set(key, temaQuestion);
                if (tema) temaMap.set(temaKey, temaEntry);

                // Cada consulta se atribuye a los encuentros de su alcance. `all`
                // no es un encuentro: es "toda la unidad", así que no entra acá.
                const logClasses = (Array.isArray(log.classIds) ? log.classIds : (log.classId ? [log.classId] : []))
                    .map((c) => String(c || '').trim())
                    .filter((c) => c && c !== 'all');
                for (const classId of logClasses) {
                    const classEntry = classMap.get(classId) || {
                        classId,
                        questionCount: 0,
                        questions: new Map(),
                        temas: new Map(),
                        origenes: emptyOriginCounts(),
                    };
                    classEntry.questionCount++;
                    countOrigins(classEntry.origenes, origenes);
                    const classQuestion = classEntry.questions.get(key) || { text: display, count: 0, origenes: new Set() };
                    classQuestion.count++;
                    origenes.forEach((origen) => classQuestion.origenes.add(origen));
                    classEntry.questions.set(key, classQuestion);

                    const classTema = classEntry.temas.get(temaKey) || {
                        tema: temaLabel,
                        key: temaKey,
                        count: 0,
                        origenes: emptyOriginCounts(),
                    };
                    classTema.count++;
                    countOrigins(classTema.origenes, origenes);
                    classEntry.temas.set(temaKey, classTema);
                    classMap.set(classId, classEntry);
                }

                // Friction Topics: la pregunta completa con feedback es el tópico.
                if (log.feedback === 'negative' || log.feedback === 'positive') {
                    const topicDisplay = rawQuestion.length > 80 ? `${rawQuestion.slice(0, 80)}…` : rawQuestion;
                    const stats = frictionMap.get(key) || { topic: topicDisplay, queries: 0, unresolved: 0, tema: temaLabel, temaKey, origenes: new Set() };
                    stats.queries++;
                    origenes.forEach((origen) => stats.origenes.add(origen));
                    if (log.feedback === 'negative') stats.unresolved++;
                    frictionMap.set(key, stats);
                }
            }

            const toOriginArray = (set) => {
                const order = [ORIGENES.SIN_MATERIAL, ORIGENES.VALORACION_BAJA, ORIGENES.REPORTE_ABIERTO, ORIGENES.SIN_SENAL];
                return order.filter((origen) => set?.has?.(origen));
            };

            // Formatear resultados para el frontend
            const topQuestions = Array.from(questionMap.values())
                .map((entry) => ({ ...entry, origenes: toOriginArray(entry.origenes) }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);

            const frictionTopics = Array.from(frictionMap.values())
                .map((entry) => ({ ...entry, origenes: toOriginArray(entry.origenes) }))
                .sort((a, b) => b.unresolved - a.unresolved)
                .slice(0, 4);

            const formatTema = (entry, limit) => ({
                tema: entry.tema,
                key: entry.key,
                declaredIn: entry.declaredIn || [],
                count: entry.count,
                origenes: entry.origenes,
                questions: Array.from(entry.questions.values())
                    .map((question) => ({ text: question.text, count: question.count, origenes: toOriginArray(question.origenes) }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, limit),
                questionVariants: entry.questions.size,
            });

            // Temas de la unidad, ordenados por volumen: los temas que se repiten
            // primero, las preguntas sueltas en el grupo explícito «sin tema».
            const topics = Array.from(temaMap.values())
                .sort((a, b) => b.count - a.count || a.tema.localeCompare(b.tema, 'es'))
                .map((entry) => formatTema(entry, MAX_QUESTIONS_PER_TEMA));

            const sinTema = formatTema(sinTemaEntry, MAX_QUESTIONS_PER_TEMA);

            // Lectura por encuentro (#420, UJ-50): cada encuentro con sus consultas
            // y sus temas, no sólo el agregado de la unidad.
            const byClass = Array.from(classMap.values())
                .sort((a, b) => String(a.classId).localeCompare(String(b.classId)))
                .map((entry) => ({
                    classId: entry.classId,
                    questionCount: entry.questionCount,
                    origenes: entry.origenes,
                    topics: Array.from(entry.temas.values())
                        .sort((a, b) => b.count - a.count || a.tema.localeCompare(b.tema, 'es')),
                    topQuestions: Array.from(entry.questions.values())
                        .map((question) => ({ text: question.text, count: question.count, origenes: toOriginArray(question.origenes) }))
                        .sort((a, b) => b.count - a.count)
                        .slice(0, MAX_QUESTIONS_PER_CLASS),
                }));

            // Fallback si no hay datos
            if (topQuestions.length === 0) {
                topQuestions.push({ text: 'Sin datos aún', count: 1, tema: SIN_TEMA_LABEL, temaKey: SIN_TEMA, origenes: [] });
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topQuestions,
                    frictionTopics,
                    byClass,
                    // De dónde sale la agrupación: el temario de la unidad y el
                    // origen de cada pregunta (UJ-42).
                    temario: {
                        source: 'classes.topics',
                        totalTemas: temario.length,
                        encuentros: temarioEncuentros,
                    },
                    topics,
                    sinTema,
                    origenes: { labels: ORIGEN_LABELS, totales: origenesTotales, consultas: Array.from(questionMap.values()).reduce((sum, q) => sum + q.count, 0) },
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
