/**
 * rag-query.js — POST /api/rag-query
 * Motor RAG: embedding de la pregunta → similitud Pinecone → chat con contexto
 */
import { app } from '@azure/functions';
import { generateEmbedding, chatCompletion } from '../services/ai.js';
import { querySimilar } from '../services/vector-store.js';
import { saveJson, saveMetricsToTable } from '../services/storage.js';
import { getShadowPrompt } from '../services/prompts.js';
import { trackRAGInteraction, trackRAGError } from '../services/telemetry.js';
import { parseClientPrincipal, validateFrontDoorId, getAuthenticatedUser } from '../services/auth-utils.js';
import { normalizeCategorizedError, ErrorCategory } from '../services/error-categories.js';
import { resolveCorrelationId, resolveTraceContext, buildDependencyHeaders, withCorrelationResponseHeaders } from '../services/correlation.js';
import { v4 as uuidv4 } from 'uuid';
import { listMaterialsBySubject } from '../services/state-store.js';
import { getEnrollment, getConsentStatus } from '../services/state-store.js';
import { getMaterialPriority } from '../services/material-classification.js';
import { getSubjectWeights, DEFAULT_WEIGHTS } from '../services/subject-weights.js';
const MAX_RAG_CHUNKS = 4;
const RETRIEVAL_CANDIDATES = 10;
const MAX_CHUNKS_PER_SOURCE = 2;
const MIN_HISTORY_TURNS = 3;
const MAX_HISTORY_TURNS = 5;
const DEFAULT_HISTORY_TURNS = 4;

const MATERIAL_TYPE_WEIGHT = { ...DEFAULT_WEIGHTS };

const MATERIAL_PRIORITY_WEIGHT = {
    primary: 1,
    secondary: 0.9,
};

function tokenize(text = '') {
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter(token => token.length > 3);
}

function filterMatchesByTranscriptFocus(matches, transcriptFocus) {
    if (!transcriptFocus || !transcriptFocus.label) return matches;

    const keywords = tokenize(transcriptFocus.label).slice(0, 6);
    if (!keywords.length) return matches;

    const narrowed = matches.filter(match => {
        const text = String(match.metadata?.text || '').toLowerCase();
        return keywords.some(keyword => text.includes(keyword));
    });

    return narrowed.length > 0 ? narrowed : matches;
}

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

function getMaterialWeight(materialType, customWeights) {
    const weights = customWeights || MATERIAL_TYPE_WEIGHT;
    return weights[materialType] || 1;
}

function getPriorityWeight(materialPriority) {
    return MATERIAL_PRIORITY_WEIGHT[materialPriority] || 1;
}

function resolveMaterialPriority(metadata = {}, priorityMap = {}) {
    const materialId = metadata.materialId;
    const override = (materialId && priorityMap[materialId]) || metadata.materialPriority;
    return getMaterialPriority(metadata.materialType, override);
}

function rankMatches(matches = [], priorityMap = {}, materialWeights) {
    return [...matches]
        .map(match => {
            const materialType = match?.metadata?.materialType;
            const materialPriority = resolveMaterialPriority(match?.metadata, priorityMap);
            const baseScore = Number(match?.score || 0);
            const weightedScore = baseScore * getMaterialWeight(materialType, materialWeights) * getPriorityWeight(materialPriority);
            return {
                ...match,
                weightedScore,
            };
        })
        .sort((a, b) => b.weightedScore - a.weightedScore);
}

