import { app } from '@azure/functions';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import busboy from 'busboy';
import { PassThrough } from 'stream';
import { uploadStream, uploadFile, saveMetricsToTable } from '../services/storage.js';
import { upsertMaterialState, getEnrollment } from '../services/state-store.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { getMaterialPriority } from '../services/material-classification.js';
import { ErrorCategory, normalizeCategorizedError, structuredErrorResponse } from '../services/error-categories.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { withRateLimit } from '../middleware/with-rate-limit.js';
import { withAuth } from '../middleware/with-auth.js';
import { createStructuredLogger } from '../services/structured-logger.js';
import { CONFIG } from '../services/config.js';

const SESSION_METRICS_TABLE = 'SessionMetrics';

app.http('ingest-material', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'ingest-material',
    handler: withCorrelation(withRateLimit(withAuth(async (request, context) => {
        const log = createStructuredLogger('ingest-material', context);
        if (!validateFrontDoorId(request)) {
            return structuredErrorResponse(403, 'Forbidden - Invalid Front Door ID', ErrorCategory.AUTH, 'FRONTDOOR_INVALID');
        }

        try {
            log.info('Ingest request received', { url: request.url });
            const { fileReadable, fileHeader, fileContentType, fileName, classIds, subjectId, materialType } = await parseMultipart(request, context);
            
            log.info('Multipart parsed', { fileName, fileContentType, subjectId, materialType, classIds });

            // Security Check: Enrollment-based access control
            const principal = context.principal || parseClientPrincipal(request);
            const userId = principal?.userId || principal?.oid || 'anonymous';
            const roles = principal?.userRoles || [];
            const isDirector = roles.includes('Director');
            const isTeacher = roles.includes('Docente');

            if (!isDirector) {
                try {
                    const enrollment = await getEnrollment(subjectId, userId);
                    if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
                        log.warn('Unauthorized upload attempt', { userId, subjectId });
                        return structuredErrorResponse(403, 'No tienes permisos para subir material a esta materia. Debes estar asignado como docente.', ErrorCategory.AUTH, 'ENROLLMENT_INACTIVE');
                    }
                } catch (enrollmentErr) {
                    log.error('Enrollment verification error', { userId, subjectId, error: enrollmentErr.message });
                    const categorized = normalizeCategorizedError(enrollmentErr, ErrorCategory.AUTH);
                    return structuredErrorResponse(categorized.status, 'Error al verificar permisos de docente.', categorized.errorCategory, categorized.code);
                }
            }

            if (!classIds || classIds.length === 0 || !subjectId || !materialType) {
                log.warn('Missing required fields', { classIdsLength: classIds?.length, hasSubjectId: !!subjectId, hasMaterialType: !!materialType });
                return structuredErrorResponse(400, 'Faltan campos requeridos: classIds, subjectId, materialType', ErrorCategory.VALIDATION, 'MISSING_FIELDS');
            }

            const materialId = uuidv4();
            if (!validateFileType(fileHeader, materialType, fileName, materialId, context)) {
                const message = materialType === 'transcript'
                    ? 'El archivo no es un texto válido (UTF-8). Verificá el formato.'
                    : `El tipo de archivo no coincide con el tipo de material "${materialType}". Formatos aceptados: TXT, VTT, DOCX, PDF, PPTX.`;
                const code = materialType === 'transcript' ? 'FILE_CONTENT_INVALID' : 'INVALID_FILE_TYPE';
                return structuredErrorResponse(400, message, ErrorCategory.VALIDATION, code);
            }

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
                log.info('Initializing material state', { materialId });
                await upsertMaterialState(material);

                const blobName = `${subjectId}/${materialId}${path.extname(fileName)}`;
                log.info('Uploading file to blob storage', { blobName });

                let uploadResult;
                try {
                    uploadResult = await uploadStream(
                        CONFIG.containers.materials,
                        blobName,
                        fileReadable,
                        fileContentType,
                        {
                            materialId,
                            subjectId,
                            materialType,
                            classIds: JSON.stringify(classIds),
                            fileName
                        }
                    );
                } catch (streamErr) {
                    context.error(`[Ingest] Upload stream failed for ${materialId}:`, streamErr);
                    const categorized = normalizeCategorizedError(streamErr, ErrorCategory.STORAGE);
                    return structuredErrorResponse(500, 'Error al subir el archivo. Intentá de nuevo.', categorized.errorCategory, 'UPLOAD_STREAM_FAILED');
                }

                const blobUrl = uploadResult.url;
                log.info('File uploaded successfully', { blobUrl });

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
                        timestamp: new Date()
                    });
                } catch (metricsErr) {
                    log.warn('Non-fatal metrics write error', { error: metricsErr.message });
                }

                return {
                    status: 202,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedMaterial),
                };
            } catch (storageErr) {
                log.error('Storage error', { materialId, error: storageErr.message });
                const categorized = normalizeCategorizedError(storageErr, ErrorCategory.STORAGE);
                return structuredErrorResponse(categorized.status, `Error de almacenamiento: ${categorized.message}`, categorized.errorCategory, categorized.code);
            }

        } catch (err) {
            log.error('Fatal handler error', { error: err.message });
            const categorized = normalizeCategorizedError(err, ErrorCategory.INTERNAL);
            return structuredErrorResponse(categorized.status, categorized.message || 'Error interno del servidor', categorized.errorCategory, categorized.code);
        }
    }, { roles: ['Docente', 'Director'] }), 'ingest'))
});

