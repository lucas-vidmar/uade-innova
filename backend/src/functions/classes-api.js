import { app } from '@azure/functions';
import { loadJson, saveJson, listBlobs, deleteBlob, getTableClient } from '../services/storage.js';
import { v4 as uuidv4 } from 'uuid';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { listClassesBySubject, listMaterialsBySubject, replaceClassesForSubject, deleteMaterialStateById, getMaterialState, upsertMaterialState, deleteClassesBySubject, deleteMaterialsBySubject, getEnrollmentsByUser } from '../services/state-store.js';
import * as vectorStore from '../services/vector-store.js';

const CONTAINER_CLASSES = process.env.AZURE_STORAGE_CONTAINER_CLASSES || 'classes-config';
const CONTAINER_PROCESSED = 'processed';
const SUBJECTS_BLOB = 'subjects.json';

const DEFAULT_SUBJECTS = [
    { id: 'arq-software-2026', name: 'Arquitectura de Software', group: 'GRP-ARQ-SOFT-2026' },
    { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas', group: 'GRP-DIS-SIST-2026' }
];

const SESSION_METRICS_TABLE = 'SessionMetrics';
const POWERBI_DEFAULT_DAYS = 14;

function toIsoDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
}

function createDailyBucket(date) {
    return {
        date,
        dau: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        avgCostPerInteraction: 0,
        ragInteractions: 0,
        _users: new Set(),
    };
}

function computeInputCost(promptTokens = 0) {
    return Number(promptTokens || 0) * 0.00000015;
}

function computeOutputCost(completionTokens = 0) {
    return Number(completionTokens || 0) * 0.0000006;
}

async function loadSessionMetricsRows(context) {
    try {
        const tableClient = getTableClient(SESSION_METRICS_TABLE);
        const rows = [];
        for await (const entity of tableClient.listEntities()) {
            rows.push(entity);
        }
        return rows;
    } catch (err) {
        context.log.warn(`[PowerBI] Could not read ${SESSION_METRICS_TABLE}: ${err.message}`);
        return [];
    }
}

async function computeDirectorMetrics(context, requestedDays = POWERBI_DEFAULT_DAYS) {
    const days = Math.min(Math.max(Number(requestedDays) || POWERBI_DEFAULT_DAYS, 1), 90);
    const rows = await loadSessionMetricsRows(context);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setUTCDate(today.getUTCDate() - (days - 1));

    const buckets = new Map();
    const uniqueUsersWindow = new Set();
    for (let i = 0; i < days; i++) {
        const date = new Date(start);
        date.setUTCDate(start.getUTCDate() + i);
        const iso = toIsoDate(date);
        buckets.set(iso, createDailyBucket(iso));
    }

    for (const row of rows) {
        const iso = toIsoDate(row?.timestamp);
        if (!iso || !buckets.has(iso)) continue;

        const bucket = buckets.get(iso);
        const promptTokens = Number(row?.promptTokens || 0);
        const completionTokens = Number(row?.completionTokens || 0);
        const totalTokens = Number(row?.totalTokens || 0);
        const userId = String(row?.userId || '').trim();

        bucket.promptTokens += Number.isFinite(promptTokens) ? promptTokens : 0;
        bucket.completionTokens += Number.isFinite(completionTokens) ? completionTokens : 0;
        bucket.totalTokens += Number.isFinite(totalTokens) ? totalTokens : 0;
        bucket.ragInteractions += 1;
        if (userId && userId !== 'anonymous') {
            bucket._users.add(userId);
            uniqueUsersWindow.add(userId);
        }
    }

    const daily = Array.from(buckets.values()).map((bucket) => ({
        inputCost: Number(computeInputCost(bucket.promptTokens).toFixed(6)),
        outputCost: Number(computeOutputCost(bucket.completionTokens).toFixed(6)),
        totalCost: Number((computeInputCost(bucket.promptTokens) + computeOutputCost(bucket.completionTokens)).toFixed(6)),
        avgCostPerInteraction: Number(((computeInputCost(bucket.promptTokens) + computeOutputCost(bucket.completionTokens)) / Math.max(bucket.ragInteractions, 1)).toFixed(8)),
        date: bucket.date,
        dau: bucket._users.size,
        promptTokens: bucket.promptTokens,
        completionTokens: bucket.completionTokens,
        totalTokens: bucket.totalTokens,
        ragInteractions: bucket.ragInteractions,
    }));

    const latest = daily[daily.length - 1] || { dau: 0, totalTokens: 0, ragInteractions: 0, totalCost: 0 };
    const previous = daily[daily.length - 2] || { dau: 0, totalTokens: 0, ragInteractions: 0, totalCost: 0 };

    const dauDelta = previous.dau > 0
        ? Math.round(((latest.dau - previous.dau) / previous.dau) * 100)
        : (latest.dau > 0 ? 100 : 0);
    const ragDelta = previous.ragInteractions > 0
        ? Math.round(((latest.ragInteractions - previous.ragInteractions) / previous.ragInteractions) * 100)
        : (latest.ragInteractions > 0 ? 100 : 0);
    const costDelta = previous.totalCost > 0
        ? Math.round(((latest.totalCost - previous.totalCost) / previous.totalCost) * 100)
        : (latest.totalCost > 0 ? 100 : 0);

    return {
        updatedAt: new Date().toISOString(),
        windowDays: days,
        daily,
        totals: {
            promptTokens: daily.reduce((sum, item) => sum + item.promptTokens, 0),
            completionTokens: daily.reduce((sum, item) => sum + item.completionTokens, 0),
            totalTokens: daily.reduce((sum, item) => sum + item.totalTokens, 0),
            totalCost: Number(daily.reduce((sum, item) => sum + item.totalCost, 0).toFixed(6)),
            ragInteractions: daily.reduce((sum, item) => sum + item.ragInteractions, 0),
            uniqueActiveUsers: uniqueUsersWindow.size,
        },
        latest,
        deltas: {
            dau: `${dauDelta >= 0 ? '+' : ''}${dauDelta}%`,
            ragInteractions: `${ragDelta >= 0 ? '+' : ''}${ragDelta}%`,
            cost: `${costDelta >= 0 ? '+' : ''}${costDelta}%`,
        },
    };
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
        } catch {
            return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
        }
    }
    return [];
}

function normalizeMaterialStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (['pending', 'processing', 'ready', 'error'].includes(normalized)) {
        return normalized;
    }
    return 'pending';
}

function normalizeMaterialForResponse(material) {
    if (!material || typeof material !== 'object') return material;
    return {
        ...material,
        status: normalizeMaterialStatus(material.status),
    };
}

function parseMaterialIdsQuery(request) {
    const query = request?.query;
    const values = [];

    if (query && typeof query.getAll === 'function') {
        values.push(...query.getAll('materialIds'));
    }

    if (query && typeof query.get === 'function') {
        const single = query.get('materialIds');
        if (single) values.push(single);
    }

    return Array.from(new Set(values
        .flatMap((value) => String(value || '').split(','))
        .map((value) => value.trim())
        .filter(Boolean)));
}

async function getMaterialBySubjectAndId(subjectId, materialId, context) {
    let material = null;

    try {
        material = await getMaterialState(subjectId, materialId);
    } catch (tableErr) {
        context.error(`[StateStore] Error leyendo material ${materialId} para ${subjectId}:`, tableErr);
    }

    if (!material) {
        const legacy = await loadJson(CONTAINER_PROCESSED, `${materialId}.json`);
        if (legacy && legacy.subjectId === subjectId) {
            material = {
                id: legacy.materialId || legacy.id,
                materialId: legacy.materialId || legacy.id,
                subjectId: legacy.subjectId,
                classIds: normalizeStringArray(legacy.classIds || legacy.classId),
                type: legacy.type,
                filename: legacy.filename,
                status: legacy.status,
                blobUrl: legacy.blobUrl,
                uploadedAt: legacy.uploadedAt,
                processedAt: legacy.processedAt,
                errorMessage: legacy.errorMessage,
                chunkCount: legacy.chunkCount,
            };
        }
    }

    return normalizeMaterialForResponse(material);
}

