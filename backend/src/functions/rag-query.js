/**
 * rag-query.js — POST /api/rag-query
 * Motor RAG: embedding de la pregunta → similitud Pinecone → chat con contexto
 */
import { app } from '@azure/functions';
import { generateEmbedding, chatCompletion } from '../services/openai.js';
import { querySimilar } from '../services/vector-store.js';
import { saveJson, saveMetricsToTable } from '../services/storage.js';
import { getShadowPrompt } from '../services/prompts.js';
import { trackRAGInteraction } from '../services/telemetry.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { normalizeCategorizedError, ErrorCategory } from '../services/error-categories.js';
import { resolveCorrelationId, buildDependencyHeaders, withCorrelationResponseHeaders } from '../services/correlation.js';
import { v4 as uuidv4 } from 'uuid';
const MAX_RAG_CHUNKS = 4;
const RETRIEVAL_CANDIDATES = 10;
const MIN_HISTORY_TURNS = 3;
const MAX_HISTORY_TURNS = 5;
const DEFAULT_HISTORY_TURNS = 4;

const MATERIAL_TYPE_WEIGHT = {
    notes: 1.35,
    bibliography: 1.1,
    transcript: 1,
    presentation: 0.95,
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

function getMaterialWeight(materialType) {
    return MATERIAL_TYPE_WEIGHT[materialType] || 1;
}

function rankMatches(matches = []) {
    return [...matches]
        .map(match => {
            const materialType = match?.metadata?.materialType;
            const baseScore = Number(match?.score || 0);
            const weightedScore = baseScore * getMaterialWeight(materialType);
            return {
                ...match,
                weightedScore,
            };
        })
        .sort((a, b) => b.weightedScore - a.weightedScore);
}

function buildHybridContext(matches = [], maxChunks = MAX_RAG_CHUNKS) {
    const ranked = rankMatches(matches);
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

app.http('rag-query', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'rag-query',
    handler: async (request, context) => {
        const correlationId = resolveCorrelationId(request);
        const openAiHeaders = buildDependencyHeaders(correlationId);
        context.openAiHeaders = openAiHeaders;

        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' }, correlationId);
        context.log('rag-query triggered');
        context.log(`[Trace] Correlation-ID: ${correlationId}`);

        // Capture start time for end-to-end latency measurement (Issue #69)
        const startTime = Date.now();

        // ── 1. Parsear request ────────────────────────────────────
        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse(400, { error: 'Body JSON inválido' }, correlationId);
        }

        const { question, classIds, subjectId, stream = false, conversationHistory, historyWindowSize, transcriptFocus } = body;

        if (!question || !subjectId) {
            return jsonResponse(400, { error: 'Faltan campos requeridos: question, subjectId' }, correlationId);
        }

        const recentConversationHistory = normalizeConversationHistory(conversationHistory, historyWindowSize);
        const rewrittenQuestion = await rewriteQuestionWithHistory(question, recentConversationHistory, context);

        context.log(`Pregunta: "${question}" | Reescrita: "${rewrittenQuestion}" | Materia: ${subjectId} | Clases: ${classIds?.join(',')}`);

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
            return jsonResponse(categorizedError.status, {
                error: `Error procesando la pregunta (embedding): ${categorizedError.message}`,
                errorCategory: categorizedError.errorCategory,
            }, correlationId);
        }

        // ── 3. Filtro Pinecone por subjectId y classIds ───────────
        const filter = {
            subjectId: { $eq: subjectId },
            $or: [
                { classIds: { $in: classIds } },
                { materialType: { $eq: 'bibliography' } }
            ]
        };
        // Si classIds incluye 'all' o está vacío, simplificamos a solo subjectId
        if (!classIds || classIds.length === 0 || classIds.includes('all')) {
            delete filter.$or;
        }

        // ── 4. Búsqueda de similitud en Pinecone ──────────────────
        let matches;
        try {
            matches = await querySimilar(questionEmbedding, filter, RETRIEVAL_CANDIDATES);
        } catch (err) {
            const categorizedError = normalizeCategorizedError(err, ErrorCategory.RETRIEVAL_FAILURE);
            context.error('Error consultando Pinecone:', categorizedError);
            return jsonResponse(categorizedError.status, {
                error: `Error buscando en la base de conocimiento: ${categorizedError.message}`,
                errorCategory: categorizedError.errorCategory,
            }, correlationId);
        }

        matches = filterMatchesByTranscriptFocus(matches, transcriptFocus);
        matches = buildHybridContext(matches, MAX_RAG_CHUNKS);

        if (matches.length === 0) {
            return jsonResponse(200, {
                answer: 'No encontré información sobre eso en los materiales seleccionados.',
                sources: [],
            }, correlationId);
        }

        // ── 5. Construir prompt RAG ───────────────────────────────
        const contextText = matches
            .map((m, i) => `[Fuente ${i + 1} - Archivo: ${m.metadata?.sourceFilename || 'Desconocido'}]\n${m.metadata?.text || ''}`)
            .join('\n\n---\n\n');

        const focusClause = transcriptFocus?.label
            ? `\n\n### FOCO DE TRANSCRIPCION SELECCIONADO POR EL ALUMNO:\n${transcriptFocus.label}\nUsa este foco para priorizar la respuesta sobre esa seccion de la clase.`
            : '';

        const { id: promptId, content: systemPromptBase } = getShadowPrompt();
        // Log telemetry explicit event inside standard console output for App Insights Analytics mapping
        context.log(`[A/B Test] Interaction initialized using prompt version: ${promptId}`);

        const messages = [
            {
                role: 'system',
                content: `${systemPromptBase}${focusClause}

### CONTEXTO DE LOS MATERIALES:
${contextText}
### FIN DEL CONTEXTO`,

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
                classIds: m.metadata?.classIds,
                chunkIndex: m.metadata?.chunkIndex,
                sourceFilename: m.metadata?.sourceFilename,
                score: Math.round(m.score * 100) / 100,
            }));

            const responseStream = new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();

                    // Enviar metadatos iniciales
                    controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify({ interactionId, sources })}\n\n`));

                    let fullAnswer = '';
                    let finalUsage = null;

                    try {
                        const stream = await chatCompletion(messages, true, { headers: openAiHeaders });
                        for await (const chunk of stream) {
                            const delta = chunk.choices?.[0]?.delta?.content || '';
                            if (delta) {
                                fullAnswer += delta;
                                controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ content: delta })}\n\n`));
                            }
                            if (chunk.usage) {
                                finalUsage = chunk.usage;
                            }
                        }

                        // Calcular duración y métricas al finalizar
                        const durationMs = Date.now() - startTime;
                        const principal = parseClientPrincipal(request);
                        const userId = principal?.oid || 'anonymous';
                        const totalInteractionTokens = (embeddingUsage?.total_tokens || 0) + (finalUsage?.total_tokens || 0);

                        trackRAGInteraction({
                            userId,
                            subjectId,
                            promptTokens: finalUsage?.prompt_tokens || 0,
                            completionTokens: finalUsage?.completion_tokens || 0,
                            totalTokens: totalInteractionTokens,
                            durationMs,
                            promptVersion: promptId,
                            interactionId,
                        }).catch(err => context.error('[Telemetry] Error emitting RAGInteraction event from stream:', err));

                        // Persistir logs
                        const chatLog = {
                            id: interactionId,
                            userId: request.user?.id || 'anonymous',
                            subjectId,
                            classIds,
                            transcriptFocus,
                            question,
                            rewrittenQuestion,
                            answer: fullAnswer,
                            sources,
                            promptVersion: promptId,
                            timestamp: new Date().toISOString(),
                        };

                        const userIdSanitized = (request.user?.id || 'anon').replace(/[^a-zA-Z0-9]/g, '_');
                        saveJson('chat-logs', `${userIdSanitized}/${subjectId}/${interactionId}.json`, chatLog)
                            .catch(e => context.error('Error guardando log de chat (stream):', e));

                        saveMetricsToTable('SessionMetrics', {
                            partitionKey: subjectId,
                            rowKey: interactionId,
                            userId: request.user?.id || 'anonymous',
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
            return jsonResponse(categorizedError.status, {
                error: `Error generando respuesta (chat): ${categorizedError.message}`,
                errorCategory: categorizedError.errorCategory,
            }, correlationId);
        }

        // ── 6b. Emit App Insights telemetry (Issue #69) ───────────
        const durationMs = Date.now() - startTime;
        const principal = parseClientPrincipal(request);
        const userId = principal?.oid || 'anonymous';

        // Accumulate total tokens for this interaction (embedding + chat)
        const totalInteractionTokens = (embeddingUsage?.total_tokens || 0) + (chatUsage?.total_tokens || 0);

        trackRAGInteraction({
            userId,
            subjectId,
            promptTokens: chatUsage?.prompt_tokens || 0,
            completionTokens: chatUsage?.completion_tokens || 0,
            totalTokens: totalInteractionTokens,
            durationMs,
            promptVersion: promptId,
            interactionId: uuidv4(),
        }).catch(err => context.error('[Telemetry] Error emitting RAGInteraction event:', err));

        // ── 7. Construir respuesta con fuentes ────────────────────
        const sources = matches.map(m => ({
            materialType: m.metadata?.materialType,
            classIds: m.metadata?.classIds,
            chunkIndex: m.metadata?.chunkIndex,
            sourceFilename: m.metadata?.sourceFilename,
            score: Math.round(m.score * 100) / 100,
        }));

        // ── 8. Guardar log de interacción (HU#62) ─────────────────
        const interactionId = uuidv4();
        const chatLog = {
            id: interactionId,
            userId: request.user?.id || 'anonymous',
            subjectId,
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
            const userIdSanitized = (request.user?.id || 'anon').replace(/[^a-zA-Z0-9]/g, '_');
            await saveJson('chat-logs', `${userIdSanitized}/${subjectId}/${interactionId}.json`, chatLog);

            // Asíncronamente persistimos las métricas RAG en la Table Storage (HU #83)
            saveMetricsToTable('SessionMetrics', {
                partitionKey: subjectId,
                rowKey: interactionId,
                userId: request.user?.id || 'anonymous',
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
