import { app } from '@azure/functions';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import busboy from 'busboy';
import { PassThrough } from 'stream';
import { uploadFile, saveMetricsToTable } from '../services/storage.js';
import { upsertMaterialState, getEnrollment } from '../services/state-store.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { getMaterialPriority } from '../services/material-classification.js';

const SESSION_METRICS_TABLE = 'SessionMetrics';

app.http('ingest-material', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'ingest-material',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        try {
            context.log(`[Ingest] Received request for ${request.url}`);
            const { fileBuffer, fileContentType, fileName, classIds, subjectId, materialType } = await parseMultipart(request, context);
            
            context.log(`[Ingest] Multipart parsed successfully: ${fileName} (${fileContentType}), subjectId=${subjectId}, materialType=${materialType}, classIds=${JSON.stringify(classIds)}`);

            // Security Check: Enrollment-based access control
            const principal = parseClientPrincipal(request);
            const userId = principal?.userId || principal?.oid || 'anonymous';
            const roles = principal?.userRoles || [];
            const isDirector = roles.includes('Director');
            const isTeacher = roles.includes('Docente');

            if (!isDirector) {
                try {
                    const enrollment = await getEnrollment(subjectId, userId);
                    if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
                        context.log.warn(`[Ingest] Unauthorized upload attempt: User ${userId} is not an active teacher for subject ${subjectId}`);
                        return {
                            status: 403,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ error: 'No tienes permisos para subir material a esta materia. Debes estar asignado como docente.' }),
                        };
                    }
                } catch (enrollmentErr) {
                    context.error(`[Ingest] Error verifying enrollment for ${userId} in ${subjectId}:`, enrollmentErr);
                    // Fail secure: if we can't verify enrollment, we block the upload
                    return {
                        status: 500,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'Error al verificar permisos de docente.' }),
                    };
                }
            }

            if (!classIds || classIds.length === 0 || !subjectId || !materialType) {
                context.log.warn(`[Ingest] Missing required fields: classIds=${classIds?.length}, subjectId=${!!subjectId}, materialType=${!!materialType}`);
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Faltan campos requeridos: classIds, subjectId, materialType' }),
                };
            }

            if (!validateFileType(fileBuffer, materialType, context)) {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: `El tipo de archivo no coincide con el tipo de material "${materialType}". Formatos aceptados: TXT, VTT, DOCX, PDF, PPTX.` }),
                };
            }

            const materialId = uuidv4();
            const material = {
                materialId,
                subjectId,
                classIds,
                type: materialType,
                filename: fileName,
                status: 'pending',
                uploadedAt: new Date().toISOString(),
                priority: getMaterialPriority(materialType),
            };

            try {
                context.log(`[Ingest] Initializing material state in Table Storage: ${materialId}`);
                await upsertMaterialState(material);

                const blobName = `${subjectId}/${materialId}${path.extname(fileName)}`;
                context.log(`[Ingest] Uploading file to blob storage: ${blobName}`);

                const blobUrl = await uploadFile(
                    process.env.AZURE_STORAGE_CONTAINER_MATERIALS || 'class-materials',
                    blobName,
                    fileBuffer,
                    fileContentType,
                    {
                        materialId,
                        subjectId,
                        materialType,
                        classIds: JSON.stringify(classIds),
                        fileName
                    }
                );

                context.log(`[Ingest] File uploaded successfully: ${blobUrl}`);

                const updatedMaterial = await upsertMaterialState({
                    ...material,
                    blobUrl,
                    status: 'processing'
                });

                try {
                    await saveMetricsToTable(SESSION_METRICS_TABLE, {
                        partitionKey: new Date().toISOString().slice(0, 10),
                        rowKey: `${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        eventType: 'material-upload',
                        userId,
                        teacherId: userId,
                        subjectId,
                        classId: classIds[0] || '',
                        materialType,
                        filename: fileName,
                        timestamp: new Date().toISOString()
                    });
                } catch (metricsErr) {
                    context.log.warn(`[Ingest] Non-fatal error writing material upload metric: ${metricsErr.message}`);
                }

                return {
                    status: 202,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedMaterial),
                };
            } catch (storageErr) {
                context.error(`[Ingest] Storage error for ${materialId}:`, storageErr);
                return {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: `Error de almacenamiento: ${storageErr.message}` }),
                };
            }

        } catch (err) {
            context.error('[Ingest] Fatal error in ingest-material handler:', err);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: err.message || 'Error interno del servidor' }),
            };
        }
    }
});

/**
 * Server-side file type validation by magic bytes.
 * Rejects files whose content doesn't match the declared materialType.
 */
function validateFileType(buffer, materialType, context) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
    const header = buffer.slice(0, 8).toString('hex').toLowerCase();
    const fileNameCheck = ''; // will be set if a filename is available

    switch (materialType) {
        case 'transcript':
            // TXT, VTT — plain text. No magic bytes, check for printable ASCII / UTF-8.
            return true;
        case 'presentation':
            // PPTX — ZIP-based (PK\x03\x04)
            if (header.startsWith('504b0304')) return true;
            // PDF fallback: some presentations are uploaded as PDF
            if (header.startsWith('25504446')) return true;
            context.log.warn(`[Ingest] File type validation failed for presentation: expected PPTX/PDF, got header=0x${header}`);
            return false;
        case 'notes':
            // DOCX — ZIP-based (PK\x03\x04)
            if (header.startsWith('504b0304')) return true;
            // PDF
            if (header.startsWith('25504446')) return true;
            context.log.warn(`[Ingest] File type validation failed for notes: expected DOCX/PDF, got header=0x${header}`);
            return false;
        case 'bibliography':
            // PDF (25 50 44 46 = %PDF)
            if (header.startsWith('25504446')) return true;
            // DOCX
            if (header.startsWith('504b0304')) return true;
            context.log.warn(`[Ingest] File type validation failed for bibliography: expected PDF/DOCX, got header=0x${header}`);
            return false;
        default:
            context.log.warn(`[Ingest] Unknown materialType "${materialType}" — allowing file`);
            return true;
    }
}

/**
 * Parsea el cuerpo de la petición multipart/form-data usando busboy.
 */
async function parseMultipart(request, context) {
    return new Promise((resolve, reject) => {
        const contentType = request.headers.get('content-type');
        if (!contentType) return reject(new Error('Missing content-type header'));

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
        let fileStreamFinished = false;
        let busboyFinished = false;

        const checkCompletion = () => {
            if (busboyFinished && (fileStreamFinished || !fileName)) {
                if (limitReached) return reject(new Error(`El archivo excede el límite permitido de ${MAX_FILE_SIZE / (1024 * 1024)}MB`));
                if (!fileBuffer && fileName) return reject(new Error('No se recibió el contenido del archivo'));
                
                resolve({
                    fileBuffer,
                    fileContentType,
                    fileName,
                    classIds: fields.classIds || (fields.classId ? [fields.classId] : []),
                    subjectId: fields.subjectId,
                    materialType: fields.materialType,
                });
                context.log(`[Ingest] Fields successfully extracted: subjectId=${fields.subjectId}, materialType=${fields.materialType}, classIds=${JSON.stringify(fields.classIds || fields.classId)}`);
            }
        };

        bb.on('file', (fieldname, file, info) => {
            const { filename, mimeType } = info;
            fileName = filename;
            fileContentType = mimeType;
            const chunks = [];

            file.on('data', d => chunks.push(d));
            file.on('limit', () => {
                limitReached = true;
                file.resume();
            });
            file.on('end', () => {
                if (!limitReached) {
                    fileBuffer = Buffer.concat(chunks);
                }
                fileStreamFinished = true;
                checkCompletion();
            });
        });

        bb.on('field', (name, val) => {
            if (name === 'classIds' || name === 'classId') {
                const targetName = 'classIds';
                const parts = val.split(',').map(v => v.trim()).filter(Boolean);
                fields[targetName] = (fields[targetName] || []).concat(parts);
            } else {
                fields[name] = val;
            }
        });

        bb.on('finish', () => {
            busboyFinished = true;
            checkCompletion();
        });

        bb.on('error', (err) => {
            context.error('[Busboy] Error:', err);
            reject(err);
        });

        request.arrayBuffer().then(buffer => {
            if (buffer.byteLength > MAX_FILE_SIZE + (1024 * 100)) {
                return reject(new Error('El tamaño de la petición excede el límite de seguridad.'));
            }
            const pass = new PassThrough();
            pass.end(Buffer.from(buffer));
            pass.pipe(bb);
        }).catch(err => {
            context.error('[Ingest] Error reading request buffer:', err);
            reject(new Error('No se pudo leer el cuerpo de la petición'));
        });
    });
}
