/**
 * rag-query.js — POST /api/rag-query
 * Motor RAG: embedding de la pregunta → similitud Pinecone → chat con contexto
 */
import { app } from '@azure/functions';
import { generateEmbedding, chatCompletion } from '../services/openai.js';
import { querySimilar } from '../services/pinecone.js';
import { saveJson } from '../services/storage.js';
import { v4 as uuidv4 } from 'uuid';

app.http('rag-query', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'rag-query',
    handler: async (request, context) => {
        context.log('rag-query triggered');

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
        try {
            questionEmbedding = await generateEmbedding(question);
        } catch (err) {
            context.error('Error generando embedding:', err);
            return { status: 500, body: JSON.stringify({ error: `Error procesando la pregunta (embedding): ${err.message}` }) };
        }

        // ── 3. Filtro Pinecone por subjectId y classIds ───────────
        const filter = { subjectId: { $eq: subjectId } };
        // Si hay classIds y NO incluye "Todas las clases", filtramos
        if (classIds && classIds.length > 0 && !classIds.includes('all')) {
            filter.classIds = { $in: classIds };
        }

        // ── 4. Búsqueda de similitud en Pinecone ──────────────────
        let matches;
        try {
            matches = await querySimilar(questionEmbedding, filter, 5);
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

        const messages = [
            {
                role: 'system',
                content: `Eres el Asistente Académico Experto del Dashboard UADE Innova.
Tu objetivo es asistir a los estudiantes manteniendo un tono académico formal, preciso y profesional, siguiendo el estilo institucional de la UADE.

REGLAS DE COMPORTAMIENTO:
1. Responde ÚNICAMENTE basándote en el "CONTEXTO DE LOS MATERIALES" proporcionado abajo. No utilices conocimiento externo, previo o general.
2. Si la información necesaria para responder no se encuentra en el contexto, debes responder exactamente: "No encontré información sobre eso en los materiales seleccionados."
3. Si el usuario realiza preguntas fuera de los temas académicos o de los materiales proporcionados, declina la respuesta de manera formal y profesional.
4. Cita siempre tus fuentes utilizando el formato (Fuente 1), (Fuente 2), etc., para respaldar cada afirmación.
5. Mantén estrictamente un lenguaje formal y académico en español.

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
        try {
            answer = await chatCompletion(messages);
        } catch (err) {
            context.error('Error en chat completion:', err);
            return { status: 500, body: JSON.stringify({ error: `Error generando respuesta (chat): ${err.message}` }) };
        }

        // ── 7. Construir respuesta con fuentes ────────────────────
        const sources = matches.map(m => ({
            materialType: m.metadata?.materialType,
            classId: m.metadata?.classId,
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
            timestamp: new Date().toISOString(),
            feedback: null
        };
        
        try {
            // Guardamos en un container específico para logs
            // Usamos una ruta que facilite la búsqueda por usuario y materia
            const userIdSanitized = (request.user?.id || 'anon').replace(/[^a-zA-Z0-9]/g, '_');
            await saveJson('chat-logs', `${userIdSanitized}/${subjectId}/${interactionId}.json`, chatLog);
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