function slugifySubjectId(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function normalizeSubject(subject = {}) {
    return {
        ...subject,
        id: String(subject.id || '').trim(),
        name: String(subject.name || '').trim(),
        group: String(subject.group || '').trim()
    };
}

async function loadSubjects() {
    const saved = await loadJson(CONTAINER_CLASSES, SUBJECTS_BLOB);
    // Solo cargamos los valores por defecto si el archivo no existe (null) o no es un array.
    // Si es un array vacío [], significa que el usuario eliminó todo y debemos respetarlo.
    if (saved === null || !Array.isArray(saved)) return [...DEFAULT_SUBJECTS];
    
    return saved.map(normalizeSubject).filter((s) => s.id && s.name);
}

async function saveSubjects(subjects) {
    await saveJson(CONTAINER_CLASSES, SUBJECTS_BLOB, subjects);
}

function canManageSubjects(principal) {
    return principal?.userRoles?.includes('Director') || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
}

// ── GET /api/subjects ──────────────────────────────────────────────
// Devuelve las materias disponibles (mock para el MVP)
app.http('get-subjects', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'subjects',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        context.log('get-subjects triggered');

        const principal = parseClientPrincipal(request);
        const groups = principal?.groups || [];
        const roles = principal?.userRoles || [];
        const isTeacher = roles.includes('Docente');
        const isDirector = roles.includes('Director');
        const userId = principal?.userId || principal?.oid || request.headers.get('x-mock-role') || 'anonymous';

        const allSubjects = await loadSubjects();

        // Enrollment-based filtering (primary) with group-based fallback (backward compatibility)
        let filteredSubjects = allSubjects;
        
        try {
            const userEnrollments = await getEnrollmentsByUser(userId);

            if (userEnrollments.length > 0) {
                // Primary: enrollment table filtering
                if (isDirector) {
                    filteredSubjects = allSubjects;
                } else if (isTeacher) {
                    const assignedSubjectIds = userEnrollments
                        .filter(e => e.role === 'teacher' && e.status === 'active')
                        .map(e => e.subjectId);
                    filteredSubjects = allSubjects.filter(s => assignedSubjectIds.includes(s.id));
                } else {
                    const enrolledSubjectIds = userEnrollments
                        .filter(e => e.status === 'active')
                        .map(e => e.subjectId);
                    filteredSubjects = allSubjects.filter(s => enrolledSubjectIds.includes(s.id));
                }
            } else if (principal && !isTeacher && !isDirector) {
                // Fallback: group-based filtering for students without enrollment records
                filteredSubjects = allSubjects.filter(s => !s.group || groups.includes(s.group));
            }
        } catch (enrollmentErr) {
            context.warn(`[get-subjects] Enrollment lookup failed, falling back to group filtering: ${enrollmentErr.message}`);
            // Fallback: group-based filtering
            if (principal && !isTeacher && !isDirector) {
                filteredSubjects = allSubjects.filter(s => !s.group || groups.includes(s.group));
            }
        }

        return { 
            status: 200, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(filteredSubjects) 
        };
    }
});

