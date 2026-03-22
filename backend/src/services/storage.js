/**
 * services/storage.js — Cliente Azure Blob Storage
 * Gestiona archivos de clase y estado del pipeline.
 */
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { TableClient, AzureNamedKeyCredential } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';

let _client = null;

function getClient() {
    if (!_client) {
        const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
        const accountKey = process.env.AZURE_STORAGE_ACCESS_KEY;
        
        if (!accountName) {
            throw new Error('AZURE_STORAGE_ACCOUNT_NAME is not defined in environment variables.');
        }

        if (accountKey) {
            // Plan B: Use Storage Access Key (if RBAC/Managed Identity is not yet configured)
            const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
            _client = new BlobServiceClient(
                `https://${accountName}.blob.core.windows.net`,
                sharedKeyCredential
            );
            console.log('[Storage] Authenticated using Access Key');
        } else {
            // Plan A (Zero-Trust): Use Managed Identity / DefaultAzureCredential
            _client = new BlobServiceClient(
                `https://${accountName}.blob.core.windows.net`,
                new DefaultAzureCredential()
            );
            console.log('[Storage] Authenticated using DefaultAzureCredential');
        }
    }
    return _client;
}

/**
 * Sube un archivo al Blob Storage.
 * @param {string} containerName
 * @param {string} blobName - ruta dentro del container (ej: "class-01/materialId.pdf")
 * @param {Buffer} buffer
 * @param {string} contentType - MIME type
 * @param {object} metadata - metadatos del blob (opcional)
 * @returns {Promise<string>} URL del blob
 */
export async function uploadFile(containerName, blobName, buffer, contentType, metadata = {}) {
    const client = getClient();
    const containerClient = client.getContainerClient(containerName);

    // Aseguramos que el contenedor exista antes de guardar
    await containerClient.createIfNotExists();

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Normalizar metadatos a lowercase y strings ASCII para evitar InvalidHeaderValue
    const normalizedMetadata = {};
    for (const [key, value] of Object.entries(metadata)) {
        // Azure metadatos solo permiten caracteres ASCII
        const asciiValue = String(value).replace(/[^\x00-\x7F]/g, '');
        normalizedMetadata[key.toLowerCase()] = asciiValue;
    }

    await blockBlobClient.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: contentType },
        metadata: normalizedMetadata
    });

    return blockBlobClient.url;
}

/**
 * Descarga un archivo del Blob Storage.
 * @param {string} containerName
 * @param {string} blobName
 * @returns {Promise<Buffer>}
 */
export async function downloadFile(containerName, blobName) {
    const client = getClient();
    const containerClient = client.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const response = await blockBlobClient.download(0);
    const chunks = [];
    for await (const chunk of response.readableStreamBody) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

/**
 * Guarda un objeto JSON como blob.
 * @param {string} containerName
 * @param {string} blobName
 * @param {object} data
 * @returns {Promise<void>}
 */
export async function saveJson(containerName, blobName, data) {
    const buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
    await uploadFile(containerName, blobName, buffer, 'application/json');
}

/**
 * Carga un objeto JSON desde un blob.
 * @param {string} containerName
 * @param {string} blobName
 * @returns {Promise<object|null>}
 */
export async function loadJson(containerName, blobName) {
    try {
        const buffer = await downloadFile(containerName, blobName);
        return JSON.parse(buffer.toString('utf-8'));
    } catch {
        return null;
    }
}

/**
 * Lista blobs en un container con prefijo opcional.
 * @param {string} containerName
 * @param {string} prefix
 * @returns {Promise<string[]>} nombres de los blobs
 */
export async function listBlobs(containerName, prefix = '') {
    const client = getClient();
    const containerClient = client.getContainerClient(containerName);
    
    // Si el contenedor no existe, devolvemos lista vacía en lugar de fallar
    const exists = await containerClient.exists();
    if (!exists) return [];

    const names = [];
    try {
        for await (const blob of containerClient.listBlobsFlat({ prefix })) {
            names.push(blob.name);
        }
    } catch (err) {
        console.warn(`[Storage] Error listando blobs en ${containerName}:`, err.message);
        return [];
    }
    return names;
}

/**
 * Elimina un blob del contenedor
 */
export async function deleteBlob(containerName, blobName) {
    const client = getClient();
    const containerClient = client.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.deleteIfExists();
}

// ─── Table Storage Client ──────────────────────────────────────────

function getTableClient(tableName) {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCESS_KEY;
    
    if (!accountName) {
        throw new Error('AZURE_STORAGE_ACCOUNT_NAME is not defined in environment variables.');
    }

    if (accountKey) {
        return new TableClient(
            `https://${accountName}.table.core.windows.net`, 
            tableName, 
            new AzureNamedKeyCredential(accountName, accountKey)
        );
    } else {
        return new TableClient(
            `https://${accountName}.table.core.windows.net`, 
            tableName, 
            new DefaultAzureCredential()
        );
    }
}

/**
 * Guarda una entidad (métrica o log) permanentemente en el repositorio Table Storage.
 * @param {string} tableName
 * @param {object} entity - Requiere partitionKey y rowKey nativos.
 */
export async function saveMetricsToTable(tableName, entity) {
    try {
        const tableClient = getTableClient(tableName);
        await tableClient.createTable(); // Si ya existe, no hace nada peligroso 
        await tableClient.createEntity(entity);
    } catch (err) {
        console.error(`[Storage] Error persistiendo métricas a tabla ${tableName}:`, err.message);
    }
}
