/**
 * process-material.js — Storage Blob Trigger
 * Se dispara automáticamente al subir archivos a 'class-materials'.
 */
import { app } from '@azure/functions';
import { withCorrelationTimer } from '../middleware/with-correlation.js';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { runPipeline } from '../services/pipeline.js';
import { saveJson } from '../services/storage.js';
import { upsertMaterialState } from '../services/state-store.js';
import { generateCorrelationId, resolveTraceContext } from '../services/correlation.js';
import { CONFIG } from '../services/config.js';

const CONTAINER_MATERIALS = CONFIG.containers.materials;
const CONTAINER_PROCESSED = 'processed';

let blobServiceClient = null;

function getBlobServiceClient() {
    if (blobServiceClient) return blobServiceClient;

    const connectionString = process.env.AzureWebJobsStorage;
    if (connectionString) {
        blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        return blobServiceClient;
    }

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCESS_KEY;
    if (!accountName || !accountKey) return null;

    const credential = new StorageSharedKeyCredential(accountName, accountKey);
    blobServiceClient = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential);
    return blobServiceClient;
}

function extractMaterialIdFromBlobName(blobName) {
    if (!blobName) return null;
    const match = String(blobName).match(/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-/);
    return match?.[1] || null;
}

function deriveFilename(metadataFilename, blobName) {
    if (metadataFilename) return metadataFilename;
    if (!blobName) return 'unknown-file';
    const maybeId = extractMaterialIdFromBlobName(blobName);
    if (maybeId && blobName.startsWith(`${maybeId}-`)) {
        return blobName.slice(maybeId.length + 1);
    }
    return blobName;
}

async function loadBlobMetadata(blobPath) {
    const client = getBlobServiceClient();
    if (!client || !blobPath) return {};

    try {
        const containerClient = client.getContainerClient(CONTAINER_MATERIALS);
        const blobClient = containerClient.getBlobClient(blobPath);
        const props = await blobClient.getProperties();
        return props.metadata || {};
    } catch {
        return {};
    }
}

async function persistProcessingError(params, context, message) {
    const errorState = {
        materialId: params.materialId,
        classIds: params.classIds,
        subjectId: params.subjectId,
        type: params.materialType,
        filename: params.fileName,
        status: 'error',
        blobUrl: params.blobUrl,
        errorMessage: message,
        error: message,
        uploadedAt: new Date().toISOString(),
        processedAt: new Date().toISOString(),
    };

    try {
        if (params.subjectId && params.materialId) {
            await upsertMaterialState(errorState);
        }
    } catch (stateErr) {
        context.error('[BlobTrigger] No se pudo persistir estado error en tabla:', stateErr);
    }

    try {
        if (params.materialId) {
            await saveJson(CONTAINER_PROCESSED, `${params.materialId}.json`, errorState);
        }
    } catch (blobErr) {
        context.error('[BlobTrigger] No se pudo persistir estado error en blob:', blobErr);
    }
}

app.storageBlob('process-material', {
    path: `${CONTAINER_MATERIALS}/{subjectId}/{blobName}`,
    connection: 'AzureWebJobsStorage',
    handler: withCorrelationTimer(async (blob, context) => {
        const blobPath = context.triggerMetadata.blobTrigger;
        context.log(`[BlobTrigger] Procesando: ${blobPath}`);

        const pathFromTrigger = context.triggerMetadata?.name;
        const subjectIdFromPath = context.bindingData?.subjectId;
        const rawBlobName = context.bindingData?.blobName || '';
        const fullBlobPath = pathFromTrigger || (subjectIdFromPath && rawBlobName ? `${subjectIdFromPath}/${rawBlobName}` : '');

        // 1. Extraer metadatos subidos por ingest-material.js
        // En algunos entornos el trigger no incluye metadata; hacemos fallback a getProperties().metadata.
        const triggerMetadata = context.triggerMetadata?.metadata || {};
        const blobMetadata = await loadBlobMetadata(fullBlobPath);
        const metadata = {
            ...blobMetadata,
            ...triggerMetadata,
        };

        const materialId = metadata.materialid || extractMaterialIdFromBlobName(rawBlobName) || 'unknown';
        const subjectId = metadata.subjectid || subjectIdFromPath || 'unknown';
        let classIds = [];
        if (metadata.classids) {
            try {
                classIds = JSON.parse(metadata.classids);
                if (!Array.isArray(classIds)) classIds = [classIds];
            } catch (e) {
                classIds = metadata.classids.split(',').map(id => id.trim()).filter(Boolean);
            }
        } else if (subjectIdFromPath) {
            // we no longer have classId in the path, so this fallback is less useful, but kept for compatibility
            classIds = [subjectIdFromPath]; // actually this might be wrong, it used to be classId
        }
        const fileName = deriveFilename(metadata.filename, rawBlobName || context.triggerMetadata?.name);
        const materialPriority = metadata.materialpriority || null;

        const traceContext = resolveTraceContext({ headers: { get: () => null } });
        const params = {
            fileBuffer: blob,
            fileContentType: context.triggerMetadata.contentType,
            fileName,
            classIds,
            subjectId,
            materialType: metadata.materialtype || 'notes',
            materialId,
            materialPriority,
            userId: metadata.userid || 'anonymous',
            correlationId: metadata.correlationid || generateCorrelationId(),
            traceContext,
            blobUrl: context.triggerMetadata.uri || (fullBlobPath ? `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/${CONTAINER_MATERIALS}/${fullBlobPath}` : ''),
        };

        context.log(`[Trace] Correlation-ID: ${params.correlationId}`);

        if (params.materialId === 'unknown' || params.subjectId === 'unknown') {
            const reason = `No se pudieron resolver metadatos críticos para ${blobPath}. materialId=${params.materialId}, subjectId=${params.subjectId}`;
            context.error(`[BlobTrigger] ${reason}`);
            await persistProcessingError(params, context, reason);
            return;
        }

        // 2. Ejecutar pipeline
        await runPipeline(params, context);
    })
});
