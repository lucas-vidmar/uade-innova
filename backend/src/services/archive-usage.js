import { BlobServiceClient } from '@azure/storage-blob';
import { getTableClient } from './storage.js';

const CONTAINER_NAMES = ['class-materials', 'processed'];
const MATERIALS_TABLE = process.env.AZURE_TABLE_MATERIALS || 'materials';

function getBlobServiceClient() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING environment variable is required');
  }
  return BlobServiceClient.fromConnectionString(connStr);
}

function parseBlobPath(blobName) {
  const parts = blobName.split('/');
  if (parts.length < 3) return { semester: null, classId: null };
  const semester = parts.find(p => p.startsWith('semester-')) || null;
  const classId = parts.find(p => p.startsWith('class-')) || null;
  return { semester, classId };
}

async function buildClassToSubjectMap() {
  const client = getTableClient(MATERIALS_TABLE);
  const map = new Map();
  try {
    for await (const entity of client.listEntities()) {
      const subjectId = entity.partitionKey;
      let classIds = [];
      if (typeof entity.classIds === 'string') {
        try { classIds = JSON.parse(entity.classIds); } catch { classIds = [entity.classIds]; }
      }
      if (!Array.isArray(classIds)) classIds = [];
      for (const cid of classIds) {
        if (cid && !map.has(cid)) map.set(cid, subjectId);
      }
    }
  } catch (err) {
    console.warn('[ArchiveUsage] Could not build class→subject map from materials table:', err.message);
  }
  return map;
}

export async function getArchiveUsage({ subjectId, semester } = {}) {
  const client = getBlobServiceClient();
  const classToSubject = await buildClassToSubjectMap();
  const archiveBlobs = [];

  for (const containerName of CONTAINER_NAMES) {
    const containerClient = client.getContainerClient(containerName);
    const exists = await containerClient.exists();
    if (!exists) continue;

    for await (const blob of containerClient.listBlobsFlat({ includeMetadata: false, includeTags: false })) {
      if (blob.properties.accessTier !== 'Archive') continue;

      const { semester: blobSemester, classId } = parseBlobPath(blob.name);
      if (!blobSemester) continue;

      const resolvedSubject = classToSubject.get(classId) || null;

      if (subjectId && resolvedSubject !== subjectId) continue;
      if (semester && blobSemester !== semester) continue;

      archiveBlobs.push({
        blobName: blob.name,
        containerName,
        sizeBytes: blob.properties.contentLength || 0,
        subjectId: resolvedSubject,
        semester: blobSemester,
        classId,
        lastModified: blob.properties.lastModified,
      });
    }
  }

  const totalArchiveBlobs = archiveBlobs.length;
  const totalArchiveSizeBytes = archiveBlobs.reduce((sum, b) => sum + b.sizeBytes, 0);
  const totalArchiveSizeGB = totalArchiveSizeBytes / (1024 * 1024 * 1024);

  const bySubjectMap = new Map();
  const bySemesterMap = new Map();

  for (const blob of archiveBlobs) {
    const subj = blob.subjectId || 'unknown';
    if (!bySubjectMap.has(subj)) bySubjectMap.set(subj, { subjectId: subj, blobCount: 0, sizeGB: 0 });
    const entry = bySubjectMap.get(subj);
    entry.blobCount++;
    entry.sizeGB += blob.sizeBytes / (1024 * 1024 * 1024);

    const sem = blob.semester || 'unknown';
    if (!bySemesterMap.has(sem)) bySemesterMap.set(sem, { semester: sem, blobCount: 0, sizeGB: 0 });
    const sEntry = bySemesterMap.get(sem);
    sEntry.blobCount++;
    sEntry.sizeGB += blob.sizeBytes / (1024 * 1024 * 1024);
  }

  return {
    totalArchiveBlobs,
    totalArchiveSizeGB: Math.round(totalArchiveSizeGB * 100) / 100,
    bySubject: Array.from(bySubjectMap.values())
      .map(e => ({ ...e, sizeGB: Math.round(e.sizeGB * 100) / 100 }))
      .sort((a, b) => b.sizeGB - a.sizeGB),
    bySemester: Array.from(bySemesterMap.values())
      .map(e => ({ ...e, sizeGB: Math.round(e.sizeGB * 100) / 100 }))
      .sort((a, b) => b.sizeGB - a.sizeGB),
    lastUpdatedAt: new Date().toISOString(),
    dataSource: 'Azure Blob Storage — blob properties (accessTier, contentLength) + materials table join',
  };
}
