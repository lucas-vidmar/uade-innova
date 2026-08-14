import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { uploadFile, downloadFile, listBlobs, loadJson } from '../services/storage.js';
import { generateClassAudio } from '../services/ai.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getEnrollment } from '../services/state-store.js';
import { withCorrelation } from '../middleware/with-correlation.js';

const CONTAINER_AUDIO = 'class-audio';
const CONTAINER_SUMMARIES = 'class-summaries';

app.http('get-class-audio', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'class-audio/{classId}',
    handler: withCorrelation(withAuth(async (request, context) => {
        const { correlationId, dependencyHeaders } = context;

        const classId = request.params.classId;
        const subjectId = request.query.get('subjectId');
        
        if (!classId || !subjectId) {
            return {
                status: 400,
                headers: {},
                body: 'Faltan parámetros requeridos: classId y subjectId'
            };
        }

        if (!validateFrontDoorId(request)) {
            return {
                status: 403,
                headers: {},
                body: 'Forbidden - Invalid Front Door ID'
            };
        }

        // Security Check: Enrollment-based access control
        const principal = parseClientPrincipal(request);
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const roles = principal?.userRoles || [];
        const isDirector = roles.includes('Director');

        if (!isDirector && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development') {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.status !== 'active') {
                    return {
                        status: 403,
                        headers: {},
                        body: 'No tienes acceso a los recursos de esta materia.'
                    };
                }
            } catch (err) {
                return {
                    status: 500,
                    headers: {},
                    body: 'Error verificando permisos de acceso.'
                };
            }
        }

        context.log(`[Trace] Correlation-ID: ${correlationId}`);

        const CONTAINER_SCRIPTS = 'class-audio-scripts';
        const blobName = `${classId}.mp3`;

        try {
            // 1. Intentar descargar del storage si ya existe (caché)
            const cachedAudio = await downloadFile(CONTAINER_AUDIO, blobName).catch(() => null);
            if (cachedAudio) {
                return {
                    status: 200,
                    headers: { 'Content-Type': 'audio/mpeg' },
                    body: cachedAudio
                };
            }

            // 2. Buscar guión de podcast validado
            const scriptData = await loadJson(CONTAINER_SCRIPTS, `${classId}.json`);
            if (!scriptData || !scriptData.script || !scriptData.validated) {
                return {
                    status: 404,
                    headers: {},
                    body: 'No hay guión de podcast validado para esta clase. El docente debe aprobarlo primero.'
                };
            }

            // 3. Generar audio con OpenAI TTS a partir del guión validado
            context.log(`Audio no encontrado en caché para ${classId}, generando desde guión validado...`);
            const audioBuffer = await generateClassAudio(scriptData.script, 'nova', { headers: dependencyHeaders });

            // 4. Guardar en Blob Storage para futuras consultas (caché)
            await uploadFile(CONTAINER_AUDIO, blobName, audioBuffer, 'audio/mpeg');

            return {
                status: 200,
                headers: { 'Content-Type': 'audio/mpeg' },
                body: audioBuffer
            };

        } catch (err) {
            context.error(`Error en get-class-audio para ${classId}:`, err);
            return {
                status: 500,
                headers: {},
                body: 'Error interno generando audio.'
            };
        }
    }))
});
