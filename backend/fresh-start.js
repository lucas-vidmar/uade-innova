import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TableClient } from '@azure/data-tables';
import { BlobServiceClient } from '@azure/storage-blob';

// Setup clients
const pineconeHost = process.env.PINECONE_HOST;
const pineconeApiKey = process.env.PINECONE_API_KEY;
const storageConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || `DefaultEndpointsProtocol=https;AccountName=${process.env.AZURE_STORAGE_ACCOUNT_NAME};AccountKey=${process.env.AZURE_STORAGE_ACCESS_KEY};EndpointSuffix=core.windows.net`;
const containerName = process.env.AZURE_STORAGE_CONTAINER_MATERIALS || 'class-materials';

async function clearPinecone() {
    console.log('--- Cleaning Pinecone ---');
    try {
        const response = await fetch(`${pineconeHost}/vectors/delete`, {
            method: 'POST',
            headers: {
                'Api-Key': pineconeApiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ deleteAll: true })
        });
        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Failed to clear Pinecone: ${response.status} ${body}`);
        }
        console.log('✅ Pinecone index cleared successfully.');
    } catch (err) {
        console.error('❌ Error clearing Pinecone:', err.message);
    }
}

async function clearTable(tableName) {
    console.log(`--- Cleaning Table: ${tableName} ---`);
    try {
        const tableClient = TableClient.fromConnectionString(storageConnectionString, tableName);
        
        let entityCount = 0;
        const entities = tableClient.listEntities();
        for await (const entity of entities) {
            await tableClient.deleteEntity(entity.partitionKey, entity.rowKey);
            entityCount++;
        }
        console.log(`✅ Table ${tableName} cleared. Deleted ${entityCount} entities.`);
    } catch (err) {
        console.error(`❌ Error clearing Table ${tableName}:`, err.message);
    }
}

async function clearBlobs() {
    console.log(`--- Cleaning Blobs in Container: ${containerName} ---`);
    try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(storageConnectionString);
        const containerClient = blobServiceClient.getContainerClient(containerName);
        
        let blobCount = 0;
        for await (const blob of containerClient.listBlobsFlat()) {
            await containerClient.deleteBlob(blob.name);
            blobCount++;
        }
        console.log(`✅ Container ${containerName} cleared. Deleted ${blobCount} blobs.`);
    } catch (err) {
        console.error(`❌ Error clearing Blobs in ${containerName}:`, err.message);
    }
}

async function main() {
    console.log('🚀 Starting Fresh Start script...');
    
    await clearPinecone();
    await clearTable(process.env.AZURE_TABLE_CLASSES || 'classes');
    await clearTable(process.env.AZURE_TABLE_MATERIALS || 'materials');
    await clearBlobs();
    
    console.log('🎉 Fresh start complete.');
}

main().catch(console.error);
