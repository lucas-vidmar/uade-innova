import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
/**
 * ingest-material.js — POST /api/ingest-material
 * Pipeline completo de ingesta: parsea archivo → chunks → embeddings → vector store
 */
import { app } from '@azure/functions';
import busboy from 'busboy';
import { PassThrough } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { parseFile, chunkText } from '../services/parser.js';
import { generateEmbedding } from '../services/openai.js';
import { uploadFile, saveJson } from '../services/storage.js';
import { upsertMaterialState } from '../services/state-store.js';
import { resolveCorrelationId, withCorrelationResponseHeaders } from '../services/correlation.js';

const CONTAINER_MATERIALS = process.env.AZURE_STORAGE_CONTAINER_MATERIALS || 'class-materials';
const CONTAINER_PROCESSED = 'processed';

app.http('ingest-material', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'ingest-material',
    handler: async (request, context) => {
        const correlationId = resolveCorrelationId(request);

        if (!validateFrontDoorId(request)) {
            return {
                status: 403,
                headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' })
            };
        }
        context.log('ingest-material triggered');
        context.log(`[Trace] Correlation-ID: ${correlationId}`);

        // ── 1. Parsear multipart/form-data ─────────────────────────
        let fileBuffer, fileContentType, fileName, classIds, subjectId, materialType;

        try {
            ({ fileBuffer, fileContentType, fileName, classIds, subjectId, materialType } =
                await parseMultipart(request));
        } catch (err) {
            return {
                status: 400,
                headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({ error: err.message })
            };
        }

        if (!classIds || classIds.length === 0 || !subjectId || !materialType) {
            return {
                status: 400,
                headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({ error: 'Faltan campos requeridos: classIds, subjectId, materialType' }),
            };
        }

        const materialId = uuidv4();
        // Usamos la primer clase del array para agrupar el binario en Storage (solo organizativo)
        const primaryClassId = classIds[0];
        const blobName = `${primaryClassId}/${materialId}-${fileName}`;

        const principal = parseClientPrincipal(request);
        const userId = principal?.oid || 'anonymous';

        // ── 2. Subir archivo crudo al Blob Storage con Metadatos ────
        const metadata = {
            materialId,
            classIds: classIds.join(','),
            subjectId,
            materialType,
            fileName: fileName,
            userId: userId,
            correlationId,
        };

        let blobUrl;
        try {
            blobUrl = await uploadFile(CONTAINER_MATERIALS, blobName, fileBuffer, fileContentType, metadata);
            context.log(`Archivo subido con metadatos: ${blobUrl}`);
        } catch (err) {
            context.error('Error subiendo a Storage:', err);
            return {
                status: 500,
                headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({ error: 'Error subiendo archivo a Storage' })
            };
        }

        // Responder inmediatamente con 202 (pipeline será disparado por el BlobTrigger)
        const responsePayload = { materialId, status: 'processing' };

        // Registrar estado inicial: processing
        const pendingState = {
            materialId,
            classIds,
            subjectId,
            type: materialType,
            filename: fileName,
            status: 'processing',
            blobUrl,
            chunkCount: 0,
            uploadedAt: new Date().toISOString(),
            processedAt: new Date().toISOString(),
        };

        try {
            await upsertMaterialState(pendingState, 'Replace');
        } catch (err) {
            context.error(`[StateStore] Error persisting processing state for ${materialId}:`, err);
        }

        await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, pendingState);

        return {
            status: 202,
            headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'application/json' }),
            body: JSON.stringify(responsePayload),
        };
    },
});

// Nota: se eliminó runPipeline de aquí porque ahora se ejecuta vía BlobTrigger en process-material.js

// ─── Helper: parsear multipart/form-data ─────────────────────────
function parseMultipart(request) {
    return new Promise((resolve, reject) => {
        const contentType = request.headers.get('content-type') || '';
        // Límite de 25MB por archivo para cumplir con requerimientos de la historia de usuario
        const MAX_FILE_SIZE = 25 * 1024 * 1024;

        const bb = busboy({
            headers: { 'content-type': contentType },
            limits: {
                fileSize: MAX_FILE_SIZE,
                files: 1
            }
        });

        let fileBuffer = null;
        let fileContentType = '';
        let fileName = '';
        const fields = {};
        let limitReached = false;

        bb.on('file', (fieldname, file, info) => {
            const { filename, mimeType } = info;
            fileName = filename;
            fileContentType = mimeType;
            const chunks = [];

            file.on('data', d => chunks.push(d));
            file.on('limit', () => {
                limitReached = true;
                file.resume(); // Consumir el resto sin guardar
            });
            file.on('end', () => {
                if (!limitReached) {
                    fileBuffer = Buffer.concat(chunks);
                }
            });
        });

        bb.on('field', (name, val) => {
            if (name === 'classIds') {
                fields[name] = fields[name] ? [...fields[name], val].flatMap(v => v.split(',')) : val.split(',');
            } else {
                fields[name] = val;
            }
        });

        bb.on('finish', () => {
            if (limitReached) return reject(new Error(`El archivo excede el límite permitido de ${MAX_FILE_SIZE / (1024 * 1024)}MB`));
            if (!fileBuffer) return reject(new Error('No se recibió ningún archivo'));
            resolve({
                fileBuffer,
                fileContentType,
                fileName,
                classIds: fields.classIds || (fields.classId ? [fields.classId] : []),
                subjectId: fields.subjectId,
                materialType: fields.materialType,
            });
        });

        bb.on('error', reject);

        request.arrayBuffer().then(buffer => {
            if (buffer.byteLength > MAX_FILE_SIZE + (1024 * 100)) { // +100KB para campos extra
                return reject(new Error('El tamaño de la petición excede el límite de seguridad.'));
            }
            const pass = new PassThrough();
            pass.end(Buffer.from(buffer));
            pass.pipe(bb);
        }).catch(err => reject(new Error('No se pudo leer el cuerpo de la petición')));
    });
}
