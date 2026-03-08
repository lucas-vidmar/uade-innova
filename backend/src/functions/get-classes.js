/**
 * get-classes.js — GET /api/classes?subjectId={id}
 * Retorna las clases de una materia con el estado de sus materiales.
 */
import { app } from '@azure/functions';
import { listBlobs, loadJson } from '../services/storage.js';

const CONTAINER_PROCESSED = 'processed';

app.http('get-classes', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'classes',
    handler: async (request, context) => {
        context.log('get-classes triggered');

        const subjectId = request.query.get('subjectId');
        if (!subjectId) {
            return {
                status: 400,
                body: JSON.stringify({ error: 'Parámetro requerido: subjectId' }),
            };
        }

        try {
            // Listar todos los archivos de estado de materiales procesados
            const blobNames = await listBlobs(CONTAINER_PROCESSED);

            // Cargar cada estado y filtrar por subjectId
            const materials = [];
            for (const blobName of blobNames) {
                if (!blobName.endsWith('.json')) continue;
                const material = await loadJson(CONTAINER_PROCESSED, blobName);
                if (material && material.subjectId === subjectId) {
                    materials.push(material);
                }
            }

            // Agrupar materiales por classId para armar el objeto Class
            const classMap = {};
            for (const material of materials) {
                const { classId } = material;
                if (!classMap[classId]) {
                    classMap[classId] = {
                        id: classId,
                        subjectId,
                        title: `Clase ${classId}`,
                        date: null,
                        topics: [],
                        materials: [],
                        summaryReady: false,
                    };
                }
                classMap[classId].materials.push({
                    id: material.materialId,
                    classId: material.classId,
                    subjectId: material.subjectId,
                    type: material.type,
                    filename: material.filename,
                    status: material.status,
                    uploadedAt: material.processedAt,
                    processedAt: material.processedAt,
                    blobUrl: material.blobUrl,
                });
            }

            const classes = Object.values(classMap).sort((a, b) =>
                a.id.localeCompare(b.id)
            );

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(classes),
            };
        } catch (err) {
            context.error('Error en get-classes:', err);
            return {
                status: 500,
                body: JSON.stringify({ error: 'Error obteniendo clases' }),
            };
        }
    },
});