// ── POST|PUT /api/subjects ─────────────────────────────────────────
// Crea o actualiza materias (solo Director)
app.http('save-subject', {
    methods: ['POST', 'PUT'],
    authLevel: 'anonymous',
    route: 'subjects',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const principal = parseClientPrincipal(request);
        if (!canManageSubjects(principal)) {
            context.warn(`Unauthorized attempt to save subject. User: ${principal?.userDetails || 'Anonymous'}. Roles: ${principal?.userRoles?.join(',') || 'None'}`);
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
        }

        try {
            const payload = normalizeSubject(await request.json());
            if (!payload.name) {
                return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'El nombre de la materia es obligatorio' }) };
            }

            const subjects = await loadSubjects();
            const desiredId = payload.id || slugifySubjectId(payload.name);
            if (!desiredId) {
                return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No se pudo generar el ID de la materia' }) };
            }

            if (request.method === 'POST') {
                if (subjects.some((s) => s.id === desiredId)) {
                    return { status: 409, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Ya existe una materia con ese ID' }) };
                }
                const next = [...subjects, { ...payload, id: desiredId }];
                await saveSubjects(next);
                return { status: 201, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: desiredId, name: payload.name }) };
            }

            const idx = subjects.findIndex((s) => s.id === desiredId);
            if (idx < 0) {
                return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Materia no encontrada' }) };
            }

            subjects[idx] = { ...subjects[idx], ...payload };
            await saveSubjects(subjects);
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subjects[idx]) };
        } catch (err) {
            context.error(err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Error guardando materia: ${err.message}` }) };
        }
    }
});

// ── DELETE /api/subjects/{subjectId} ───────────────────────────────
// Elimina materias (solo Director) si no tienen clases asociadas
app.http('delete-subject', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'subjects/{subjectId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const subjectId = request.params.subjectId;
        const cascade = request.query.get('cascade') === 'true';

        const principal = parseClientPrincipal(request);
        if (!canManageSubjects(principal)) {
            context.warn(`Unauthorized attempt to delete subject ${subjectId || 'unknown'}. User: ${principal?.userDetails || 'Anonymous'}. Roles: ${principal?.userRoles?.join(',') || 'None'}`);
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
        }

        if (!subjectId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        try {
            const subjects = await loadSubjects();
            const index = subjects.findIndex(s => s.id === subjectId);
            if (index === -1) {
                return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Materia no encontrada" }) };
            }

            const classes = await listClassesBySubject(subjectId);
            if (classes.length > 0 && !cascade) {
                return {
                    status: 409,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        error: "No se puede eliminar una materia con clases asociadas. Use 'cascade=true' para eliminar todo.",
                        classCount: classes.length
                    })
                };
            }

            if (cascade) {
                context.log(`[CascadeDelete] Iniciando limpieza para materia ${subjectId}...`);

                // 1. Limpiar Pinecone (por subjectId es más eficiente)
                try {
                    await vectorStore.deleteVectorsByFilter({ subjectId: { "$eq": subjectId } });
                    context.log(`[CascadeDelete] Vectores de ${subjectId} eliminados.`);
                } catch (vErr) {
                    context.error(`[CascadeDelete] Error eliminando vectores:`, vErr);
                }

                // 2. Limpiar materiales (blobs y tablas)
                const materials = await listMaterialsBySubject(subjectId);
                for (const material of materials) {
                    try {
                        // Borrar blobs de materiales
                        await deleteBlob(CONTAINER_PROCESSED, `${material.materialId}.json`);
                        // El blob original suele estar en class-materials/{classId}/{materialId}-{filename}
                        if (material.blobUrl && material.classIds?.length > 0) {
                            const primaryClassId = material.classIds[0];
                            const blobName = `${primaryClassId}/${material.materialId}-${material.filename}`;
                            await deleteBlob('class-materials', blobName).catch(() => {});
                        }
                    } catch (mErr) {
                        context.error(`[CascadeDelete] Error borrando archivos de material ${material.materialId}:`, mErr);
                    }
                }
                await deleteMaterialsBySubject(subjectId);

                // 3. Limpiar clases (resúmenes, mapas y tablas)
                for (const cls of classes) {
                    try {
                        await deleteBlob('class-summaries', `${cls.id}.json`).catch(() => {});
                        await deleteBlob('class-maps', `${cls.id}.json`).catch(() => {});
                    } catch (cErr) {
                        context.error(`[CascadeDelete] Error borrando recursos de clase ${cls.id}:`, cErr);
                    }
                }
                await deleteClassesBySubject(subjectId);

                context.log(`[CascadeDelete] Limpieza de ${subjectId} completada.`);
            }

            subjects.splice(index, 1);
            await saveSubjects(subjects);
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, cascade }) };
        } catch (err) {
            context.error(err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Error eliminando materia: ${err.message}` }) };
        }
    }
});

