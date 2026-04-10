import { app } from '@azure/functions';
import { loadJson, saveJson, listBlobs, deleteBlob } from '../services/storage.js';
import { v4 as uuidv4 } from 'uuid';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { listClassesBySubject, listMaterialsBySubject, replaceClassesForSubject, deleteMaterialStateById, getMaterialState } from '../services/state-store.js';

const CONTAINER_CLASSES = process.env.AZURE_STORAGE_CONTAINER_CLASSES || 'classes-config';
const CONTAINER_PROCESSED = 'processed';
const SUBJECTS_BLOB = 'subjects.json';

const DEFAULT_SUBJECTS = [
    { id: 'arq-software-2026', name: 'Arquitectura de Software', group: 'GRP-ARQ-SOFT-2026' },
    { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas', group: 'GRP-DIS-SIST-2026' }
];

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

function slugifySubjectId(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function normalizeSubject(subject = {}) {
    const id = String(subject.id || '').trim();
    const name = String(subject.name || '').trim();
    const group = String(subject.group || '').trim();
    return { id, name, group };
}

async function loadSubjects() {
    const saved = await loadJson(CONTAINER_CLASSES, SUBJECTS_BLOB);
    if (!Array.isArray(saved) || saved.length === 0) return [...DEFAULT_SUBJECTS];
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

        const allSubjects = await loadSubjects();

        // Filtering logic:
        // 1. Teachers see all subjects in the pilot.
        // 2. Students see only subjects whose 'group' they belong to.
        // 3. Local dev (no principal) sees everything for convenience.
        
        let filteredSubjects = allSubjects;
        
        if (principal && !isTeacher && !isDirector) {
            filteredSubjects = allSubjects.filter(s => !s.group || groups.includes(s.group));
        }

        return { 
            status: 200, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(filteredSubjects.map(({id, name}) => ({id, name}))) 
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

            subjects[idx] = { ...subjects[idx], name: payload.name, group: payload.group || subjects[idx].group || '' };
            await saveSubjects(subjects);
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: desiredId, name: subjects[idx].name }) };
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

        const principal = parseClientPrincipal(request);
        if (!canManageSubjects(principal)) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
        }

        const subjectId = request.params.subjectId;
        if (!subjectId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        try {
            const classes = await listClassesBySubject(subjectId);
            if (Array.isArray(classes) && classes.length > 0) {
                return { status: 409, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No se puede eliminar una materia con clases asociadas' }) };
            }

            const subjects = await loadSubjects();
            const next = subjects.filter((s) => s.id !== subjectId);
            if (next.length === subjects.length) {
                return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Materia no encontrada' }) };
            }

            await saveSubjects(next);
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
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
    route: 'classes',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        context.log('get-classes triggered');
        const subjectId = request.query.get('subjectId');
        if (!subjectId || subjectId === 'undefined') return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };

        try {
            // 1. Leer desde Table Storage (source of truth)
            let classesConfig = [];
            let materials = [];

            try {
                classesConfig = await listClassesBySubject(subjectId);
                materials = await listMaterialsBySubject(subjectId);
            } catch (tableErr) {
                context.error(`[StateStore] Error leyendo classes/materials para ${subjectId}:`, tableErr);
            }

            // 2. Fallback temporal al estado legacy en blobs si no hay datos en tablas
            if (!Array.isArray(classesConfig) || classesConfig.length === 0) {
                const legacyClasses = await loadJson(CONTAINER_CLASSES, `${subjectId}.json`);
                classesConfig = Array.isArray(legacyClasses) ? legacyClasses : [];
            }

            if (!Array.isArray(materials) || materials.length === 0) {
                const blobNames = await listBlobs(CONTAINER_PROCESSED);
                materials = [];
                for (const blob of blobNames) {
                    if (!blob.endsWith('.json')) continue;
                    const mat = await loadJson(CONTAINER_PROCESSED, blob);
                    if (mat && mat.subjectId === subjectId) materials.push(mat);
                }
            }

            // 3. Cruzar datos
            const resultClasses = classesConfig.map(c => ({ 
                ...c, 
                materials: [], 
                summaryReady: c.summaryReady || false,
                professorIds: c.professorIds || [],
                studentIds: c.studentIds || []
            }));

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
                    classIds: targetClasses
                };

                for (const cid of targetClasses) {
                    const cls = resultClasses.find(c => c.id === cid);
                    if (cls) cls.materials.push(matSafe);
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

// ── POST /api/classes ──────────────────────────────────────────────
// Crea o actualiza una clase entera (o la lista de clases)
app.http('save-classes', {
    methods: ['POST', 'PUT'],
    authLevel: 'anonymous',
    route: 'classes',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        context.log('save-classes triggered');

        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Forbidden - Teacher access required" }) };
        }

        const subjectId = request.query.get('subjectId');
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
        context.log('get-director-stats triggered');
        const MOCK_STATS = {
            dau: 52,
            dauDelta: '+8%',
            classesProcessed: 14,
            ragInteractions: 734,
            ragDelta: '+23%',
            adoptionRate: 68,
            subjectAdoption: [
                { name: 'Arq. de Software', rate: 82 },
                { name: 'Diseño de BD', rate: 71 },
                { name: 'Ing. de Software I', rate: 63 },
                { name: 'Sistemas Distribuidos', rate: 44 },
            ],
        };
        return { 
            status: 200, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(MOCK_STATS) 
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
