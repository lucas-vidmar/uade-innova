/**
 * rag-query.js — POST /api/rag-query
 * Motor RAG: embedding de la pregunta → similitud Pinecone → chat con contexto
 */
import { app } from '@azure/functions';
import { generateEmbedding, chatCompletion, getChatModelName, getModelDisplayName, resolveModelForTask } from '../services/ai.js';
import { querySimilar } from '../services/vector-store.js';
import { saveJson, loadJson, saveMetricsToTable } from '../services/storage.js';
import { getShadowPrompt, getActivePrompt } from '../services/prompts.js';
import { trackRAGInteraction, trackRAGError, trackUnansweredQuery } from '../services/telemetry.js';
import { parseClientPrincipal, validateFrontDoorId, getAuthenticatedUser } from '../services/auth-utils.js';
import { normalizeCategorizedError, ErrorCategory } from '../services/error-categories.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { withRateLimit } from '../middleware/with-rate-limit.js';
import { withAuth } from '../middleware/with-auth.js';
import { createStructuredLogger } from '../services/structured-logger.js';
import { v4 as uuidv4 } from 'uuid';
import { listMaterialsBySubject, listReviewedCorrections } from '../services/state-store.js';
import { getEnrollment, getConsentStatus } from '../services/state-store.js';
import { getGlossary } from '../services/glossary-store.js';
import { getSubjectWeights } from '../services/subject-weights.js';
import { CONFIG } from '../services/config.js';
import {
    MAX_RAG_CHUNKS, RETRIEVAL_CANDIDATES, MAX_CHUNKS_PER_SOURCE,
    filterMatchesByTranscriptFocus, buildHybridContext, diversifyBySourceFile,
    resolveMaterialPriority, resolveSourceMix, resolveSelectedClassCount, resolveFilterType
} from '../services/rag-ranking.js';
import { isQuarantined } from '../services/vector-audit.js';
const MIN_HISTORY_TURNS = CONFIG.history.minTurns;
const MAX_HISTORY_TURNS = CONFIG.history.maxTurns;
const DEFAULT_HISTORY_TURNS = CONFIG.history.defaultTurns;

function sanitizeTurn(turn) {
    if (!turn || typeof turn !== 'object') return null;
    const role = turn.role === 'assistant' ? 'assistant' : turn.role === 'user' ? 'user' : null;
    const content = typeof turn.content === 'string' ? turn.content.trim() : '';
    if (!role || !content) return null;
    return { role, content };
}

function normalizeConversationHistory(rawHistory, requestedWindowSize) {
    if (!Array.isArray(rawHistory) || rawHistory.length === 0) return [];
    const parsedWindow = Number.isInteger(requestedWindowSize) ? requestedWindowSize : DEFAULT_HISTORY_TURNS;
    const boundedWindow = Math.max(MIN_HISTORY_TURNS, Math.min(MAX_HISTORY_TURNS, parsedWindow));
    return rawHistory
        .map(sanitizeTurn)
        .filter(Boolean)
        .slice(-boundedWindow);
}

async function rewriteQuestionWithHistory(question, conversationHistory, context) {
    if (!conversationHistory.length) return question;

    const rewritePrompt = await getActivePrompt('rewrite').catch(() => null);
    const rewriteSystemPrompt = rewritePrompt?.content || `Reescribe la ultima pregunta del estudiante para que sea autonoma y clara.
Debes conservar fielmente el significado original sin agregar informacion nueva.
Devuelve unicamente la pregunta reescrita en espanol, sin comillas ni explicaciones.`;

    const historyText = conversationHistory
        .map((turn, index) => `${index + 1}. ${turn.role === 'assistant' ? 'Asistente' : 'Estudiante'}: ${turn.content}`)
        .join('\n');

    const rewriteMessages = [
        { role: 'system', content: rewriteSystemPrompt },
        {
            role: 'user',
            content: `Historial reciente:\n${historyText}\n\nPregunta actual: ${question}`,
        },
    ];

    try {
        const rewriteModel = rewritePrompt?.model || await resolveModelForTask('rewrite');
        const rewritten = await chatCompletion(rewriteMessages, false, {
            model: rewriteModel,
            temperature: 0,
            max_tokens: 120,
            headers: context?.dependencyHeaders,
        });
        const rewrittenQuestion = rewritten?.content?.trim();
        if (!rewrittenQuestion) return question;
        context.log(`[RAG] Follow-up rewrite aplicado: "${question}" -> "${rewrittenQuestion}"`);
        return rewrittenQuestion;
    } catch (err) {
        context.error('[RAG] Error reescribiendo follow-up. Se usa pregunta original:', err);
        return question;
    }
}

function jsonResponse(status, payload) {
    return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    };
}

const GLOSSARY_NOT_FOUND_MSG = 'No encontré ese término en el glosario de la materia. ¿Querés preguntarle al docente que lo agregue?';

/**
 * Construye la respuesta del fast-path de glosario (Story 11.1.6).
 * Determinística: devuelve la definición del término (o el mensaje de
 * "no encontrado" del AC) sin embedding ni LLM, marcando el badge
 * `glossary` en la metadata SSE / payload JSON para que la UI renderice
 * "📖 Glosario".
 */