// ── GET /api/classes ───────────────────────────────────────────────
// Lista las clases de un subject, cruzadas con sus materiales
app.http('get-classes', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'classes/{subjectId?}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        context.log('get-classes triggered');
        
        let subjectId = request.params.subjectId || request.query.get('subjectId');
        if (!subjectId || subjectId === 'undefined') return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };

        try {
            let classesConfig = [];
            let materials = [];
            let tableSuccess = false;

            try {
                classesConfig = await listClassesBySubject(subjectId);
                materials = await listMaterialsBySubject(subjectId);
                tableSuccess = true;
                context.log(`[get-classes] Table storage query successful for ${subjectId}`);
            } catch (tableErr) {
                context.error(`[get-classes] Table storage error for ${subjectId}:`, tableErr.message);
                // Si falla la tabla, intentamos fallback a blobs
            }

            // 2. Fallback solo si las tablas fallaron o están vacías Y realmente queremos intentar recuperar legacy
            if (!tableSuccess || (classesConfig.length === 0 && materials.length === 0)) {
                context.log(`[get-classes] Attempting legacy blob fallback for ${subjectId}...`);
                
                // Fallback de Clases
                if (classesConfig.length === 0) {
                    const legacyClasses = await loadJson(CONTAINER_CLASSES, `${subjectId}.json`);
                    if (legacyClasses) {
                        classesConfig = Array.isArray(legacyClasses) ? legacyClasses : [];
                        context.log(`[get-classes] Loaded ${classesConfig.length} legacy classes from blob`);
                    }
                }

                // Fallback de Materiales (SOLO si no hay nada en tablas)
                // PRECAUCIÓN: Esto es lento si hay muchos blobs. Lo limitamos.
                if (materials.length === 0) {
                    const blobNames = await listBlobs(CONTAINER_PROCESSED);
                    const subjectMaterials = [];
                    // Solo escaneamos los primeros 50 para evitar timeouts si el sistema crece
                    const limitedBlobs = blobNames.slice(0, 50); 
                    for (const blob of limitedBlobs) {
                        if (!blob.endsWith('.json')) continue;
                        const mat = await loadJson(CONTAINER_PROCESSED, blob);
                        if (mat && mat.subjectId === subjectId) subjectMaterials.push(mat);
                    }
                    materials = subjectMaterials;
                    if (materials.length > 0) context.log(`[get-classes] Found ${materials.length} materials in legacy blobs`);
                }
            }

            // 3. Cruzar datos
            context.log(`[get-classes] Joining ${classesConfig.length} classes with ${materials.length} materials for subject ${subjectId}`);

            const resultClasses = classesConfig.map(c => {
                if (!c.date) context.warn(`[get-classes] Class ${c.id} ("${c.title}") is missing the date field.`);
                return { 
                    ...c, 
                    materials: [], 
                    summaryReady: c.summaryReady || false,
                    professorIds: c.professorIds || [],
                    studentIds: c.studentIds || []
                };
            });

            // Materiales huérfanos o que pertenecen a múltiples clases
            for (const mat of materials) {
                const targetClasses = normalizeStringArray(mat.classIds || mat.classId);
                const matSafe = {
                    id: mat.materialId || mat.id,
                    type: mat.type,
                    filename: mat.filename,
                    status: mat.status,
                    uploadedAt: mat.uploadedAt || mat.processedAt,
                    blobUrl: mat.blobUrl,
                    classIds: targetClasses,
                    reviewed: mat.reviewed === true,
                    chunkCount: mat.chunkCount,
                };

                context.log(`[get-classes] Processing material ${matSafe.id} ("${matSafe.filename}") - status: ${matSafe.status}, linked classes: ${targetClasses.join(', ')}`);

                for (const cid of targetClasses) {
                    const cls = resultClasses.find(c => c.id === cid);
                    if (cls) {
                        cls.materials.push(matSafe);
                        context.log(`[get-classes]   -> Successfully linked material ${matSafe.id} to class ${cid}`);
                    } else {
                        context.warn(`[get-classes]   -> Warning: Material ${matSafe.id} refers to non-existent class ${cid}`);
                    }
                }
            }

            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resultClasses) };
        } catch (err) {
            context.error(err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    }
});

// ── GET /api/material-status/{materialId} ──────────────────────────
// Devuelve el estado puntual de un material por subjectId + materialId
app.http('get-material-status', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'material-status/{materialId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const materialId = request.params.materialId;
        const subjectId = request.query.get('subjectId');

        if (!materialId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta materialId' }) };
        }

        if (!subjectId || subjectId === 'undefined') {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        try {
            const material = await getMaterialBySubjectAndId(subjectId, materialId, context);

            if (!material) {
                return {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Material no encontrado' }),
                };
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(material),
            };
        } catch (err) {
            context.error(err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error interno' }) };
        }
    },
});

// ── GET /api/material-status?subjectId=...&materialIds=... ─────────
// Consulta estado de múltiples materiales en una sola llamada
app.http('get-material-status-batch', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'material-status',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const subjectId = request.query.get('subjectId');
        const materialIds = parseMaterialIdsQuery(request);

        if (!subjectId || subjectId === 'undefined') {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        if (materialIds.length === 0) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta materialIds' }) };
        }

        if (materialIds.length > 50) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'materialIds excede el máximo permitido (50)' }) };
        }

        try {
            const results = [];

            for (const materialId of materialIds) {
                const material = await getMaterialBySubjectAndId(subjectId, materialId, context);
                if (!material) {
                    results.push({ materialId, found: false, httpStatus: 404 });
                    continue;
                }

                results.push({
                    materialId,
                    found: true,
                    httpStatus: 200,
                    status: normalizeMaterialStatus(material.status),
                    material,
                });
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subjectId, results }),
            };
        } catch (err) {
            context.error(err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error interno' }) };
        }
    },
});

