#!/usr/bin/env node
import { listBlobs, downloadFile, deleteBlob } from '../backend/src/services/storage.js';
import { upsertNotificationForSubject } from '../backend/src/services/notification-store.js';

const CONTAINER = process.env.AZURE_STORAGE_CONTAINER_MATERIALS || 'class-materials';
const PREFIX = 'dead-letter/notifications/';

const args = process.argv.slice(2);
const subjectFilter = args.includes('--subject') ? args[args.indexOf('--subject') + 1] : null;
const dryRun = args.includes('--dry-run');

async function main() {
  const blobs = await listBlobs(CONTAINER, PREFIX);
  const subjectPrefix = subjectFilter ? `${PREFIX}${subjectFilter}/` : PREFIX;
  const targetBlobs = blobs.filter((name) => name.startsWith(subjectPrefix));

  if (targetBlobs.length === 0) {
    console.log(`No dead-letter blobs found under ${subjectPrefix}`);
    return;
  }

  console.log(`Found ${targetBlobs.length} dead-letter blob(s) to replay${dryRun ? ' (DRY RUN)' : ''}`);

  let replayed = 0;
  let failed = 0;

  for (const blobName of targetBlobs) {
    try {
      const buffer = await downloadFile(CONTAINER, blobName);
      const { originalPayload, _dlMeta } = JSON.parse(buffer.toString('utf-8'));

      if (!originalPayload) {
        console.warn(`[SKIP] ${blobName}: missing originalPayload`);
        failed += 1;
        continue;
      }

      const subjectId = originalPayload.subjectId;
      if (!subjectId) {
        console.warn(`[SKIP] ${blobName}: notification has no subjectId`);
        failed += 1;
        continue;
      }

      if (dryRun) {
        console.log(`[DRY-RUN] Would replay ${blobName} → subject=${subjectId} notification=${originalPayload.id} (failedAt=${_dlMeta?.failedAt})`);
        replayed += 1;
        continue;
      }

      const { success } = await upsertNotificationForSubject(subjectId, originalPayload);
      if (success) {
        await deleteBlob(CONTAINER, blobName);
        console.log(`[OK] Replayed and deleted ${blobName} → notification=${originalPayload.id} (was dead-lettered at ${_dlMeta?.failedAt})`);
        replayed += 1;
      } else {
        console.error(`[FAIL] ${blobName}: upsert failed after replay`);
        failed += 1;
      }
    } catch (err) {
      console.error(`[ERROR] ${blobName}: ${err.message}`);
      failed += 1;
    }
  }

  console.log(`\nReplay complete: ${replayed} replayed, ${failed} failed${dryRun ? ' (dry run)' : ''}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
