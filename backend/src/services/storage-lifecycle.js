import { BlobServiceClient } from '@azure/storage-blob';

const ARCHIVE_DAYS = 180;
const DELETE_DAYS = 730;
const EXPECTED_PREFIXES = ['class-materials/semester-', 'processed/semester-'];

function getConnectionString() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING environment variable is required');
  }
  return connStr;
}

export async function checkStorageLifecycleCompliance() {
  const connStr = getConnectionString();
  const blobServiceClient = BlobServiceClient.fromConnectionString(connStr);
  const results = [];

  const containerNames = ['class-materials', 'processed'];

  for (const containerName of containerNames) {
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const exists = await containerClient.exists();
    if (!exists) {
      results.push({
        container: containerName,
        compliant: true,
        note: `Container "${containerName}" does not exist — nothing to scan`,
      });
      continue;
    }

    for await (const blob of containerClient.listBlobsFlat({ includeMetadata: false, includeTags: false })) {
      const lastModified = blob.properties.lastModified;
      const accessTier = blob.properties.accessTier || 'Unknown';

      const now = new Date();
      const ageDays = (now.getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24);

      const matchesExpectedPrefix = EXPECTED_PREFIXES.some((p) => blob.name.startsWith(p));

      if (matchesExpectedPrefix) {
        if (ageDays > DELETE_DAYS) {
          results.push({
            container: containerName,
            blob: blob.name,
            compliant: false,
            ageDays: Math.round(ageDays),
            issue: 'Exceeded delete threshold (730d) — blob should have been deleted',
            accessTier,
          });
        } else if (ageDays > ARCHIVE_DAYS && accessTier !== 'Archive') {
          results.push({
            container: containerName,
            blob: blob.name,
            compliant: false,
            ageDays: Math.round(ageDays),
            issue: `Exceeded archive threshold (180d) but tier is "${accessTier}" — should be Archived`,
            accessTier,
          });
        } else {
          results.push({
            container: containerName,
            blob: blob.name,
            compliant: true,
            ageDays: Math.round(ageDays),
            accessTier,
          });
        }
      } else {
        if (ageDays > DELETE_DAYS) {
          results.push({
            container: containerName,
            blob: blob.name,
            compliant: false,
            ageDays: Math.round(ageDays),
            issue: 'Exceeded delete threshold (730d) and does not match expected semester prefix',
            accessTier,
          });
        } else {
          results.push({
            container: containerName,
            blob: blob.name,
            compliant: true,
            ageDays: Math.round(ageDays),
            note: 'Does not match expected semester prefix — may be current data',
            accessTier,
          });
        }
      }
    }
  }

  const compliantCount = results.filter((r) => r.compliant).length;
  const driftCount = results.filter((r) => !r.compliant).length;
  const totalCount = results.length;

  return {
    compliant: driftCount === 0,
    totalBlobs: totalCount,
    compliantBlobs: compliantCount,
    driftBlobs: driftCount,
    details: totalCount > 0 ? results : [{ note: 'No blobs found to scan', compliant: true }],
    scannedAt: new Date().toISOString(),
  };
}