// ── POST /api/classes ──────────────────────────────────────────────
// Crea o actualiza una clase entera (o la lista de clases)
app.http('save-classes', {
    methods: ['POST', 'PUT'],
    authLevel: 'anonymous',
    route: 'classes/{subjectId?}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        
        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Forbidden - Teacher access required" }) };
        }

        context.log('save-classes triggered');

        let subjectId = request.params.subjectId || request.query.get('subjectId');
        if (!subjectId || subjectId === 'undefined') return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };

        try {
            const body = await request.json();
            // Esperamos un array completo de clases para hacer overwrite del state
            const classesToSave = Array.isArray(body) ? body : [body];

            // Si la clase no tiene ID, le generamos uno
            classesToSave.forEach(c => { if (!c.id) c.id = `class-${uuidv4().substring(0, 8)}`; });

            try {
                await replaceClassesForSubject(subjectId, classesToSave);
            } catch (tableErr) {
                context.error(`[StateStore] Error guardando clases en tabla para ${subjectId}:`, tableErr);
            }

            await saveJson(CONTAINER_CLASSES, `${subjectId}.json`, classesToSave);

            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, classes: classesToSave }) };
        } catch (err) {
            context.error(err);
            return { status: 500, body: JSON.stringify({ error: `Error interno guardando clases: ${err.message}` }) };
        }
    }
});

// ── GET /api/class-summary/{classId} ───────────────────────────────
// Devuelve el resumen generado por IA para una clase
app.http('get-class-summary', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'class-summary/{classId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const classId = request.params.classId;
        const CONTAINER_SUMMARIES = 'class-summaries';
        try {
            const summaryData = await loadJson(CONTAINER_SUMMARIES, `${classId}.json`);
            // Retornamos 200 con { summary: null } en lugar de 404 para evitar que el frontend rompa
            if (!summaryData) return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId, summary: null }) };
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summaryData) };
        } catch (err) {
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId, summary: null, error: err.message }) };
        }
    }
});

// ── GET /api/class-map/{classId} ───────────────────────────────────
// Devuelve el código Mermaid del mapa conceptual generado por IA
app.http('get-class-map', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'class-map/{classId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const classId = request.params.classId;
        const CONTAINER_MAPS = 'class-maps';
        try {
            const mapData = await loadJson(CONTAINER_MAPS, `${classId}.json`);
            if (!mapData) return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId, mapCode: null }) };
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mapData) };
        } catch (err) {
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId, mapCode: null, error: err.message }) };
        }
    }
});

// ── POST /api/class-map/{classId} ──────────────────────────────────
// Guarda o actualiza un mapa conceptual
app.http('save-class-map', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'class-map/{classId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Forbidden - Teacher access required" }) };
        }

        const classId = request.params.classId;
        const CONTAINER_MAPS = 'class-maps';
        try {
            const body = await request.json(); // { mapCode: "..." }
            const existingData = await loadJson(CONTAINER_MAPS, `${classId}.json`) || { classId };
            const updatedData = { ...existingData, mapCode: body.mapCode, lastModifiedAt: new Date().toISOString() };
            await saveJson(CONTAINER_MAPS, `${classId}.json`, updatedData);
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedData) };
        } catch (err) {
            return { status: 500, body: JSON.stringify({ error: `Error guardando mapa: ${err.message}` }) };
        }
    }
});

// ── POST /api/class-summary/{classId} ──────────────────────────────
// Guarda o valida un resumen (acción del docente)
app.http('save-class-summary', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'class-summary/{classId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const classId = request.params.classId;
        const CONTAINER_SUMMARIES = 'class-summaries';
        const principal = parseClientPrincipal(request);
        
        const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Forbidden - Teacher access required" }) };
        }
        
        try {
            const body = await request.json(); // { summary: "...", validated: true }
            const existingData = await loadJson(CONTAINER_SUMMARIES, `${classId}.json`) || { classId };
            
            const updatedData = {
                ...existingData,
                summary: body.summary,
                lastModifiedAt: new Date().toISOString(),
                lastModifiedBy: principal?.userDetails || 'docente',
                validated: body.validated || false
            };

            await saveJson(CONTAINER_SUMMARIES, `${classId}.json`, updatedData);

            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedData) };
        } catch (err) {
            return { status: 500, body: JSON.stringify({ error: `Error guardando resumen: ${err.message}` }) };
        }
    }
});

