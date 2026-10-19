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
import { checkUploadQuota, recordUpload } from '../services/upload-quota.js';
import { CONFIG } from '../services/config.js';
import { normalizeClassIds } from '../services/class-ids.js';

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
            const { fileReadable, fileHeader, fileContentType, fileName, fileSize, classIds, subjectId, materialType, materialPriority } = await parseMultipart(request, context);
            
            log.info('Multipart parsed', { fileName, fileContentType, subjectId, materialType, classIds, materialPriority });

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

            // Per-teacher upload quota (#222): reject before consuming tokens/storage.
            try {
                const quota = await checkUploadQuota(userId, fileSize);
                if (!quota.allowed) {
                    const message = quota.reason === 'bytes'
                        ? 'Superaste el cupo de almacenamiento asignado. Liberá espacio borrando materiales viejos o pedí aumentar el límite.'
                        : 'Superaste el límite de materiales subidos. Liberá espacio borrando materiales viejos.';
                    log.warn('Upload quota exceeded', { userId, reason: quota.reason, used: quota.used, limits: quota.limits });
                    return structuredErrorResponse(429, message, ErrorCategory.RATE_LIMIT, 'UPLOAD_QUOTA_EXCEEDED');
                }
            } catch (quotaErr) {
                log.warn('Upload quota check failed (non-fatal, continuing)', { error: quotaErr.message });
            }

            const materialId = uuidv4();
            if (!validateFileType(fileHeader, materialType, fileName, materialId, context)) {
                const message = `El archivo "${sanitizeFileName(fileName)}" no coincide con el tipo de material "${materialType}". Formatos aceptados: ${acceptedFormatsLabel(materialType)}. Verificá que el contenido coincida con el formato declarado.`;
                return structuredErrorResponse(400, message, ErrorCategory.VALIDATION, 'INVALID_FILE_TYPE');
            }

            const material = {
                materialId,
                subjectId,
                classIds,
                type: materialType,
                filename: fileName,
                status: 'pending',
                uploadedAt: new Date().toISOString(),
                priority: getMaterialPriority(materialType, materialPriority),
                uploadedBy: userId,
                fileSize,
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
                            materialPriority,
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

                // Account upload against the teacher's quota (#222). Non-fatal on failure.
                try {
                    await recordUpload(userId, fileSize);
                    log.info('Upload quota recorded', { userId, fileSize });
                } catch (quotaErr) {
                    log.warn('Upload quota record failed (non-fatal)', { error: quotaErr.message });
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
 * Formatos aceptados por tipo de material.
 *
 * Fuente única de verdad: la validación y el mensaje de error salen de acá, y
 * la lista coincide con lo que declara la zona de carga del frontend
 * (`frontend/src/components/FileUpload.js`, TYPE_CONFIG) (#385).
 */
const FILE_TYPE_VARIANTS = {
    transcript: { variants: ['text', 'docx', 'pdf'], label: 'TXT, VTT, SRT, DOCX o PDF' },
    presentation: { variants: ['pptx', 'pdf'], label: 'PPTX o PDF' },
    notes: { variants: ['docx', 'pdf', 'text'], label: 'DOCX, PDF o TXT' },
    bibliography: { variants: ['pdf', 'docx', 'text'], label: 'PDF, DOCX o TXT' },
};

const EXTENSION_VARIANTS = {
    '.txt': 'text',
    '.vtt': 'text',
    '.srt': 'text',
    '.md': 'text',
    '.docx': 'docx',
    '.pptx': 'pptx',
    '.pdf': 'pdf',
};

/**
 * Etiqueta de los formatos aceptados para un tipo de material (para mensajes).
 * @param {string} materialType
 * @returns {string}
 */
function acceptedFormatsLabel(materialType) {
    return FILE_TYPE_VARIANTS[materialType]?.label || 'TXT, VTT, SRT, DOCX, PDF o PPTX';
}

/**
 * Contenido válido para una variante de archivo.
 * Los formatos de texto plano (TXT, VTT, SRT) se validan como UTF-8 legible;
 * los contenedores se validan por magic bytes.
 */
function contentMatchesVariant(buffer, variant, materialId, context) {
    const header = buffer.slice(0, 8).toString('hex').toLowerCase();
    const logWarn = (...args) => context?.log?.warn?.(...args);

    switch (variant) {
        case 'text': {
            if (header.startsWith('fffe') || header.startsWith('feff')) {
                logWarn(`[Ingest] Text file rejected materialId=${materialId} reason=utf16_bom_detected`);
                return false;
            }
            const scanLen = Math.min(buffer.length, 4096);
            let offset = 0;
            if (header.startsWith('efbbbf') && scanLen >= 3) {
                offset = 3;
            }
            const content = buffer.slice(offset, scanLen);
            if (content.length === 0) {
                logWarn(`[Ingest] Text file rejected materialId=${materialId} reason=empty_content`);
                return false;
            }
            for (let i = 0; i < content.length; i++) {
                if (content[i] === 0x00) {
                    logWarn(`[Ingest] Text file rejected materialId=${materialId} reason=nul_byte position=${i + offset}`);
                    return false;
                }
            }
            try {
                new TextDecoder('utf-8', { fatal: true }).decode(content);
            } catch {
                logWarn(`[Ingest] Text file rejected materialId=${materialId} reason=invalid_utf8`);
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
                logWarn(`[Ingest] Text file rejected materialId=${materialId} reason=control_chars_exceeded nonPrintablePct=${((nonPrintableCount / content.length) * 100).toFixed(1)}`);
                return false;
            }
            return true;
        }
        case 'docx':
        case 'pptx': {
            // Contenedores OOXML — ZIP (PK\x03\x04)
            if (header.startsWith('504b0304')) return true;
            logWarn(`[Ingest] File type validation failed for ${variant}: expected ZIP container, got header=0x${header}`);
            return false;
        }
        case 'pdf': {
            // PDF (25 50 44 46 = %PDF)
            if (header.startsWith('25504446')) return true;
            logWarn(`[Ingest] File type validation failed for pdf: expected %PDF, got header=0x${header}`);
            return false;
        }
        default:
            logWarn(`[Ingest] Unknown file variant "${variant}" — rejecting file`);
            return false;
    }
}

/**
 * Server-side file type validation by extension + magic bytes.
 * Rejects files whose content doesn't match the declared materialType.
 * Acepta exactamente los formatos que declara la superficie de carga (#385).
 */
function validateFileType(buffer, materialType, fileName, materialId, context) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
    const logWarn = (...args) => context?.log?.warn?.(...args);

    const config = FILE_TYPE_VARIANTS[materialType];
    if (!config) {
        // Tipo desconocido: no se restringe (comportamiento previo).
        logWarn(`[Ingest] Unknown materialType "${materialType}" — allowing file`);
        return true;
    }

    if (typeof fileName !== 'string' || !fileName) {
        logWarn(`[Ingest] File rejected: invalid fileName (materialType=${materialType})`);
        return false;
    }

    const ext = path.extname(fileName).toLowerCase();
    const variant = EXTENSION_VARIANTS[ext];
    if (!variant || !config.variants.includes(variant)) {
        logWarn(`[Ingest] File rejected materialId=${materialId} reason=extension_not_allowed materialType=${materialType} ext=${ext} accepted=${config.variants.join('|')}`);
        return false;
    }

    return contentMatchesVariant(buffer, variant, materialId, context);
}

export { validateFileType, acceptedFormatsLabel };

/**
 * Acumula el valor de un campo `classIds`/`classId` del multipart (#578).
 *
 * Un cliente puede mandar el campo como arreglo JSON (`["class-01"]`), como
 * lista separada por comas o repetir el campo. Antes se hacía un `split(',')`
 * sobre el texto crudo, así que un arreglo JSON quedaba como un único id
 * envuelto en corchetes (`'["class-01"]'`) y después el material no matcheaba
 * su clase. Acá se normaliza a un arreglo plano en el origen.
 *
 * @param {string[]|undefined} previous - ids ya acumulados de campos previos.
 * @param {string} rawValue - valor crudo del campo.
 * @returns {string[]}
 */
export function mergeClassIdsField(previous, rawValue) {
    const base = previous === undefined || previous === null ? [] : previous;
    return normalizeClassIds([...(Array.isArray(base) ? base : [base]), rawValue]);
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

        let fileReadable = null;
        let fileHeader = null;
        let fileContentType = '';
        let fileName = '';
        let fileSize = 0;
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
                    fileSize,
                    classIds: fields.classIds || (fields.classId ? [fields.classId] : []),
                    subjectId: fields.subjectId,
                    materialType: fields.materialType,
                    materialPriority: fields.materialPriority,
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
                fileSize += d.length;
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
                fields.classIds = mergeClassIdsField(fields.classIds, val);
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
