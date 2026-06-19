import { BlobServiceClient } from '@azure/storage-blob';

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!connectionString) {
  console.error('AZURE_STORAGE_CONNECTION_STRING is required');
  process.exit(1);
}

const policy = {
  softDeleteDays: 7,
  rules: [
    {
      name: 'DeleteArchiveAfter2Years',
      enabled: true,
      action: 'delete',
      retentionDays: 730,
      prefixes: ['class-materials/', 'processed/'],
    },
    {
      name: 'ArchiveOldSemesterMaterials',
      enabled: true,
      action: 'tierToArchive',
      retentionDays: 180,
      prefixes: ['class-materials/semester-', 'processed/semester-'],
    },
  ],
};

async function main() {
  const blobService = BlobServiceClient.fromConnectionString(connectionString);
  const containerName = process.env.AZURE_STORAGE_CONTAINER_COMPLIANCE || 'compliance';
  const containerClient = blobService.getContainerClient(containerName);

  await containerClient.createIfNotExists({ access: 'container' });

  const blobName = 'retention-policy.json';
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  const content = JSON.stringify(policy, null, 2);
  await blockBlobClient.upload(content, content.length, {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });

  console.log(`Uploaded ${blobName} to container ${containerName}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
