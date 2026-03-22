import { Pinecone } from '@pinecone-database/pinecone';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const accountKey = process.env.AZURE_STORAGE_ACCESS_KEY;
const pineconeKey = process.env.PINECONE_API_KEY;
const indexName = process.env.PINECONE_INDEX_NAME;
const containerName = 'pinecone-backups';

if (!pineconeKey || !indexName) {
  console.error("Missing Pinecone credentials in environment.");
  process.exit(1);
}

if (!accountName) {
  console.error("Missing AZURE_STORAGE_ACCOUNT_NAME environment variable.");
  process.exit(1);
}

// Parse arguments
let prefix = undefined;
let shouldDelete = process.argv.includes('--delete');

const prefixArgIndex = process.argv.indexOf('--prefix');
if (prefixArgIndex !== -1 && process.argv.length > prefixArgIndex + 1) {
  prefix = process.argv[prefixArgIndex + 1];
}

async function getBlobClient() {
  if (accountKey) {
    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
    return new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      sharedKeyCredential
    );
  } else {
    // Zero-Trust fallback
    return new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      new DefaultAzureCredential()
    );
  }
}

async function main() {
  console.log(`Starting Pinecone Data Export Utility`);
  console.log(`Target Index: ${indexName} | Prefix: ${prefix ? prefix : '(all)'}`);
  console.log(`Mode: ${shouldDelete ? 'Export AND Delete (Flush)' : 'Export Only (Backup)'}`);
  
  const blobServiceClient = await getBlobClient();
  const containerClient = blobServiceClient.getContainerClient(containerName);
  await containerClient.createIfNotExists();
  console.log(`[Storage] Container '${containerName}' is ready.`);

  const pc = new Pinecone({ apiKey: pineconeKey });
  const index = pc.index(indexName);

  let paginationToken;
  let totalExported = 0;
  let totalDeleted = 0;
  
  const allRecords = [];

  console.log(`[Pinecone] Scanning active index...`);
  do {
    const listConfig = prefix ? { prefix, paginationToken } : { paginationToken };
    const listResult = await index.listPaginated(listConfig);
    
    if (listResult.vectors && listResult.vectors.length > 0) {
      const ids = listResult.vectors.map(v => v.id);
      
      // Fetch full vectors including metadata
      console.log(`  -> Fetching payload for ${ids.length} vector IDs...`);
      const fetchResult = await index.fetch(ids);
      
      // Append to memory array
      if (fetchResult.records) {
        const records = Object.values(fetchResult.records);
        allRecords.push(...records);
        totalExported += records.length;
      }

      // If delete flag is passed, purge the batch immediately from Pinecone
      if (shouldDelete) {
        console.log(`  -> Purging ${ids.length} vectors from active index...`);
        await index.deleteMany(ids);
        totalDeleted += ids.length;
      }
    }
    
    paginationToken = listResult.pagination?.next;
  } while (paginationToken);

  if (allRecords.length > 0) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blobName = `export-${indexName}-${timestamp}.json`;
    
    console.log(`[Storage] Uploading ${allRecords.length} records to Blob Storage as ${blobName}...`);
    
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const buffer = Buffer.from(JSON.stringify(allRecords, null, 2), 'utf-8');
    
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: 'application/json' }
    });
    
    console.log(`[Success] Backup secured at: ${blockBlobClient.url}`);
  } else {
    console.log(`[Pinecone] No vectors found matching the prefix criteria.`);
  }

  console.log(`\\nUtility execution finished.`);
  console.log(`Total Exported: ${totalExported}`);
  if (shouldDelete) {
    console.log(`Total Pruned: ${totalDeleted}`);
  }
}

main().catch((err) => {
  console.error("Unhandled error during export:", err);
  process.exit(1);
});