function buildGlossaryResponse({ answer, glossaryMeta, stream }) {
    if (stream) {
        const encoder = new TextEncoder();
        const interactionId = uuidv4();
        const responseStream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify({ interactionId, sources: [], glossary: glossaryMeta, model: getChatModelName() })}\n\n`));
                controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ content: answer })}\n\n`));
                controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ answer })}\n\n`));
                controller.close();
            }
        });
        return {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
            body: responseStream,
        };
    }
    return jsonResponse(200, { id: uuidv4(), answer, sources: [], glossary: glossaryMeta });
}

/**
 * Detecta una consulta de definición de término ("¿qué significa X?") y
 * extrae el término buscado. Devuelve el término o null si no aplica.
 */
function extractGlossaryTerm(question) {
    const glossaryPattern = /(?:qu[eé]\s*significa|qu[eé]\s*es|definici[oó]n\s*de|definime|explic[aá]|significado\s*de)\s+[""]?([\w\sáéíóúñüÁÉÍÓÚÑÜ]+)[""]?\??/i;
    const match = question.match(glossaryPattern);
    const term = match?.[1]?.trim();
    return term || null;
}

/**
 * Construye el bloque <preferencias_asistente> a partir de las preferencias
 * de tono/longitud del alumno (story #223 / 11-5-1). Devuelve '' si no hay
 * preferencias configuradas.
 */
function buildPreferencesBlock({ botTone, botLength, includeSources }) {
    const instructions = [];

    const TONE = {
        formal: 'Usá un tono formal y académico, sin coloquialismos.',
        didactic: 'Usá un tono didáctico y cercano, explicando los conceptos paso a paso.',
        concise: 'Usá un tono directo y resumido, yendo al punto sin rodeos.',
    };
    const LENGTH = {
        concise: 'Respondé de forma concisa. Usá breves párrafos y evitá desarrollos extensos.',
        detailed: 'Respondé de forma detallada y completa, desarrollando los conceptos con profundidad.',
    };

    if (TONE[botTone]) instructions.push(TONE[botTone]);
    if (LENGTH[botLength]) instructions.push(LENGTH[botLength]);
    if (includeSources === false) {
        instructions.push('No enumeres ni listes las fuentes en la respuesta.');
    }

    if (instructions.length === 0) return '';

    return `\n\n<preferencias_asistente>\n${instructions.map(i => `- ${i}`).join('\n')}\n</preferencias_asistente>`;
}

function buildPineconeFilter(subjectId, classIds, disableBibliographyFallback = false) {
    // Todo filtro RAG excluye vectores cuarentenados (defense-in-depth, Story 10.17).
    // El campo `quarantined` es always-present tras una corrida de normalizacion,
    // de modo que `{ $ne: true }` solo excluye los marcados en cuarentena.
    if (!classIds || classIds.length === 0 || classIds.includes('all')) {
        return { subjectId: { $eq: subjectId }, quarantined: { $ne: true } };
    }

    const isSingleClass = classIds.length === 1 && classIds[0] !== 'all';

    const classClause = isSingleClass
        ? { classId: { $eq: classIds[0] } }
        : { classIds: { $in: classIds } };

    const clauses = [classClause];

    if (!disableBibliographyFallback) {
        clauses.push({ materialType: { $eq: 'bibliography' } });
    }

    return {
        subjectId: { $eq: subjectId },
        $or: clauses,
        quarantined: { $ne: true },
    };
}

function handleErrorResponse(status, message, category, isStream, code = null) {
    if (isStream) {
        const encoder = new TextEncoder();
        // #338: propagate the machine-readable error code through the SSE
        // path so the UI can distinguish CONSENT_REQUIRED (terms CTA) from
        // generic AUTH denials instead of falling back to the wrong copy.
        const payload = { error: message, errorCategory: category };
        if (code) payload.code = code;
        const body = JSON.stringify(payload);
        const responseStream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(`event: error\ndata: ${body}\n\n`));
                controller.close();
            }
        });
        return {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
            },
            body: responseStream
        };
    }
    const payload = { error: message, errorCategory: category };
    if (code) payload.code = code;
    return jsonResponse(status, payload);
}

app.http('rag-query', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'rag-query',
    handler: withCorrelation(withRateLimit(withAuth(async (request, context) => {
        const { correlationId, dependencyHeaders } = context;

        const log = createStructuredLogger('rag-query', context);
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
        log.info('rag-query triggered');
        const user = context.user || getAuthenticatedUser(request);
        const userId = user?.userId || 'anonymous';
        const sanitizedId = user?.sanitizedId || String(userId).replace(/[^a-zA-Z0-9]/g, '_');
        log.info('RAG query start', { correlationId, userId });

        // Capture start time for end-to-end latency measurement (Issue #69)
        const startTime = Date.now();

        // ── 1. Parsear request ────────────────────────────────────
        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse(400, { error: 'Body JSON inválido' });
        }

        const { question, classIds, subjectId, sessionId, stream = false, conversationHistory, historyWindowSize, transcriptFocus, sandbox = false, simulateStudent = false, botTone, botLength, includeSources } = body;

        if (!question || !subjectId) {
                return jsonResponse(400, { error: 'Faltan campos requeridos: question, subjectId' });
        }

        const recentConversationHistory = normalizeConversationHistory(conversationHistory, historyWindowSize);

        const principal = context.principal || parseClientPrincipal(request);
        const userRoles = principal?.userRoles || [];
        const isTeacherOrDirector = userRoles.includes('Docente') || userRoles.includes('Director');

        // ── 1b. Sandbox mode (teacher RAG playground) ────────────────────
        // sandbox is accepted via query string (?sandbox=true) OR body. When
        // active, enrollment + consent gates are bypassed unconditionally and
        // the teacher subject scope (subjectId/classIds) drives retrieval.
        const sandboxMode = sandbox === true || request.query?.get?.('sandbox') === 'true';
        const simulateStudentMode = sandboxMode && simulateStudent === true;

        // ── 1b2. Sandbox requires Docente/Director role ─────────────────
        // The frontend route is teacher-only (client-side guard), but the backend
        // is authLevel:anonymous — so the role must be verified server-side to
        // prevent students from bypassing enrollment/consent/reviewed filters.
        if (sandboxMode && principal && !isTeacherOrDirector) {
            context.log(`[RAG] Sandbox denied: no es Docente/Director. userId=${userId}, subjectId=${subjectId}`);
            return jsonResponse(403, {
                error: 'SANDBOX_FORBIDDEN',
                message: 'El sandbox de RAG solo está disponible para docentes y directores.',
            });
        }

        if (sandboxMode) {
            context.log(`[RAG] Sandbox mode active: userId=${userId}, subjectId=${subjectId}, simulateStudent=${simulateStudentMode}`);
        }

        // ── 1c. Enrollment access check ──────────────────────────────────
        const enrollment = await getEnrollment(subjectId, userId).catch(() => null);


        if (!sandboxMode && !isTeacherOrDirector && principal) {
            if (!enrollment || enrollment.status !== 'active') {
                context.log(`[Enrollment] Access denied: userId=${userId}, subjectId=${subjectId}`);
                return jsonResponse(403, {
                    error: 'ENROLLMENT_REQUIRED',
                    message: 'No estás matriculado en esta materia. Contactá a administración.',
                });
            }
        }

        // ── 1d. AI content consent check ────────────────────────────────
        if (!sandboxMode && !isTeacherOrDirector && principal) {
            const consentAccepted = await getConsentStatus(userId).catch(() => false);
            if (!consentAccepted) {
                context.log(`[Consent] Consent required: userId=${userId}`);
                return jsonResponse(403, {
                    success: false,
                    error: { code: 'CONSENT_REQUIRED', message: 'Debés aceptar los términos de uso antes de usar el chat.', errorCategory: 'AUTH' },
                    meta: { timestamp: new Date().toISOString(), requestId: correlationId },
                });
            }
        }

        const rewrittenQuestion = await rewriteQuestionWithHistory(question, recentConversationHistory, context);

        context.log(`Pregunta: "${question}" | Reescrita: "${rewrittenQuestion}" | Materia: ${subjectId} | Clases: ${classIds?.join(',') || 'todas'} | Session: ${sessionId || 'auto'}`);

        // ── 1e. Glossary fast-path (Story 11.1.6) ──────────────────
        // Si la pregunta pide la definición de un término ("¿qué significa X?")
        // y la materia tiene glosario, se responde determinísticamente desde el
        // glosario: definición con badge 📖 Glosario, o el mensaje de "no
        // encontrado" del AC. Si no hay glosario configurado se cae al pipeline
        // RAG normal.
        const glossaryLookupTerm = extractGlossaryTerm(rewrittenQuestion || question);
        if (glossaryLookupTerm) {
            try {
                const glossary = await getGlossary(subjectId);
                if (glossary && Array.isArray(glossary.terms) && glossary.terms.length > 0) {
                    const found = glossary.terms.find((t) => {
                        const termNorm = (s) => String(s || '').trim().toLowerCase();
                        const search = termNorm(glossaryLookupTerm);
                        const aliases = Array.isArray(t.aliases) ? t.aliases : [];
                        return (
                            termNorm(t.term) === search ||
                            termNorm(t.term).includes(search) ||
                            aliases.some((a) => termNorm(a) === search || termNorm(a).includes(search))
                        );
                    });
                    if (found) {
                        const definition = String(found.definition || '').trim();
                        const answer = definition
                            ? `**${found.term}**: ${definition}`
                            : `**${found.term}** está en el glosario de la materia, pero el docente aún no cargó su definición.`;
                        context.log(`[RAG] Glossary fast-path HIT: term="${found.term}" subjectId=${subjectId}`);
                        return buildGlossaryResponse({
                            answer,
                            glossaryMeta: { found: true, term: found.term, definition },
                            stream,
                        });
                    }
                    context.log(`[RAG] Glossary fast-path MISS: term="${glossaryLookupTerm}" subjectId=${subjectId}`);
                    return buildGlossaryResponse({
                        answer: GLOSSARY_NOT_FOUND_MSG,
                        glossaryMeta: { found: false, term: glossaryLookupTerm },
                        stream,
                    });
                }
            } catch (glossaryErr) {
                context.warn('[RAG] Error loading glossary (non-blocking):', glossaryErr.message);
            }
        }

        // ── 2. Embedding de la pregunta ───────────────────────────
        let questionEmbedding;
        let embeddingUsage;
        try {
            const embeddingResult = await generateEmbedding(rewrittenQuestion, { headers: dependencyHeaders });
            questionEmbedding = embeddingResult.embedding;
            embeddingUsage = embeddingResult.usage;
        } catch (err) {
            const categorizedError = normalizeCategorizedError(err, ErrorCategory.LLM);
            context.error('Error generando embedding:', categorizedError);
            trackRAGError({
                errorCategory: categorizedError.errorCategory,
                code: categorizedError.code,
                message: categorizedError.message,
                subjectId,
                userId,
                correlationId,
                stackTrace: err?.stack,
            }).catch(e => context.error('[Telemetry] Error emitting RAGErrorCategorized (embedding):', e));
            return handleErrorResponse(categorizedError.status, `Error procesando la pregunta (embedding): ${categorizedError.message}`, categorizedError.errorCategory, stream, categorizedError.code);
        }

        // ── 3. Filtro Pinecone por subjectId y classIds ───────────
        const disableBibliographyFallback = process.env.RAG_DISABLE_BIBLIOGRAPHY_FALLBACK === 'true';
        const filter = buildPineconeFilter(subjectId, classIds, disableBibliographyFallback);
        const filterType = resolveFilterType(classIds);

        // ── 3b. Verified-answer-first pre-search ──────────────────
        const VERIFIED_SCORE_THRESHOLD = 0.85;
        const verifiedFilter = {
            subjectId: { $eq: subjectId },
            materialType: { $eq: 'verified-answer' },
            quarantined: { $ne: true },
        };

        let verifiedMatch = null;
        let verifiedAnswerText = '';

        try {
            const verifiedMatches = await querySimilar(questionEmbedding, verifiedFilter, 5, { correlationId });
            // Pass-6 fix: buscar el primer match no-cuarentenado por encima del
            // umbral (no solo el top-1), para que un match cuarentenado rank-1 no
            // eclipse a un verified-answer limpio rank-2 (defense-in-depth).
            const topVerified = verifiedMatches.find((m) => !isQuarantined(m.metadata) && m.score > VERIFIED_SCORE_THRESHOLD);
            // Loopback 1/4.3: un verifiedMatch cuarentenado se descarta (el fast
            // path no debe devolver contenido que pudo quedar flaggeado).
            if (topVerified) {
                verifiedMatch = topVerified;
                verifiedAnswerText = topVerified.metadata?.text || topVerified.metadata?.correctedAnswer || '';
                context.log(`[RAG] Verified answer match (score=${topVerified.score.toFixed(3)}) — bypassing LLM`);
            }
        } catch (err) {
            context.error('[RAG] Error in verified-answer pre-search (non-blocking):', err);
        }

        if (verifiedMatch && verifiedAnswerText) {
            context.log('[RAG] Returning verified answer — skipping standard search and LLM');
            const verifiedSources = [{
                materialType: 'verified-answer',
                subjectId: verifiedMatch.metadata?.subjectId,
                classId: verifiedMatch.metadata?.classId ?? verifiedMatch.metadata?.classIds?.[0],
                chunkIndex: 0,
                sourceFilename: verifiedMatch.metadata?.sourceFilename || '',
                score: Math.round(verifiedMatch.score * 100) / 100,
            }];
            const interactionId = uuidv4();

            if (stream) {
                const responseStream = new ReadableStream({
                    start(controller) {
                        const encoder = new TextEncoder();
                        controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify({ interactionId, sources: verifiedSources, verified: true, verifiedBy: verifiedMatch.metadata?.teacherId, model: getChatModelName() })}\n\n`));
                        controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ content: verifiedAnswerText })}\n\n`));
                        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ answer: verifiedAnswerText })}\n\n`));
                        controller.close();
                    }
                });
                return {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                    },
                    body: responseStream,
                };
            }

            return jsonResponse(200, { id: interactionId, answer: verifiedAnswerText, sources: verifiedSources, verified: true, verifiedBy: verifiedMatch.metadata?.teacherId });
        }

        // ── 3c. Cargar pesos de material type por materia ────────
        let materialWeights = null;
        try {
            const weightResult = await getSubjectWeights(subjectId);
            materialWeights = weightResult.weights;
        } catch (weightErr) {
            context.error('[RAG] Error loading subject weights (non-blocking):', weightErr);
        }

        // ── 4. Búsqueda de similitud en Pinecone ──────────────────
        let matches;
        try {
            matches = await querySimilar(questionEmbedding, filter, RETRIEVAL_CANDIDATES, { correlationId });
        } catch (err) {
            const categorizedError = normalizeCategorizedError(err, ErrorCategory.RETRIEVAL_FAILURE);
            context.error('Error consultando Pinecone:', categorizedError);
            trackRAGError({
                errorCategory: categorizedError.errorCategory,
                code: categorizedError.code,
                message: categorizedError.message,
                subjectId,
                userId,
                classIds,
                correlationId,
                stackTrace: err?.stack,
            }).catch(e => context.error('[Telemetry] Error emitting RAGErrorCategorized (Pinecone):', e));
            return handleErrorResponse(categorizedError.status, `Error buscando en la base de conocimiento: ${categorizedError.message}`, categorizedError.errorCategory, stream, categorizedError.code);
        }

        matches = filterMatchesByTranscriptFocus(matches, transcriptFocus);

        // ── 4a. Post-filter de cuarentena (defense-in-depth) ───────
        // Incluso si el filtro de Pinecone fallara o la propagacion de metadata
        // estuviera incompleta, un source cuarentenado no debe llegar al LLM.
        const preQuarantineCount = matches.length;
        matches = matches.filter((m) => !isQuarantined(m.metadata));
        if (matches.length !== preQuarantineCount) {
            const dropped = preQuarantineCount - matches.length;
            context.log(`[RAG] Quarantine post-filter: se descartaron ${dropped} matches cuarentenados (subjectId=${subjectId}, correlationId=${correlationId})`);
        }

        // ── 4a2. Post-filter de subjectId (#328, mismatch-only) ────
        // Vectores mal etiquetados (ej: DASI/test.txt con subjectId de otra
        // materia) no deben llegar al LLM aunque el filtro Pinecone los haya
        // devuelto. Solo se descartan los que traen un subjectId explícito
        // distinto; los que no traen subjectId quedan sujetos al runner de
        // cuarentena (vector-audit metadata-incomplete) sin romper el recall.
        const preSubjectCount = matches.length;
        matches = matches.filter((m) => !m.metadata?.subjectId || String(m.metadata.subjectId) === String(subjectId));
        if (matches.length !== preSubjectCount) {
            const dropped = preSubjectCount - matches.length;
            context.log(`[RAG] Subject post-filter: se descartaron ${dropped} matches fuera de subjectId=${subjectId} (correlationId=${correlationId})`);
        }

        // ── 4b. Filtrar materiales no revisados ───────────────────
        let priorityMap = {};
        try {
            const allMaterials = await listMaterialsBySubject(subjectId);
            
            // Construir mapa de prioridades (overrides)
            allMaterials.forEach(m => {
                if (m.priority) {
                    priorityMap[m.materialId || m.id] = m.priority;
                }
            });

            const reviewedMaterialIds = new Set(
                allMaterials.filter(m => m.reviewed === true).map(m => m.materialId || m.id)
            );
            // En sandbox, el modo "Simular alumno" reproduce la vista de estudiante
            // (solo materiales publicados/revisados). El modo docente (default)
            // omite el filtro para poder testear borradores antes de publicar.
            const applyReviewedFilter = !sandboxMode || simulateStudentMode;
            // Si hay al menos un material revisado, filtrar; si no hay ninguno revisado,
            // dejamos pasar todo para no bloquear el chat completamente.
            if (applyReviewedFilter && reviewedMaterialIds.size > 0) {
                const before = matches.length;
                matches = matches.filter(m => reviewedMaterialIds.has(m.metadata?.materialId));
                if (before !== matches.length) {
                    context.log(`[RAG] Filtro de revisión: ${before} → ${matches.length} matches (${reviewedMaterialIds.size} materiales revisados)`);
                }
            } else if (sandboxMode && !simulateStudentMode) {
                context.log(`[RAG] Sandbox teacher preview: omitiendo filtro de revisión (${reviewedMaterialIds.size} revisados, ${matches.length} matches)`);
            }
        } catch (reviewErr) {
            context.error('[RAG] Error obteniendo materiales para filtro/prioridad (no bloqueante):', reviewErr);
        }

        matches = buildHybridContext(matches, MAX_RAG_CHUNKS, priorityMap, materialWeights);
        matches = diversifyBySourceFile(matches);

        const REFUSAL_MESSAGE = "No encontre informacion sobre eso en los materiales seleccionados.";

        // ── 5. Early return if no context found ───────────────────
        if (matches.length === 0) {
            context.log(`[RAG] No matches found for subjectId=${subjectId}. Sending refusal stream.`);
            // Audit unanswered query (no context) for prompt-injection / knowledge-gap detection (#221).
            trackUnansweredQuery({
                question,
                rewrittenQuestion,
                reason: 'no_context',
                subjectId,
                userId,
                classIds,
                correlationId,
                sourcesCount: 0,
            }).catch(e => context.error('[Telemetry] Error emitting UnansweredQuery (no_context):', e));
            if (stream) {
                const responseStream = new ReadableStream({
                    start(controller) {
                        const encoder = new TextEncoder();
                        // 1. Enviar metadatos vacíos para inicializar el footer
                        controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify({ sources: [], model: getChatModelName() })}\n\n`));
                        
                        // 2. Enviar el mensaje como un delta para que la UI lo anime/muestre progresivamente si quiere, 
                        // o al menos use el path más probado del frontend.
                        controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ content: REFUSAL_MESSAGE })}\n\n`));
                        
                        // 3. Enviar evento final
                        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ answer: REFUSAL_MESSAGE })}\n\n`));
                        controller.close();
                    }
                });
                return {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' },
                    body: responseStream
                };
            } else {
                return jsonResponse(200, {
                    answer: REFUSAL_MESSAGE,
                    sources: []
                });
            }
        }

        // ── 6. Construir prompt RAG ───────────────────────────────
        const contextText = matches
            .map((m, i) => {
                const n = i + 1;
                const filename = m.metadata?.sourceFilename || 'desconocido';
                const materialType = m.metadata?.materialType || 'material';
                const chunkIndex = Number.isInteger(m.metadata?.chunkIndex) ? m.metadata.chunkIndex : '';
                const header = `<chunk indice="${n}" archivo="${filename}" tipo="${materialType}" chunkIndex="${chunkIndex}">`;
                const body = `${m.metadata?.text || ''}`;
                return `[${n}] ${header}\n${body}\n</chunk>`;
            })
            .join('\n\n');

        const focusClause = transcriptFocus?.label
            ? `\n\n<transcripcion_foco>\n${transcriptFocus.label}\nUsa este foco para priorizar la respuesta sobre esa seccion de la clase.\n</transcripcion_foco>`
            : '';

        let deadlineBlock = '';
        const deadlinePatterns = ['entrega', 'vencimiento', 'deadline', 'fecha', 'semana', 'cuándo', 'próxima', 'próximo'];
        if (deadlinePatterns.some(p => question.toLowerCase().includes(p))) {
            const now = new Date();
            const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

            // ── Entregas del alumno (tareas por estudiante, Story 11.1.5) ──
            // Carga las tareas del alumno desde tasks-config/{studentId}.json
            // (misma fuente que GET /api/tasks) para responder "¿qué entregas
            // tengo esta semana?" con el detalle de la propia entrega.
            const tasksStudentId = user?.id || sanitizedId;
            let studentTasks = [];
            try {
                const savedTasks = await loadJson(CONFIG.containers.tasks, `${tasksStudentId}.json`);
                if (Array.isArray(savedTasks)) studentTasks = savedTasks;
            } catch (taskErr) {
                context.warn(`[RAG] Error loading student tasks (non-blocking) studentId=${tasksStudentId}:`, taskErr.message);
            }

            const pendingSubjectTasks = studentTasks.filter(t =>
                t.subjectId === subjectId &&
                t.status !== 'completed'
            );
            const upcomingTasks = pendingSubjectTasks.filter(t => {
                const due = new Date(t.dueDate);
                return due >= now && due <= weekFromNow;
            });

            let subjectName = subjectId;
            try {
                const subjects = await loadJson(CONFIG.containers.classes, CONFIG.blobs.subjects);
                if (Array.isArray(subjects)) {
                    const found = subjects.find(s => s?.id === subjectId);
                    if (found?.name) subjectName = found.name;
                }
            } catch (subjectErr) {
                context.warn('[RAG] Error loading subjects for deadlines (non-blocking):', subjectErr.message);
            }

            if (upcomingTasks.length > 0) {
                const lines = upcomingTasks
                    .map(t => {
                        const date = new Date(t.dueDate).toLocaleDateString('es-AR');
                        return `- ${t.title} (${subjectName}) — vence el ${date} — [Ver tarea](#/student/tasks)`;
                    })
                    .join('\n');
                deadlineBlock = `\n\n<entregas_semana>\nEntregas de la semana (${subjectName}):\n${lines}\n</entregas_semana>`;
                context.log(`[RAG] Deadline augmentation: ${upcomingTasks.length} student tasks this week for subjectId=${subjectId}, studentId=${tasksStudentId}`);
            } else if (studentTasks.some(t => t.subjectId === subjectId && t.status !== 'completed')) {
                const nextTask = pendingSubjectTasks
                    .filter(t => new Date(t.dueDate) >= now)
                    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
                if (nextTask) {
                    const date = new Date(nextTask.dueDate).toLocaleDateString('es-AR');
                    deadlineBlock = `\n\n<entregas_semana>\nNo tenés entregas esta semana. Tu próxima entrega es ${nextTask.title} el ${date}.\n</entregas_semana>`;
                    context.log(`[RAG] Deadline augmentation: no weekly tasks, next student task subjectId=${subjectId}, studentId=${tasksStudentId}`);
                }
            } else {
                // Fallback: entregas por materia (deadlines/{subjectId}.json)
                try {
                    const deadlines = await loadJson('deadlines', `${subjectId}.json`);
                    if (Array.isArray(deadlines) && deadlines.length > 0) {
                        const upcoming = deadlines.filter(d => {
                            const due = new Date(d.dueDate);
                            return due >= now && due <= weekFromNow;
                        });
                        if (upcoming.length > 0) {
                            deadlineBlock = `\n\n<entregas_semana>\nEntregas de la semana (${subjectName}):\n${upcoming.map(d => `- ${d.title}: vence el ${new Date(d.dueDate).toLocaleDateString('es-AR')}`).join('\n')}\n</entregas_semana>`;
                        } else {
                            const nextDeadline = deadlines
                                .filter(d => new Date(d.dueDate) >= now)
                                .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
                            if (nextDeadline) {
                                deadlineBlock = `\n\n<entregas_semana>\nNo tenés entregas esta semana. Tu próxima entrega es ${nextDeadline.title} el ${new Date(nextDeadline.dueDate).toLocaleDateString('es-AR')}.\n</entregas_semana>`;
                            }
                        }
                    }
                } catch (deadlineErr) {
                    context.warn('[RAG] Error loading deadlines (non-blocking):', deadlineErr.message);
                }
            }
        }

        // ── 6a. Preferencias del asistente (tono/longitud/fuentes) ──
        const preferencesBlock = buildPreferencesBlock({ botTone, botLength, includeSources });

        // Response length cap for concise preference (story #223 / 11-5-1)
        const maxTokens = botLength === 'concise' ? Math.min(CONFIG.ai.maxTokens.chat, 400) : CONFIG.ai.maxTokens.chat;

        const { id: promptId, content: systemPromptBase } = getShadowPrompt();
        // Log telemetry explicit event inside standard console output for App Insights Analytics mapping
        context.log(`[A/B Test] Interaction initialized using prompt version: ${promptId}`);
        const ragModel = await resolveModelForTask('rag-master');

        // ── 6b. Cargar feedback docente (correcciones revisadas) ──
        let teacherFeedbackBlock = '';
        try {
          const reviewedCorrections = await listReviewedCorrections(subjectId);
          if (reviewedCorrections.length > 0) {
            const feedbackEntries = reviewedCorrections
              .slice(0, 5)
              .map((c, i) => {
                const date = c.reviewedAt ? new Date(c.reviewedAt).toLocaleDateString('es-AR') : '';
                return `<feedback indice="${i + 1}">
  <consulta>${c.question || ''}</consulta>
  <comentario_docente>${c.comments || ''}</comentario_docente>
  ${date ? `<fecha_revision>${date}</fecha_revision>` : ''}
</feedback>`;
              })
              .join('\n');
            teacherFeedbackBlock = `\n\n<feedback_docente>\nA continuacion, feedback y correcciones que el docente ha revisado sobre consultas anteriores. Usa esta informacion para mejorar tus respuestas y evitar errores similares.\n${feedbackEntries}\n</feedback_docente>`;
            context.log(`[RAG] Loaded ${reviewedCorrections.length} teacher-reviewed corrections for subjectId=${subjectId}`);
          }
        } catch (feedbackErr) {
          context.error('[RAG] Error loading teacher feedback (non-blocking):', feedbackErr);
        }

        const messages = [
            {
                role: 'system',
                content: `${systemPromptBase}${focusClause}

<contexto_rag>
${contextText}
</contexto_rag>${teacherFeedbackBlock}${deadlineBlock}${preferencesBlock}`,

            },
            {
                role: 'user',
                content: rewrittenQuestion,
            },
        ];

        // ── 6. Generar respuesta con GPT-4o mini ──────────────────
        if (stream) {
            context.log('🔄 Iniciando stream RAG...');
            const interactionId = uuidv4();
            const sources = matches.map(m => ({
                materialType: m.metadata?.materialType,
                materialPriority: resolveMaterialPriority(m.metadata, priorityMap),
                subjectId: m.metadata?.subjectId,
                classId: m.metadata?.classId ?? m.metadata?.classIds?.[0],
                classIds: m.metadata?.classIds,
                chunkIndex: m.metadata?.chunkIndex,
                sourceFilename: m.metadata?.sourceFilename,
                slideTitle: m.metadata?.slideTitle,
                score: Math.round(m.score * 100) / 100,
                text: m.metadata?.text || '',
                materialId: m.metadata?.materialId || '',
            }));

            const responseStream = new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();

                    // Enviar metadatos iniciales
                    controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify({ interactionId, sources, model: getModelDisplayName(ragModel) })}\n\n`));

                    let fullAnswer = '';
                    let finalUsage = null;
                    let firstTokenAt = null;
                    let ttftMs = null;

                    const networkSetupMs = Date.now() - startTime;

                    if (request.signal?.aborted) {
                        context.log(`[RAG] Client already disconnected before stream start — aborting immediately`);
                        try { controller.close(); } catch (_) {}
                        return;
                    }

                    try {
                        const stream = await chatCompletion(messages, true, { model: ragModel, headers: dependencyHeaders, signal: request.signal, max_tokens: maxTokens });
                        for await (const chunk of stream) {
                            const delta = chunk.choices?.[0]?.delta?.content || '';
                            if (delta) {
                                if (!firstTokenAt) {
                                    firstTokenAt = new Date().toISOString();
                                    ttftMs = Date.now() - startTime;
                                    context.log(`[Telemetry] TTFT captured: ${ttftMs}ms | networkSetupMs: ${networkSetupMs}ms | interactionId=${interactionId}`);
                                }
                                fullAnswer += delta;
                                controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ content: delta })}\n\n`));
                            }
                            if (chunk.usage) {
                                finalUsage = chunk.usage;
                            }
                        }

                        // Calcular duración y métricas al finalizar
                        const durationMs = Date.now() - startTime;
                        const userAuth = getAuthenticatedUser(request);
                        const userId = userAuth.userId;
                        const totalInteractionTokens = (embeddingUsage?.total_tokens || 0) + (finalUsage?.total_tokens || 0);

                        const selectedClassCount = resolveSelectedClassCount(classIds);

                        trackRAGInteraction({
                            userId,
                            subjectId,
                            promptTokens: finalUsage?.prompt_tokens || 0,
                            completionTokens: finalUsage?.completion_tokens || 0,
                            totalTokens: totalInteractionTokens,
                            durationMs,
                            networkSetupMs,
                            ttftMs,
                            promptVersion: promptId,
                            interactionId,
                            firstTokenAt,
                            filterType,
                            selectedClassCount,
                            sourceMix: resolveSourceMix(sources),
                            correlationId,
                            sandbox: sandboxMode,
                            simulateStudent: simulateStudentMode,
                        }).catch(err => context.error('[Telemetry] Error emitting RAGInteraction event from stream:', err));


                        const chatLog = {
                            id: interactionId,
                            userId: userAuth.userId,
                            subjectId,
                            sessionId: sessionId || interactionId,
                            classIds,
                            transcriptFocus,
                            question,
                            rewrittenQuestion,
                            answer: fullAnswer,
                            sources,
                            promptVersion: promptId,
                            sandbox: sandboxMode,
                            simulateStudent: simulateStudentMode,
                            timestamp: new Date().toISOString(),
                        };

                        if (!sandboxMode) {
                            saveJson('chat-logs', `${userAuth.sanitizedId}/${subjectId}/${interactionId}.json`, chatLog)
                                .catch(e => context.error('Error guardando log de chat (stream):', e));

                            saveMetricsToTable('SessionMetrics', {
                                partitionKey: subjectId,
                                rowKey: interactionId,
                                subjectId,
                                userId,
                                promptTokens: finalUsage?.prompt_tokens || 0,
                                completionTokens: finalUsage?.completion_tokens || 0,
                                totalTokens: totalInteractionTokens,
                                promptVersion: promptId,
                                timestamp: new Date()
                            }).catch(e => context.error('Error guardando Table Metrics (stream):', e));
                        }

                        // Enviar evento de finalización
                        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ usage: finalUsage, answer: fullAnswer })}\n\n`));
                        controller.close();
                    } catch (err) {
                        if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') {
                            const latencyBeforeAbortMs = Date.now() - startTime;
                            const charsGenerated = fullAnswer?.length || 0;
                            const estimatedTokens = Math.round(charsGenerated / 4);
                            context.log(`[RAG] Stream aborted by client disconnect — interactionId=${interactionId}, subjectId=${subjectId}, chars=${charsGenerated}, latency=${latencyBeforeAbortMs}ms`);
                            trackRAGError({
                                errorCategory: 'CLIENT_ABORT',
                                code: 'STREAM_ABORTED',
                                message: `Stream aborted after ${latencyBeforeAbortMs}ms, ${estimatedTokens} estimated tokens sent`,
                                subjectId,
                                userId,
                                classIds,
                                correlationId,
                            }).catch(e => context.error('[Telemetry] Error emitting RAGErrorCategorized (CLIENT_ABORT):', e));
                            try { controller.close(); } catch (_) {}
                            return;
                        }
                        const categorizedError = normalizeCategorizedError(err, ErrorCategory.LLM);
                        context.error('Error durante el stream:', categorizedError);
                        trackRAGError({
                            errorCategory: categorizedError.errorCategory,
                            code: categorizedError.code,
                            message: categorizedError.message,
                            subjectId,
                            userId,
                            classIds,
                            correlationId,
                            stackTrace: err?.stack,
                        }).catch(e => context.error('[Telemetry] Error emitting RAGErrorCategorized (stream):', e));
                        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: categorizedError.message, errorCategory: categorizedError.errorCategory, code: categorizedError.code })}\n\n`));
                        controller.close();
                    }
                }
            });

            return {
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
                body: responseStream
            };
        }

        // ── Standard Blocking Mode (Legacy) ───────────────────────
        const networkSetupMs = Date.now() - startTime;
        let answer;
        let chatUsage;
        try {
            const chatResult = await chatCompletion(messages, false, { model: ragModel, headers: dependencyHeaders, max_tokens: maxTokens });
            answer = chatResult.content;
            chatUsage = chatResult.usage;
        } catch (err) {
            const categorizedError = normalizeCategorizedError(err, ErrorCategory.LLM);
            context.error('Error en chat completion:', categorizedError);
            trackRAGError({
                errorCategory: categorizedError.errorCategory,
                code: categorizedError.code,
                message: categorizedError.message,
                subjectId,
                userId,
                classIds,
                correlationId,
                stackTrace: err?.stack,
            }).catch(e => context.error('[Telemetry] Error emitting RAGErrorCategorized (blocking):', e));

            // Audit queries blocked by content-safety filters (#221).
            if (categorizedError.errorCategory === 'SAFETY') {
                trackUnansweredQuery({
                    question,
                    rewrittenQuestion,
                    reason: 'safety_blocked',
                    subjectId,
                    userId,
                    classIds,
                    correlationId,
                    sourcesCount: matches.length,
                }).catch(e => context.error('[Telemetry] Error emitting UnansweredQuery (safety_blocked):', e));
            }

            return jsonResponse(categorizedError.status, {
                error: `Error generando respuesta (chat): ${categorizedError.message}`,
                errorCategory: categorizedError.errorCategory,
                code: categorizedError.code,
            });
        }

        // ── 6b. Emit App Insights telemetry (Issue #69) ───────────
        const durationMs = Date.now() - startTime;
        // userId and sanitizedId are already defined at the top of the handler

        // Accumulate total tokens for this interaction (embedding + chat)
        const totalInteractionTokens = (embeddingUsage?.total_tokens || 0) + (chatUsage?.total_tokens || 0);

        // Audit unanswered queries (empty / refusal-like model output) (#221).
        const trimmedAnswer = String(answer || '').trim();
        const isRefusalLike = !trimmedAnswer
            || trimmedAnswer.toLowerCase().includes('no encontre informacion')
            || trimmedAnswer.toLowerCase().includes('no tengo informacion')
            || trimmedAnswer.toLowerCase().includes('no encuentro informacion');
        if (isRefusalLike) {
            trackUnansweredQuery({
                question,
                rewrittenQuestion,
                reason: trimmedAnswer ? 'refusal_answer' : 'empty_answer',
                subjectId,
                userId,
                classIds,
                correlationId,
                sourcesCount: matches.length,
            }).catch(err => context.error('[Telemetry] Error emitting UnansweredQuery (unanswered):', err));
        }

        const sourceMix = resolveSourceMix(matches.map(m => ({ materialType: m.metadata?.materialType })));

        trackRAGInteraction({
            userId,
            subjectId,
            promptTokens: chatUsage?.prompt_tokens || 0,
            completionTokens: chatUsage?.completion_tokens || 0,
            totalTokens: totalInteractionTokens,
            durationMs,
            networkSetupMs,
            promptVersion: promptId,
            interactionId: uuidv4(),
            filterType,
            selectedClassCount: resolveSelectedClassCount(classIds),
            sourceMix,
            correlationId,
            sandbox: sandboxMode,
            simulateStudent: simulateStudentMode,
        }).catch(err => context.error('[Telemetry] Error emitting RAGInteraction event:', err));

        // ── 7. Construir respuesta con fuentes ────────────────────
        const sources = matches.map(m => ({
            materialType: m.metadata?.materialType,
            materialPriority: resolveMaterialPriority(m.metadata, priorityMap),
            subjectId: m.metadata?.subjectId,
            classId: m.metadata?.classId ?? m.metadata?.classIds?.[0],
            classIds: m.metadata?.classIds,
            chunkIndex: m.metadata?.chunkIndex,
            sourceFilename: m.metadata?.sourceFilename,
            slideTitle: m.metadata?.slideTitle,
            score: Math.round(m.score * 100) / 100,
            text: m.metadata?.text || '',
            materialId: m.metadata?.materialId || '',
        }));

        // ── 8. Guardar log de interacción (HU#62) ─────────────────
        const interactionId = uuidv4();
        const chatLog = {
            id: interactionId,
            userId,
            subjectId,
            sessionId: sessionId || interactionId,
            classIds,
            transcriptFocus,
            question,
            rewrittenQuestion,
            answer,
            sources,
            promptVersion: promptId,
            sandbox: sandboxMode,
            simulateStudent: simulateStudentMode,
            timestamp: new Date().toISOString(),
            feedback: null
        };

        if (!sandboxMode) {
            try {
                // Guardamos en un container específico para logs
                await saveJson('chat-logs', `${sanitizedId}/${subjectId}/${interactionId}.json`, chatLog);

                // Asíncronamente persistimos las métricas RAG en la Table Storage (HU #83)
                saveMetricsToTable('SessionMetrics', {
                    partitionKey: subjectId,
                    rowKey: interactionId,
                    subjectId,
                    userId,
                    promptTokens: chatUsage?.prompt_tokens || 0,
                    completionTokens: chatUsage?.completion_tokens || 0,
                    totalTokens: totalInteractionTokens,
                    promptVersion: promptId,
                    timestamp: new Date()
                }).catch(e => context.error('Error insertando Table Metrics de sesión silenciosa:', e));
            } catch (logErr) {
                context.error('Error guardando log de chat:', logErr);
            }
        }

        return jsonResponse(200, { id: interactionId, answer, sources });
    }), 'chat')),
});