function buildHybridContext(matches = [], maxChunks = MAX_RAG_CHUNKS, priorityMap = {}, materialWeights) {
    const ranked = rankMatches(matches, priorityMap, materialWeights);
    if (ranked.length <= maxChunks) return ranked;

    const selected = [];
    const selectedIds = new Set();
    const getMatchKey = (match, index) => match?.id || `${match?.metadata?.sourceFilename || 'unknown'}:${match?.metadata?.chunkIndex ?? index}`;

    const pickFirstByType = (type) => {
        const candidateIndex = ranked.findIndex((match, index) => {
            const key = getMatchKey(match, index);
            return match?.metadata?.materialType === type && !selectedIds.has(key);
        });
        const candidate = candidateIndex >= 0 ? ranked[candidateIndex] : null;
        if (!candidate) return;
        const candidateKey = getMatchKey(candidate, candidateIndex);
        selected.push(candidate);
        selectedIds.add(candidateKey);
    };

    // Garantiza mezcla de fuentes priorizando apuntes del docente.
    pickFirstByType('notes');
    pickFirstByType('bibliography');

    for (const [index, match] of ranked.entries()) {
        if (selected.length >= maxChunks) break;
        const key = getMatchKey(match, index);
        if (selectedIds.has(key)) continue;
        selected.push(match);
        selectedIds.add(key);
    }

    return selected.slice(0, maxChunks);
}

function diversifyBySourceFile(matches, maxPerFile = MAX_CHUNKS_PER_SOURCE, maxChunks = MAX_RAG_CHUNKS) {
    if (!Array.isArray(matches) || matches.length === 0) return [];

    const getSourceFile = (match) => match?.metadata?.sourceFilename ?? 'unknown';

    const fileBuckets = Object.create(null);
    const fileOrder = [];
    for (const match of matches) {
        const file = getSourceFile(match);
        if (!fileBuckets[file]) {
            fileBuckets[file] = [];
            fileOrder.push(file);
        }
        fileBuckets[file].push(match);
    }

    if (fileOrder.length <= 1) {
        return matches.slice(0, maxChunks);
    }

    const kept = [];
    const oversubscribed = Object.create(null);
    const oversubscribedOrder = [];

    for (const file of fileOrder) {
        const bucket = fileBuckets[file];
        if (bucket.length > maxPerFile) {
            kept.push(...bucket.slice(0, maxPerFile));
            oversubscribed[file] = bucket.slice(maxPerFile);
            oversubscribedOrder.push(file);
        } else {
            kept.push(...bucket);
        }
    }

    if (kept.length >= maxChunks) {
        return kept.slice(0, maxChunks);
    }

    const remaining = maxChunks - kept.length;
    let added = 0;
    while (added < remaining) {
        let madeProgress = false;
        for (const file of oversubscribedOrder) {
            if (added >= remaining) break;
            const extras = oversubscribed[file];
            if (extras.length > 0) {
                kept.push(extras.shift());
                added++;
                madeProgress = true;
            }
        }
        if (!madeProgress) break;
    }

    return kept;
}

async function rewriteQuestionWithHistory(question, conversationHistory, context) {
    if (!conversationHistory.length) return question;

    const rewriteSystemPrompt = `Reescribe la ultima pregunta del estudiante para que sea autonoma y clara.
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
        const rewritten = await chatCompletion(rewriteMessages, false, {
            temperature: 0,
            max_tokens: 120,
            headers: context?.openAiHeaders,
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

function jsonResponse(status, payload, correlationId) {
    return {
        status,
        headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
    };
}

function buildPineconeFilter(subjectId, classIds, disableBibliographyFallback = false) {
    if (!classIds || classIds.length === 0 || classIds.includes('all')) {
        return { subjectId: { $eq: subjectId } };
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
    };
}

function resolveFilterType(classIds) {
    if (!classIds || classIds.length === 0 || classIds.includes('all')) {
        return 'subject-only';
    }
    return classIds.length === 1 ? 'exact-classId' : 'multi-classIds';
}

function resolveSelectedClassCount(classIds) {
    if (!classIds || classIds.length === 0 || classIds.includes('all')) return 0;
    return new Set(classIds.filter(id => id && id !== 'all')).size;
}

function resolveSourceMix(sources) {
    if (!sources || sources.length === 0) return 'none';

    const types = new Set(sources.map(s => s?.materialType).filter(Boolean));
    if (types.size === 0) return 'unknown';

    const hasNotes = types.has('notes');
    const hasBibliography = types.has('bibliography');
    const hasTranscript = types.has('transcript');
    const hasPresentation = types.has('presentation');
    const hasOther = [...types].some(t => !['notes', 'bibliography', 'transcript', 'presentation'].includes(t));

    if (hasNotes && hasBibliography && types.size === 2) return 'notes+bibliography';
    if (hasNotes && types.size === 1) return 'notes-only';
    if (hasBibliography && types.size === 1) return 'bibliography-only';
    if (hasTranscript && types.size === 1) return 'transcript-only';
    if (hasPresentation && types.size === 1) return 'presentation-only';
    if (hasOther) return 'mixed-other';

    return 'mixed-other';
}

function handleErrorResponse(status, message, category, isStream, correlationId) {
    if (isStream) {
        const encoder = new TextEncoder();
        const responseStream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message, errorCategory: category })}\n\n`));
                controller.close();
            }
        });
        return {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                ...withCorrelationResponseHeaders(correlationId),
            },
            body: responseStream
        };
    }
    return jsonResponse(status, { error: message, errorCategory: category }, correlationId);
}

