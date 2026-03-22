import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const containerNames = ['class-materials', 'processed'];

if (!accountName) {
  console.error("Missing AZURE_STORAGE_ACCOUNT_NAME environment variable.");
  process.exit(1);
}

// Parse optional --prefix argument
let prefix = undefined;
const prefixArgIndex = process.argv.indexOf('--prefix');
if (prefixArgIndex !== -1 && process.argv.length > prefixArgIndex + 1) {
  prefix = process.argv[prefixArgIndex + 1];
}

async function main() {
  console.log(`Starting Archived Content Restoration for account: ${accountName}`);
  console.log(`Prefix filter: ${prefix ? prefix : '(none)'}`);
  
  const credential = new DefaultAzureCredential();
  const blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential
  );

  let restoredCount = 0;

  for (const containerName of containerNames) {
    console.log(`\\nScanning container: ${containerName}`);
    const containerClient = blobServiceClient.getContainerClient(containerName);

    try {
      let iterator = containerClient.listBlobsFlat({ prefix });
      
      for await (const blob of iterator) {
        if (blob.properties.accessTier === 'Archive') {
          console.log(`  [ARCHIVED] Found blob: ${blob.name}. Triggering hydration to Hot tier...`);
          const blobClient = containerClient.getBlobClient(blob.name);
          
          // Re-hydrate blob back to Hot tier
          await blobClient.setAccessTier('Hot');
          
          restoredCount++;
          console.log(`  -> Hydration requested for ${blob.name}.`);
          console.log(`     (Note: Standard priority rehydration can take up to 15 hours)`);
        }
      }
    } catch (err) {
      console.error(`Error scanning container ${containerName}: ${err.message}`);
    }
  }

  console.log(`\\nRestoration scan complete! Requested hydration for ${restoredCount} blob(s).`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
