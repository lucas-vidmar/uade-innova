/**
 * process-material.js — Storage Blob Trigger
 * Se dispara automáticamente al subir archivos a 'class-materials'.
 */
import { app } from '@azure/functions';
import { runPipeline } from '../services/pipeline.js';

const CONTAINER_MATERIALS = process.env.AZURE_STORAGE_CONTAINER_MATERIALS || 'class-materials';

app.storageBlob('process-material', {
    path: `${CONTAINER_MATERIALS}/{classId}/{blobName}`,
    connection: 'AzureWebJobsStorage',
    handler: async (blob, context) => {
        const blobPath = context.triggerMetadata.blobTrigger;
        context.log(`[BlobTrigger] Procesando: ${blobPath}`);

        // 1. Extraer metadatos subidos por ingest-material.js
        // Azure Functions v4 expone metadatos en triggerMetadata
        const metadata = context.triggerMetadata.metadata || {};
        
        const params = {
            fileBuffer: blob,
            fileContentType: context.triggerMetadata.contentType,
            fileName: metadata.filename || context.triggerMetadata.name,
            classIds: metadata.classids ? metadata.classids.split(',') : [context.bindingData.classId],
            subjectId: metadata.subjectid || 'unknown',
            materialType: metadata.materialtype || 'notes',
            materialId: metadata.materialid || 'unknown',
            blobUrl: context.triggerMetadata.uri
        };

        if (params.materialId === 'unknown') {
            context.warn(`[BlobTrigger] Advertencia: materialId no encontrado para ${blobPath}. Omitiendo pipeline.`);
            return;
        }

        // 2. Ejecutar pipeline
        await runPipeline(params, context);
    }
});