// ── GET /api/director/stats ──────────────────────────────────────
// Devuelve métricas agregadas para el dashboard del director
app.http('get-director-stats', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'director/stats',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
        }

        context.log('get-director-stats triggered');
        const metrics = await computeDirectorMetrics(context, POWERBI_DEFAULT_DAYS);
        const MOCK_STATS = {
            dau: metrics.latest.dau,
            dauDelta: metrics.deltas.dau,
            classesProcessed: 14,
            ragInteractions: metrics.latest.ragInteractions,
            ragDelta: metrics.deltas.ragInteractions,
            adoptionRate: 68,
            subjectAdoption: [
                { name: 'Arq. de Software', rate: 82 },
                { name: 'Diseño de BD', rate: 71 },
                { name: 'Ing. de Software I', rate: 63 },
                { name: 'Sistemas Distribuidos', rate: 44 },
            ],
            earlyAlertSummary: {
                totalStudentsAtRisk: 3,
                highRiskCount: 1,
                mediumRiskCount: 2,
                lowAttendanceCount: 2,
                lowGradeCount: 2,
                attendanceBelow60Count: 1,
                attendance60To75Count: 2,
                attendanceAbove75Count: 0,
            },
            powerBiSource: {
                mode: 'continuous-export-db',
                storage: 'Azure Table Storage',
                table: SESSION_METRICS_TABLE,
                windowDays: metrics.windowDays,
                updatedAt: metrics.updatedAt,
            },
        };
        return { 
            status: 200, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(MOCK_STATS) 
        };
    }
});

// ── GET /api/director/powerbi-metrics ─────────────────────────────
// Exposición de métricas DAU + tokens para Power BI (Issue #75)
app.http('get-director-powerbi-metrics', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'director/powerbi-metrics',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
        }

        const days = request.query.get('days') || POWERBI_DEFAULT_DAYS;
        const metrics = await computeDirectorMetrics(context, days);
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: {
                    mode: 'continuous-export-db',
                    storage: 'Azure Table Storage',
                    table: SESSION_METRICS_TABLE,
                    integrationHint: 'Power BI can connect directly to exported DB metrics via this endpoint or Azure Table connector.',
                },
                pricing: {
                    inputPerMillionTokensUsd: 0.15,
                    outputPerMillionTokensUsd: 0.60,
                    inputPerTokenUsd: 0.00000015,
                    outputPerTokenUsd: 0.0000006,
                },
                summary: {
                    totalPromptTokens: metrics.totals.promptTokens,
                    totalCompletionTokens: metrics.totals.completionTokens,
                    totalTokens: metrics.totals.totalTokens,
                    totalInteractions: metrics.totals.ragInteractions,
                    totalCostUsd: metrics.totals.totalCost,
                    avgCostPerInteractionUsd: Number((metrics.totals.totalCost / Math.max(metrics.totals.ragInteractions, 1)).toFixed(8)),
                },
                updatedAt: metrics.updatedAt,
                windowDays: metrics.windowDays,
                daily: metrics.daily,
            }),
        };
    }
});

// ── DELETE /api/materials/{id} ────────────────────────────────────
// Borra un material (del JSON. Dejar pendiente limpieza en vector store)
app.http('delete-material', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'materials/{materialId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const principal = parseClientPrincipal(request);
        // In direct Function App calls (without SWA proxy), x-ms-client-principal may be absent.
        // For the pilot, allow deletion when principal header is missing.
        const isAuthorized = !principal
            || principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role))
            || process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Forbidden - Teacher access required" }) };
        }

        const materialId = request.params.materialId;
        try {
            // Limpieza en Vector Store
            try {
                await vectorStore.deleteVectorsByFilter({ materialId: { "$eq": materialId } });
                context.log(`[DeleteMaterial] Vectores para ${materialId} eliminados.`);
            } catch (vErr) {
                context.error(`[DeleteMaterial] Error eliminando vectores de ${materialId}:`, vErr);
            }

            try {
                await deleteMaterialStateById(materialId);
            } catch (tableErr) {
                context.error(`[StateStore] Error eliminando material ${materialId} de tablas:`, tableErr);
            }

            await deleteBlob(CONTAINER_PROCESSED, `${materialId}.json`);
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
        } catch (err) {
            context.error(err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `No se pudo borrar el material: ${err.message}` }) };
        }
    }
});