function sanitizeFileName(name) {
    if (typeof name !== 'string') return 'unknown';
    return name.length > 120 ? name.slice(0, 120) + '...' : name.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '?');
}

/**
 * Server-side file type validation by magic bytes.
 * Rejects files whose content doesn't match the declared materialType.
 */
function validateFileType(buffer, materialType, fileName, materialId, context) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
    const header = buffer.slice(0, 8).toString('hex').toLowerCase();
    const safeName = sanitizeFileName(fileName);
    const logWarn = (...args) => context?.log?.warn?.(...args);

    switch (materialType) {
        case 'transcript': {
            if (typeof fileName !== 'string' || !fileName) {
                logWarn(`[Ingest] Transcript rejected: invalid fileName`);
                return false;
            }
            const allowedExts = ['.txt', '.vtt'];
            const ext = path.extname(fileName).toLowerCase();
            if (!allowedExts.includes(ext)) {
                logWarn(`[Ingest] Transcript file rejected materialId=${materialId} reason=extension_not_allowed ext=${ext}`);
                return false;
            }
            if (header.startsWith('fffe') || header.startsWith('feff')) {
                logWarn(`[Ingest] Transcript file rejected materialId=${materialId} reason=utf16_bom_detected`);
                return false;
            }
            const scanLen = Math.min(buffer.length, 4096);
            let offset = 0;
            if (header.startsWith('efbbbf') && scanLen >= 3) {
                offset = 3;
            }
            const content = buffer.slice(offset, scanLen);
            if (content.length === 0) {
                logWarn(`[Ingest] Transcript file rejected materialId=${materialId} reason=empty_content`);
                return false;
            }
            for (let i = 0; i < content.length; i++) {
                if (content[i] === 0x00) {
                    logWarn(`[Ingest] Transcript file rejected materialId=${materialId} reason=nul_byte position=${i + offset}`);
                    return false;
                }
            }
            try {
                new TextDecoder('utf-8', { fatal: true }).decode(content);
            } catch {
                logWarn(`[Ingest] Transcript file rejected materialId=${materialId} reason=invalid_utf8`);
                return false;
            }
            let nonPrintableCount = 0;
            for (let i = 0; i < content.length; i++) {
                const byte = content[i];
                if (!((byte >= 0x20 && byte <= 0x7E) || byte === 0x09 || byte === 0x0A || byte === 0x0D || byte >= 0x80)) {
                    nonPrintableCount++;
                }
            }
            if (nonPrintableCount * 100 > content.length) {
                logWarn(`[Ingest] Transcript file rejected materialId=${materialId} reason=control_chars_exceeded nonPrintablePct=${((nonPrintableCount / content.length) * 100).toFixed(1)}`);
                return false;
            }
            return true;
        }
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

export { validateFileType };

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

        let fileReadable = null;
        let fileHeader = null;
        let fileContentType = '';
        let fileName = '';
        const fields = {};
        let limitReached = false;
        let fileStreamFinished = false;
        let busboyFinished = false;

        const checkCompletion = () => {
            if (busboyFinished && (fileStreamFinished || !fileName)) {
                if (limitReached) return reject(new Error(`El archivo excede el límite permitido de ${MAX_FILE_SIZE / (1024 * 1024)}MB`));
                if (!fileReadable && fileName) return reject(new Error('No se recibió el contenido del archivo'));
                
                resolve({
                    fileReadable,
                    fileHeader,
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

            const passThrough = new PassThrough();
            fileReadable = passThrough;

            file.on('data', d => {
                if (!fileHeader || fileHeader.length < 8192) {
                    fileHeader = fileHeader ? Buffer.concat([fileHeader, d]) : d;
                }
                const canContinue = passThrough.write(d);
                if (!canContinue) {
                    file.pause();
                    passThrough.once('drain', () => file.resume());
                }
            });
            file.on('limit', () => {
                limitReached = true;
                passThrough.destroy(new Error(`El archivo excede el límite permitido de ${MAX_FILE_SIZE / (1024 * 1024)}MB`));
                file.resume();
            });
            file.on('end', () => {
                passThrough.end();
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
