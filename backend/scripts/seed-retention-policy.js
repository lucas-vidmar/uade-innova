// SEED SCRIPT — Solo para desarrollo/piloto. No ejecutar en producción.

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
      filter: {
        containerPattern: 'archive-*',
        blobAgeDays: 730,
      },
    },
  ],
};

const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
const containerClient = blobServiceClient.getContainerClient('compliance');

async function seed() {
  await containerClient.createIfNotExists();
  await containerClient.uploadBlockBlob('retention-policy.json', JSON.stringify(policy, null, 2), 'retention-policy.json', {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });
  console.log('Retention policy seeded successfully.');
}

seed().catch(error => {
  console.error('Failed to seed retention policy:', error);
  process.exit(1);
});
