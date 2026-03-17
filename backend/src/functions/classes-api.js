import { app } from '@azure/functions';
import { loadJson, saveJson, listBlobs, deleteBlob } from '../services/storage.js';
import { v4 as uuidv4 } from 'uuid';
import { parseClientPrincipal } from '../services/auth-utils.js';

const CONTAINER_CLASSES = process.env.AZURE_STORAGE_CONTAINER_CLASSES || 'classes-config';
const CONTAINER_PROCESSED = 'processed';

// ── GET /api/subjects ──────────────────────────────────────────────
// Devuelve las materias disponibles (mock para el MVP)
app.http('get-subjects', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'subjects',
    handler: async (request, context) => {
        context.log('get-subjects triggered');

        const principal = parseClientPrincipal(request);
        const groups = principal?.groups || [];
        const isTeacher = groups.includes('Docentes-Pilot');

        const ALL_SUBJECTS = [
            { id: 'arq-software-2026', name: 'Arquitectura de Software', group: 'GRP-ARQ-SOFT-2026' },
            { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas', group: 'GRP-DIS-SIST-2026' }
        ];

        // Filtering logic:
        // 1. Teachers see all subjects in the pilot.
        // 2. Students see only subjects whose 'group' they belong to.
        // 3. Local dev (no principal) sees everything for convenience.
        
        let filteredSubjects = ALL_SUBJECTS;
        
        if (principal && !isTeacher) {
            filteredSubjects = ALL_SUBJECTS.filter(s => groups.includes(s.group));
        }

        return { 
            status: 200, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(filteredSubjects.map(({id, name}) => ({id, name}))) 
        };
    }
});

// ── GET /api/classes ───────────────────────────────────────────────
// Lista las clases de un subject, cruzadas con sus materiales
app.http('get-classes', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'classes',
    handler: async (request, context) => {
        context.log('get-classes triggered');
        const subjectId = request.query.get('subjectId');
        if (!subjectId || subjectId === 'undefined') return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };

        try {
            // 1. Cargar config manual de clases
            let classesConfig = await loadJson(CONTAINER_CLASSES, `${subjectId}.json`);
            if (!Array.isArray(classesConfig)) {
                classesConfig = [];
            }

            // 2. Cargar materiales y asociarlos a múltilples clases
            const blobNames = await listBlobs(CONTAINER_PROCESSED);
            const materials = [];
            for (const blob of blobNames) {
                if (!blob.endsWith('.json')) continue;
                const mat = await loadJson(CONTAINER_PROCESSED, blob);
                if (mat && mat.subjectId === subjectId) materials.push(mat);
            }

            // 3. Cruzar datos
            const resultClasses = classesConfig.map(c => ({ ...c, materials: [], summaryReady: c.summaryReady || false }));

            // Materiales huérfanos o que pertenecen a múltiples clases
            for (const mat of materials) {
                const targetClasses = Array.isArray(mat.classIds) ? mat.classIds : (mat.classId ? [mat.classId] : []);
                const matSafe = {
                    id: mat.materialId,
                    type: mat.type,
                    filename: mat.filename,
                    status: mat.status,
                    uploadedAt: mat.processedAt,
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

// ── POST /api/classes ──────────────────────────────────────────────
// Crea o actualiza una clase entera (o la lista de clases)
app.http('save-classes', {
    methods: ['POST', 'PUT'],
    authLevel: 'anonymous',
    route: 'classes',
    handler: async (request, context) => {
        context.log('save-classes triggered');
        const subjectId = request.query.get('subjectId');
        if (!subjectId || subjectId === 'undefined') return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };

        try {
            const body = await request.json();
            // Esperamos un array completo de clases para hacer overwrite del state
            const classesToSave = Array.isArray(body) ? body : [body];

            // Si la clase no tiene ID, le generamos uno
            classesToSave.forEach(c => { if (!c.id) c.id = `class-${uuidv4().substring(0, 8)}`; });

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

// ── POST /api/class-summary/{classId} ──────────────────────────────
// Guarda o valida un resumen (acción del docente)
app.http('save-class-summary', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'class-summary/{classId}',
    handler: async (request, context) => {
        const classId = request.params.classId;
        const CONTAINER_SUMMARIES = 'class-summaries';
        const principal = parseClientPrincipal(request);
        
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
// Borra un material (del JSON. Dejar huérfano en pinecone por ahora o borrar metadata)
app.http('delete-material', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'materials/{materialId}',
    handler: async (request, context) => {
        const materialId = request.params.materialId;
        try {
            await deleteBlob(CONTAINER_PROCESSED, `${materialId}.json`);
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
        } catch (err) {
            context.error(err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `No se pudo borrar el material: ${err.message}` }) };
        }
    }
});
