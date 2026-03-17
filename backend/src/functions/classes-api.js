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
