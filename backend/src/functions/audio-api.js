import { app } from '@azure/functions';
import { uploadFile, downloadFile, listBlobs } from '../services/storage.js';
import { generateClassAudio } from '../services/ai.js';
import { loadJson } from '../services/storage.js';
import { resolveCorrelationId, buildDependencyHeaders, withCorrelationResponseHeaders } from '../services/correlation.js';

const CONTAINER_AUDIO = 'class-audio';
const CONTAINER_SUMMARIES = 'class-summaries';

app.http('get-class-audio', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'class-audio/{classId}',
    handler: async (request, context) => {
        const correlationId = resolveCorrelationId(request);
        const openAiHeaders = buildDependencyHeaders(correlationId);

        const classId = request.params.classId;
        if (!classId) {
            return {
                status: 400,
                headers: withCorrelationResponseHeaders(correlationId),
                body: 'Falta classId'
            };
        }

        context.log(`[Trace] Correlation-ID: ${correlationId}`);

        try {
            const blobName = `${classId}.mp3`;
            
            // 1. Intentar descargar del storage si ya existe
            try {
                const audioBuffer = await downloadFile(CONTAINER_AUDIO, blobName);
                return {
                    status: 200,
                    headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'audio/mpeg' }),
                    body: audioBuffer
                };
            } catch (err) {
                // Si no existe, procedemos a generar
                context.log(`Audio no encontrado para ${classId}, generando...`);
            }

            // 2. Obtener el resumen de la clase para convertirlo a audio
            const summaryData = await loadJson(CONTAINER_SUMMARIES, `${classId}.json`);
            if (!summaryData) {
                return {
                    status: 404,
                    headers: withCorrelationResponseHeaders(correlationId),
                    body: 'Resumen no encontrado para esta clase. Genera el resumen primero.'
                };
            }

            const textToSpeak = typeof summaryData === 'string' ? summaryData : (summaryData.summary?.content || summaryData.summary || '');
            if (!textToSpeak) {
                return {
                    status: 404,
                    headers: withCorrelationResponseHeaders(correlationId),
                    body: 'Contenido del resumen vacío.'
                };
            }

            // 3. Generar audio con OpenAI TTS
            const audioBuffer = await generateClassAudio(textToSpeak, 'nova', { headers: openAiHeaders });

            // 4. Guardar en Blob Storage para futuras consultas (cache)
            await uploadFile(CONTAINER_AUDIO, blobName, audioBuffer, 'audio/mpeg');

            return {
                status: 200,
                headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'audio/mpeg' }),
                body: audioBuffer
            };

        } catch (err) {
            context.error(`Error en get-class-audio para ${classId}:`, err);
            return {
                status: 500,
                headers: withCorrelationResponseHeaders(correlationId),
                body: 'Error interno generando audio.'
            };
        }
    }
});
