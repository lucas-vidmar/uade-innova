/**
 * rag-query.js — POST /api/rag-query
 * Motor RAG: embedding de la pregunta → similitud Pinecone → chat con contexto
 */
import { app } from '@azure/functions';
import { generateEmbedding, chatCompletion } from '../services/openai.js';
import { querySimilar } from '../services/pinecone.js';
import { saveJson, saveMetricsToTable } from '../services/storage.js';
import { getShadowPrompt } from '../services/prompts.js';
import { trackRAGInteraction } from '../services/telemetry.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { v4 as uuidv4 } from 'uuid';
const MAX_RAG_CHUNKS = 4;

app.http('rag-query', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'rag-query',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        context.log('rag-query triggered');

        // Capture start time for end-to-end latency measurement (Issue #69)
        const startTime = Date.now();

        // ── 1. Parsear request ────────────────────────────────────
        let body;
        try {
            body = await request.json();
        } catch {
            return { status: 400, body: JSON.stringify({ error: 'Body JSON inválido' }) };
        }

        const { question, classIds, subjectId } = body;

        if (!question || !subjectId) {
            return {
                status: 400,
                body: JSON.stringify({ error: 'Faltan campos requeridos: question, subjectId' }),
            };
        }

        context.log(`Pregunta: "${question}" | Materia: ${subjectId} | Clases: ${classIds?.join(',')}`);

        // ── 2. Embedding de la pregunta ───────────────────────────
        let questionEmbedding;
        let embeddingUsage;
        try {
            const embeddingResult = await generateEmbedding(question);
            questionEmbedding = embeddingResult.embedding;
            embeddingUsage = embeddingResult.usage;
        } catch (err) {
            context.error('Error generando embedding:', err);
            return { status: 500, body: JSON.stringify({ error: `Error procesando la pregunta (embedding): ${err.message}` }) };
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
            matches = await querySimilar(questionEmbedding, filter, MAX_RAG_CHUNKS);
        } catch (err) {
            context.error('Error consultando Pinecone:', err);
            return { status: 500, body: JSON.stringify({ error: `Error buscando en la base de conocimiento: ${err.message}` }) };
        }

        if (matches.length === 0) {
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    answer: 'No encontré información sobre eso en los materiales seleccionados.',
                    sources: [],
                }),
            };
        }

        // ── 5. Construir prompt RAG ───────────────────────────────
        const contextText = matches
            .map((m, i) => `[Fuente ${i + 1} - Archivo: ${m.metadata?.sourceFilename || 'Desconocido'}]\n${m.metadata?.text || ''}`)
            .join('\n\n---\n\n');

        const { id: promptId, content: systemPromptBase } = getShadowPrompt();
        // Log telemetry explicit event inside standard console output for App Insights Analytics mapping
        context.log(`[A/B Test] Interaction initialized using prompt version: ${promptId}`);

        const messages = [
            {
                role: 'system',
                content: `${systemPromptBase}

### CONTEXTO DE LOS MATERIALES:
${contextText}
### FIN DEL CONTEXTO`,

            },
            {
                role: 'user',
                content: question,
            },
        ];

        // ── 6. Generar respuesta con GPT-4o mini ──────────────────
        let answer;
        let chatUsage;
        try {
            const chatResult = await chatCompletion(messages);
            answer = chatResult.content;
            chatUsage = chatResult.usage;
        } catch (err) {
            context.error('Error en chat completion:', err);
            return { status: 500, body: JSON.stringify({ error: `Error generando respuesta (chat): ${err.message}` }) };
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
            question,
            answer,
            sources,
            promptVersion: promptId,
            timestamp: new Date().toISOString(),
            feedback: null
        };
        
        try {
            // Guardamos en un container específico para logs
            // Usamos una ruta que facilite la búsqueda por usuario y materia
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
            // No bloqueamos la respuesta al usuario si falla el logging
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: interactionId, answer, sources }),
        };
    },
});