// ── PATCH /api/materials/{materialId} ────────────────────────────────────
// Actualiza metadatos de un material (type, classIds, reviewed)
app.http('update-material', {
    methods: ['PATCH'],
    authLevel: 'anonymous',
    route: 'materials/{materialId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden' }) };
        const principal = parseClientPrincipal(request);
        const isAuthorized = !principal
            || principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role))
            || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
        }

        const materialId = request.params.materialId;
        let body;
        try {
            body = await request.json();
        } catch {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Body JSON inválido' }) };
        }

        const subjectId = body.subjectId;
        if (!subjectId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'subjectId es requerido' }) };
        }

        try {
            const existing = await getMaterialState(subjectId, materialId);
            if (!existing) {
                return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Material no encontrado' }) };
            }

            const updates = {};
            if (body.type) updates.type = body.type;
            if (body.classIds) updates.classIds = body.classIds;
            if (body.filename) updates.filename = body.filename;
            if (typeof body.reviewed === 'boolean') updates.reviewed = body.reviewed;
            if (body.priority === 'primary' || body.priority === 'secondary') updates.priority = body.priority;

            const updated = await upsertMaterialState({
                ...existing,
                materialId: existing.materialId || existing.id,
                subjectId,
                ...updates,
            }, 'Merge');

            context.log(`[UpdateMaterial] ${materialId} updated:`, JSON.stringify(updates));
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, material: updated }) };
        } catch (err) {
            context.error(`[UpdateMaterial] Error updating ${materialId}:`, err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Error al actualizar: ${err.message}` }) };
        }
    }
});

// ── GET /api/materials/{materialId}/text ──────────────────────────────
// Devuelve el texto extraído de un material desde el blob processed/{id}.json
app.http('get-material-text', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'materials/{materialId}/text',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden' }) };

        const materialId = request.params.materialId;
        const subjectId = request.query.get('subjectId');

        try {
            const processed = await loadJson(CONTAINER_PROCESSED, `${materialId}.json`);
            if (!processed) {
                return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '', error: 'No se encontró texto procesado' }) };
            }

            const text = processed.extractedText || processed.text || '';
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, chunkCount: processed.chunks?.length || 0, filename: processed.filename || '' })
            };
        } catch (err) {
            context.error(`[GetMaterialText] Error for ${materialId}:`, err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '', error: err.message }) };
        }
    }
});

// ── PUT /api/materials/{materialId}/text ──────────────────────────────
// Actualiza texto extraído y re-genera embeddings
app.http('update-material-text', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'materials/{materialId}/text',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden' }) };
        const principal = parseClientPrincipal(request);
        const isAuthorized = !principal
            || principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role))
            || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden' }) };
        }

        const materialId = request.params.materialId;
        let body;
        try {
            body = await request.json();
        } catch {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Body JSON inválido' }) };
        }

        const { subjectId, text } = body;
        if (!subjectId || typeof text !== 'string') {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'subjectId y text son requeridos' }) };
        }

        try {
            // 1. Load existing processed blob
            const processed = await loadJson(CONTAINER_PROCESSED, `${materialId}.json`) || {};
            const materialState = await getMaterialState(subjectId, materialId);

            // 2. Delete old vectors
            try {
                await vectorStore.deleteVectorsByFilter({ materialId: { '$eq': materialId } });
                context.log(`[UpdateMaterialText] Deleted old vectors for ${materialId}`);
            } catch (vErr) {
                context.error(`[UpdateMaterialText] Error deleting vectors:`, vErr);
            }

            // 3. Re-chunk and re-embed
            const { chunkText } = await import('../services/parser.js');
            const chunks = chunkText(text);

            const { generateEmbeddingsBatch } = await import('../services/ai.js');
            const chunkTexts = chunks.map(c => c.text);
            const { embeddings } = await generateEmbeddingsBatch(chunkTexts);

            // 4. Upsert to Pinecone
            const classIds = materialState?.classIds || processed.classIds || [];
            const vectors = embeddings.map((embedding, i) => ({
                id: `${materialId}-chunk-${i}`,
                values: embedding,
                metadata: {
                    subjectId,
                    classId: classIds[0] || '',
                    classIds: JSON.stringify(classIds),
                    materialId,
                    materialType: materialState?.type || processed.materialType || 'notes',
                    chunkIndex: i,
                    sourceFilename: materialState?.filename || processed.filename || '',
                    text: chunkTexts[i]?.substring(0, 1000) || '',
                }
            }));

            await vectorStore.upsertVectors(vectors);

            // 5. Update processed blob
            processed.extractedText = text;
            processed.text = text;
            processed.chunks = chunks;
            processed.chunkCount = chunks.length;
            processed.processedAt = new Date().toISOString();
            await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, processed);

            // 6. Update state
            if (materialState) {
                await upsertMaterialState({
                    ...materialState,
                    materialId,
                    subjectId,
                    status: 'ready',
                    chunkCount: chunks.length,
                    processedAt: new Date().toISOString(),
                }, 'Merge');
            }

            context.log(`[UpdateMaterialText] ${materialId}: re-indexed ${chunks.length} chunks.`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, chunkCount: chunks.length })
            };
        } catch (err) {
            context.error(`[UpdateMaterialText] Error for ${materialId}:`, err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
        }
    }
});
