/**
 * ingest-material.js — POST /api/ingest-material
 * Pipeline completo de ingesta: parsea archivo → chunks → embeddings → Pinecone
 */
import { app } from '@azure/functions';
import busboy from 'busboy';
import { PassThrough } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { parseFile, chunkText } from '../services/parser.js';
import { generateEmbedding } from '../services/openai.js';
import { upsertChunks } from '../services/pinecone.js';
import { uploadFile, saveJson } from '../services/storage.js';

const CONTAINER_MATERIALS = process.env.AZURE_STORAGE_CONTAINER_MATERIALS || 'class-materials';
const CONTAINER_PROCESSED = 'processed';

app.http('ingest-material', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'ingest-material',
    handler: async (request, context) => {
        context.log('ingest-material triggered');

        // ── 1. Parsear multipart/form-data ─────────────────────────
        let fileBuffer, fileContentType, fileName, classIds, subjectId, materialType;

        try {
            ({ fileBuffer, fileContentType, fileName, classIds, subjectId, materialType } =
                await parseMultipart(request));
        } catch (err) {
            return { status: 400, body: JSON.stringify({ error: err.message }) };
        }

        if (!classIds || classIds.length === 0 || !subjectId || !materialType) {
            return {
                status: 400,
                body: JSON.stringify({ error: 'Faltan campos requeridos: classIds, subjectId, materialType' }),
            };
        }

        const materialId = uuidv4();
        // Usamos la primer clase del array para agrupar el binario en Storage (solo organizativo)
        const primaryClassId = classIds[0];
        const blobName = `${primaryClassId}/${materialId}-${fileName}`;

        // ── 2. Subir archivo crudo al Blob Storage ─────────────────
        let blobUrl;
        try {
            blobUrl = await uploadFile(CONTAINER_MATERIALS, blobName, fileBuffer, fileContentType);
            context.log(`Archivo subido: ${blobUrl}`);
        } catch (err) {
            context.error('Error subiendo a Storage:', err);
            return { status: 500, body: JSON.stringify({ error: 'Error subiendo archivo a Storage' }) };
        }

        // Responder inmediatamente con 202 (pipeline es asíncrono)
        const responsePayload = { materialId, status: 'processing' };

        // Registrar instantáneamente en Storage para que get-classes no lo pierda si la query RAG tarda
        const pendingState = {
            materialId,
            classIds,
            subjectId,
            type: materialType,
            filename: fileName,
            status: 'processing',
            blobUrl,
            chunkCount: 0,
            processedAt: new Date().toISOString(),
        };
        await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, pendingState);

        // ── 3. Pipeline asíncrono (no bloqueamos la respuesta HTTP) ─
        runPipeline({ fileBuffer, fileContentType, fileName, classIds, subjectId, materialType, materialId, blobUrl }, context)
            .catch(err => context.error('Error en pipeline:', err));

        return {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responsePayload),
        };
    },
});

// ─── Pipeline de procesamiento ───────────────────────────────────
async function runPipeline({ fileBuffer, fileContentType, fileName, classIds, subjectId, materialType, materialId, blobUrl }, context) {
    try {
        // 3a. Extraer texto según tipo de archivo
        context.log(`Parseando archivo: ${fileName} (${fileContentType})`);
        const text = await parseFile(fileBuffer, fileContentType, fileName);
        context.log(`Texto extraído: ${text.length} caracteres`);

        // 3b. Dividir en chunks
        const chunks = chunkText(text, 512, 50);
        context.log(`Chunks generados: ${chunks.length}`);

        // 3c. Generar embeddings y preparar vectores para Pinecone
        const vectors = [];
        for (let i = 0; i < chunks.length; i++) {
            const embedding = await generateEmbedding(chunks[i]);
            vectors.push({
                id: `${materialId}-chunk-${i}`,
                values: embedding,
                metadata: {
                    subjectId,
                    classIds,
                    materialId,
                    materialType,
                    chunkIndex: i,
                    sourceFilename: fileName,
                    lectureDate: new Date().toISOString(),
                    text: chunks[i],
                },
            });
        }

        // 3d. Upsert en Pinecone
        context.log(`Indexando ${vectors.length} vectores en Pinecone index: ${process.env.PINECONE_INDEX_NAME}...`);
        await upsertChunks(vectors);
        context.log(`Vectores indexados con éxito.`);

        // 3e. Guardar estado final: ready
        const materialState = {
            materialId,
            classIds,
            subjectId,
            type: materialType,
            filename: fileName,
            status: 'ready',
            blobUrl,
            chunkCount: chunks.length,
            processedAt: new Date().toISOString(),
        };
        await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, materialState);
        context.log(`Estado guardado: processed/${materialId}.json (ready)`);
    } catch (err) {
        context.error(`Error crítico en pipeline para material ${materialId}:`, err);
        
        // Guardar estado: error para evitar que quede stuck en "processing"
        const errorState = {
            materialId,
            classIds,
            subjectId,
            type: materialType,
            filename: fileName,
            status: 'error',
            blobUrl,
            error: err.message,
            processedAt: new Date().toISOString(),
        };
        try {
            await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, errorState);
            context.log(`Estado de error persistido para ${materialId}`);
        } catch (saveErr) {
            context.error('No se pudo guardar ni siquiera el estado de error:', saveErr);
        }
    }
}

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