app.http('rag-query', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'rag-query',
    handler: async (request, context) => {
        const correlationId = resolveCorrelationId(request);
        const traceContext = resolveTraceContext(request);
        const openAiHeaders = buildDependencyHeaders(correlationId, traceContext);
        context.openAiHeaders = openAiHeaders;

        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' }, correlationId);
        context.log('rag-query triggered');
        const { userId, sanitizedId } = getAuthenticatedUser(request);
        context.log(`[Trace] Correlation-ID: ${correlationId} | User: ${userId}`);

        // Capture start time for end-to-end latency measurement (Issue #69)
        const startTime = Date.now();

        // ── 1. Parsear request ────────────────────────────────────
        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse(400, { error: 'Body JSON inválido' }, correlationId);
        }

        const { question, classIds, subjectId, sessionId, stream = false, conversationHistory, historyWindowSize, transcriptFocus } = body;

        if (!question || !subjectId) {
            return jsonResponse(400, { error: 'Faltan campos requeridos: question, subjectId' }, correlationId);
        }

        const recentConversationHistory = normalizeConversationHistory(conversationHistory, historyWindowSize);

        // ── 1b. Enrollment access check ──────────────────────────────────
        const enrollment = await getEnrollment(subjectId, userId).catch(() => null);
        const principal = parseClientPrincipal(request);
        const userRoles = principal?.userRoles || [];
        const isTeacherOrDirector = userRoles.includes('Docente') || userRoles.includes('Director');


        if (!isTeacherOrDirector) {
            if (!enrollment || enrollment.status !== 'active') {
                context.log(`[Enrollment] Access denied: userId=${userId}, subjectId=${subjectId}`);
                return jsonResponse(403, {
                    error: 'ENROLLMENT_REQUIRED',
                    message: 'No estás matriculado en esta materia. Contactá a administración.',
                }, correlationId);
            }
        }

        // ── 1c. AI content consent check ────────────────────────────────
        if (!isTeacherOrDirector) {
            const consentAccepted = await getConsentStatus(userId).catch(() => false);
            if (!consentAccepted) {
                context.log(`[Consent] Consent required: userId=${userId}`);
                return jsonResponse(403, {
                    success: false,
                    error: { code: 'CONSENT_REQUIRED', message: 'Debés aceptar los términos de uso antes de usar el chat.' },
                    meta: { timestamp: new Date().toISOString(), requestId: correlationId },
                }, correlationId);
            }
        }

        const rewrittenQuestion = await rewriteQuestionWithHistory(question, recentConversationHistory, context);

        context.log(`Pregunta: "${question}" | Reescrita: "${rewrittenQuestion}" | Materia: ${subjectId} | Clases: ${classIds?.join(',') || 'todas'} | Session: ${sessionId || 'auto'}`);

        // ── 2. Embedding de la pregunta ───────────────────────────
        let questionEmbedding;
        let embeddingUsage;
        try {
            const embeddingResult = await generateEmbedding(rewrittenQuestion, { headers: openAiHeaders });
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
            return handleErrorResponse(categorizedError.status, `Error procesando la pregunta (embedding): ${categorizedError.message}`, categorizedError.errorCategory, stream, correlationId);
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
        };

        let verifiedMatch = null;
        let verifiedAnswerText = '';

        try {
            const verifiedMatches = await querySimilar(questionEmbedding, verifiedFilter, 5);
            const topVerified = verifiedMatches[0];
            if (topVerified && topVerified.score > VERIFIED_SCORE_THRESHOLD) {
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
                classId: verifiedMatch.metadata?.classId,
                chunkIndex: 0,
                sourceFilename: verifiedMatch.metadata?.sourceFilename || '',
                score: Math.round(verifiedMatch.score * 100) / 100,
            }];
            const interactionId = uuidv4();

            if (stream) {
                const responseStream = new ReadableStream({
                    start(controller) {
                        const encoder = new TextEncoder();
                        controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify({ interactionId, sources: verifiedSources, verified: true, verifiedBy: verifiedMatch.metadata?.teacherId })}\n\n`));
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
                        ...withCorrelationResponseHeaders(correlationId),
                    },
                    body: responseStream,
                };
            }

            return jsonResponse(200, { id: interactionId, answer: verifiedAnswerText, sources: verifiedSources, verified: true, verifiedBy: verifiedMatch.metadata?.teacherId }, correlationId);
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
            matches = await querySimilar(questionEmbedding, filter, RETRIEVAL_CANDIDATES);
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
            return handleErrorResponse(categorizedError.status, `Error buscando en la base de conocimiento: ${categorizedError.message}`, categorizedError.errorCategory, stream, correlationId);
        }

        matches = filterMatchesByTranscriptFocus(matches, transcriptFocus);

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
            // Si hay al menos un material revisado, filtrar; si no hay ninguno revisado,
            // dejamos pasar todo para no bloquear el chat completamente.
            if (reviewedMaterialIds.size > 0) {
                const before = matches.length;
                matches = matches.filter(m => reviewedMaterialIds.has(m.metadata?.materialId));
                if (before !== matches.length) {
                    context.log(`[RAG] Filtro de revisión: ${before} → ${matches.length} matches (${reviewedMaterialIds.size} materiales revisados)`);
                }
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
            if (stream) {
                const responseStream = new ReadableStream({
                    start(controller) {
                        const encoder = new TextEncoder();
                        // 1. Enviar metadatos vacíos para inicializar el footer
                        controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify({ sources: [] })}\n\n`));
                        
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
                    headers: { 'Content-Type': 'text/event-stream', ...withCorrelationResponseHeaders(correlationId) },
                    body: responseStream
                };
            } else {
                return jsonResponse(200, {
                    answer: REFUSAL_MESSAGE,
                    sources: []
                }, correlationId);
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

        const { id: promptId, content: systemPromptBase } = getShadowPrompt();
        // Log telemetry explicit event inside standard console output for App Insights Analytics mapping
        context.log(`[A/B Test] Interaction initialized using prompt version: ${promptId}`);

        const messages = [
            {
                role: 'system',
                content: `${systemPromptBase}${focusClause}

<contexto_rag>
${contextText}
</contexto_rag>`,

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
                    controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify({ interactionId, sources })}\n\n`));

                    let fullAnswer = '';
                    let finalUsage = null;
                    let firstTokenAt = null;
                    let ttftMs = null;

                    try {
                        const stream = await chatCompletion(messages, true, { headers: openAiHeaders });
                        for await (const chunk of stream) {
                            const delta = chunk.choices?.[0]?.delta?.content || '';
                            if (delta) {
                                if (!firstTokenAt) {
                                    firstTokenAt = new Date().toISOString();
                                    ttftMs = Date.now() - startTime;
                                    context.log(`[Telemetry] TTFT captured: ${ttftMs}ms | interactionId=${interactionId}`);
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
                            ttftMs,
                            promptVersion: promptId,
                            interactionId,
                            firstTokenAt,
                            filterType,
                            selectedClassCount,
                            sourceMix: resolveSourceMix(sources),
                            correlationId,
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
                            timestamp: new Date().toISOString(),
                        };

                        saveJson('chat-logs', `${userAuth.sanitizedId}/${subjectId}/${interactionId}.json`, chatLog)
                            .catch(e => context.error('Error guardando log de chat (stream):', e));

                        saveMetricsToTable('SessionMetrics', {
                            partitionKey: subjectId,
                            rowKey: interactionId,
                            userId,
                            promptTokens: finalUsage?.prompt_tokens || 0,
                            completionTokens: finalUsage?.completion_tokens || 0,
                            totalTokens: totalInteractionTokens,
                            promptVersion: promptId,
                            timestamp: new Date().toISOString()
                        }).catch(e => context.error('Error guardando Table Metrics (stream):', e));

                        // Enviar evento de finalización
                        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ usage: finalUsage, answer: fullAnswer })}\n\n`));
                        controller.close();
                    } catch (err) {
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
                        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: categorizedError.message, errorCategory: categorizedError.errorCategory })}\n\n`));
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
                    ...withCorrelationResponseHeaders(correlationId),
                },
                body: responseStream
            };
        }

        // ── Standard Blocking Mode (Legacy) ───────────────────────
        let answer;
        let chatUsage;
        try {
            const chatResult = await chatCompletion(messages, false, { headers: openAiHeaders });
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
            return jsonResponse(categorizedError.status, {
                error: `Error generando respuesta (chat): ${categorizedError.message}`,
                errorCategory: categorizedError.errorCategory,
            }, correlationId);
        }

        // ── 6b. Emit App Insights telemetry (Issue #69) ───────────
        const durationMs = Date.now() - startTime;
        // userId and sanitizedId are already defined at the top of the handler

        // Accumulate total tokens for this interaction (embedding + chat)
        const totalInteractionTokens = (embeddingUsage?.total_tokens || 0) + (chatUsage?.total_tokens || 0);

        const sourceMix = resolveSourceMix(matches.map(m => ({ materialType: m.metadata?.materialType })));

        trackRAGInteraction({
            userId,
            subjectId,
            promptTokens: chatUsage?.prompt_tokens || 0,
            completionTokens: chatUsage?.completion_tokens || 0,
            totalTokens: totalInteractionTokens,
            durationMs,
            promptVersion: promptId,
            interactionId: uuidv4(),
            filterType,
            selectedClassCount: resolveSelectedClassCount(classIds),
            sourceMix,
            correlationId,
        }).catch(err => context.error('[Telemetry] Error emitting RAGInteraction event:', err));

        // ── 7. Construir respuesta con fuentes ────────────────────
        const sources = matches.map(m => ({
            materialType: m.metadata?.materialType,
            materialPriority: resolveMaterialPriority(m.metadata, priorityMap),
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
            timestamp: new Date().toISOString(),
            feedback: null
        };

        try {
            // Guardamos en un container específico para logs
            await saveJson('chat-logs', `${sanitizedId}/${subjectId}/${interactionId}.json`, chatLog);

            // Asíncronamente persistimos las métricas RAG en la Table Storage (HU #83)
            saveMetricsToTable('SessionMetrics', {
                partitionKey: subjectId,
                rowKey: interactionId,
                userId,
                promptTokens: chatUsage?.prompt_tokens || 0,
                completionTokens: chatUsage?.completion_tokens || 0,
                totalTokens: totalInteractionTokens,
                promptVersion: promptId,
                timestamp: new Date().toISOString()
            }).catch(e => context.error('Error insertando Table Metrics de sesión silenciosa:', e));
        } catch (logErr) {
            context.error('Error guardando log de chat:', logErr);
        }

        return jsonResponse(200, { id: interactionId, answer, sources }, correlationId);
    },
});
