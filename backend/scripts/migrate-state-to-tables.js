import { listBlobs, loadJson } from '../src/services/storage.js';
import { replaceClassesForSubject, upsertMaterialState } from '../src/services/state-store.js';

const CONTAINER_CLASSES = process.env.AZURE_STORAGE_CONTAINER_CLASSES || 'classes-config';
const CONTAINER_PROCESSED = 'processed';

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function toMaterialState(material) {
  const materialId = material.materialId || material.id;
  const classIds = normalizeStringArray(material.classIds || material.classId);

  return {
    materialId,
    subjectId: material.subjectId,
    classIds,
    type: material.type,
    filename: material.filename,
    status: material.status || 'ready',
    blobUrl: material.blobUrl,
    uploadedAt: material.uploadedAt || material.processedAt || new Date().toISOString(),
    processedAt: material.processedAt || new Date().toISOString(),
    chunkCount: typeof material.chunkCount === 'number' ? material.chunkCount : undefined,
    errorMessage: material.errorMessage || material.error,
  };
}

async function migrateClasses() {
  const classFiles = await listBlobs(CONTAINER_CLASSES);
  let subjectsMigrated = 0;
  let classRowsMigrated = 0;

  for (const blobName of classFiles) {
    if (!blobName.endsWith('.json')) continue;
    const subjectId = blobName.replace(/\.json$/, '');
    if (!subjectId) continue;

    const classes = await loadJson(CONTAINER_CLASSES, blobName);
    if (!Array.isArray(classes)) continue;

    await replaceClassesForSubject(subjectId, classes);
    subjectsMigrated += 1;
    classRowsMigrated += classes.length;
  }

  return { subjectsMigrated, classRowsMigrated };
}

async function migrateMaterials() {
  const blobs = await listBlobs(CONTAINER_PROCESSED);
  let materialsMigrated = 0;
  let skipped = 0;

  for (const blobName of blobs) {
    if (!blobName.endsWith('.json')) continue;
    const material = await loadJson(CONTAINER_PROCESSED, blobName);
    if (!material?.subjectId || !(material.materialId || material.id)) {
      skipped += 1;
      continue;
    }

    const state = toMaterialState(material);
    await upsertMaterialState(state, 'Replace');
    materialsMigrated += 1;
  }

  return { materialsMigrated, skipped };
}

async function main() {
  console.log('[Migration] Starting blob JSON -> Table Storage migration');

  const classes = await migrateClasses();
  const materials = await migrateMaterials();

  console.log('[Migration] Completed successfully');
  console.log(`[Migration] Subjects migrated: ${classes.subjectsMigrated}`);
  console.log(`[Migration] Class rows migrated: ${classes.classRowsMigrated}`);
  console.log(`[Migration] Material rows migrated: ${materials.materialsMigrated}`);
  console.log(`[Migration] Material blobs skipped: ${materials.skipped}`);
}

main().catch((err) => {
  console.error('[Migration] Failed:', err);
  process.exit(1);
});
