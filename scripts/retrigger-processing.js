/**
 * retrigger-processing.js
 * Utility script to re-trigger the process-material function for blobs 
 * that are stuck in 'processing' by touching their metadata.
 */
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const STORAGE_ACCOUNT = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const STORAGE_KEY = process.env.AZURE_STORAGE_ACCESS_KEY;
const CONTAINER = 'class-materials';

if (!STORAGE_ACCOUNT || !STORAGE_KEY) {
    console.error('❌ Error: Falta AZURE_STORAGE_ACCOUNT_NAME o AZURE_STORAGE_ACCESS_KEY en .env.local');
    process.exit(1);
}

async function main() {
    const credential = new StorageSharedKeyCredential(STORAGE_ACCOUNT, STORAGE_KEY);
    const blobServiceClient = new BlobServiceClient(`https://${STORAGE_ACCOUNT}.blob.core.windows.net`, credential);
    const containerClient = blobServiceClient.getContainerClient(CONTAINER);

    console.log(`🔍 Buscando blobs en contenedor '${CONTAINER}'...`);
    
    let count = 0;
    for await (const blob of containerClient.listBlobsFlat({ includeMetadata: true })) {
        // Solo "pockear" si están en una subcarpeta (lo que indica que son los nuevos)
        if (blob.name.includes('/')) {
            console.log(`👉 Poking blob: ${blob.name}`);
            const blobClient = containerClient.getBlobClient(blob.name);
            
            // Actualizamos la fecha de "retriggered" en metadata para forzar el trigger
            const metadata = {
                ...blob.metadata,
                retriggeredAt: new Date().toISOString()
            };
            
            await blobClient.setMetadata(metadata);
            count++;
        }
    }

    console.log(`✅ Finalizado. Se re-activaron ${count} materiales.`);
}

main().catch(err => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});
