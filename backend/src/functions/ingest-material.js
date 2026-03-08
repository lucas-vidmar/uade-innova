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
        let fileBuffer, fileContentType, fileName, classId, subjectId, materialType;

        try {
            ({ fileBuffer, fileContentType, fileName, classId, subjectId, materialType } =
                await parseMultipart(request));
        } catch (err) {
            return { status: 400, body: JSON.stringify({ error: err.message }) };
        }

        if (!classId || !subjectId || !materialType) {
            return {
                status: 400,
                body: JSON.stringify({ error: 'Faltan campos requeridos: classId, subjectId, materialType' }),
            };
        }

        const materialId = uuidv4();
        const blobName = `${classId}/${materialId}-${fileName}`;

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

        // ── 3. Pipeline asíncrono (no bloqueamos la respuesta HTTP) ─
        runPipeline({ fileBuffer, fileContentType, fileName, classId, subjectId, materialType, materialId, blobUrl }, context)
            .catch(err => context.error('Error en pipeline:', err));

        return {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responsePayload),
        };
    },
});

// ─── Pipeline de procesamiento ───────────────────────────────────
async function runPipeline({ fileBuffer, fileContentType, fileName, classId, subjectId, materialType, materialId, blobUrl }, context) {
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
                classId,
                materialId,
                materialType,
                chunkIndex: i,
                sourceFilename: fileName,
                lectureDate: new Date().toISOString(),
                text: chunks[i].slice(0, 500), // guardar extracto para mostrar en fuentes
            },
        });
    }

    // 3d. Upsert en Pinecone
    await upsertChunks(vectors);
    context.log(`Vectores indexados en Pinecone: ${vectors.length}`);

    // 3e. Guardar estado del material en Storage
    const materialState = {
        materialId,
        classId,
        subjectId,
        type: materialType,
        filename: fileName,
        status: 'ready',
        blobUrl,
        chunkCount: chunks.length,
        processedAt: new Date().toISOString(),
    };
    await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, materialState);
    context.log(`Estado guardado: processed/${materialId}.json`);
}

// ─── Helper: parsear multipart/form-data ─────────────────────────
function parseMultipart(request) {
    return new Promise((resolve, reject) => {
        const contentType = request.headers.get('content-type') || '';
        const bb = busboy({ headers: { 'content-type': contentType } });

        let fileBuffer = null;
        let fileContentType = '';
        let fileName = '';
        const fields = {};

        bb.on('file', (fieldname, file, info) => {
            const { filename, mimeType } = info;
            fileName = filename;
            fileContentType = mimeType;
            const chunks = [];
            file.on('data', d => chunks.push(d));
            file.on('end', () => { fileBuffer = Buffer.concat(chunks); });
        });

        bb.on('field', (name, val) => { fields[name] = val; });

        bb.on('finish', () => {
            if (!fileBuffer) return reject(new Error('No se recibió ningún archivo'));
            resolve({
                fileBuffer,
                fileContentType,
                fileName,
                classId: fields.classId,
                subjectId: fields.subjectId,
                materialType: fields.materialType,
            });
        });

        bb.on('error', reject);

        // En Azure Functions v4 (Node.js), request.body es a veces un Web ReadableStream o nulo si no se lee bien
        // La forma más robusta es obtener un arrayBuffer real y pasarlo por un stream de Node
        request.arrayBuffer().then(buffer => {
            const pass = new PassThrough();
            pass.end(Buffer.from(buffer));
            pass.pipe(bb);
        }).catch(err => reject(new Error('No se pudo leer el cuerpo de la petición')));
    });
}
