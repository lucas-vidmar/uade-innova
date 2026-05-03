import { getTableClient } from './storage.js';

const MATERIALS_TABLE = process.env.AZURE_TABLE_MATERIALS || 'materials';
const CLASSES_TABLE = process.env.AZURE_TABLE_CLASSES || 'classes';

const ensuredTables = new Set();

function compactObject(obj) {
  const compact = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) compact[key] = value;
  }
  return compact;
}

function escapeODataValue(value) {
  return String(value).replace(/'/g, "''");
}

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

async function ensureTable(tableName) {
  if (ensuredTables.has(tableName)) return;
  const client = getTableClient(tableName);
  try {
    await client.createTable();
  } catch (err) {
    // 409 means the table already exists, which is fine
    if (err.statusCode !== 409) {
      throw err;
    }
  }
  ensuredTables.add(tableName);
}

function toMaterialEntity(material) {
  const classIds = normalizeStringArray(material.classIds || material.classId);
  return compactObject({
    partitionKey: material.subjectId,
    rowKey: material.materialId,
    classIds: JSON.stringify(classIds),
    type: material.type,
    filename: material.filename,
    status: material.status,
    blobUrl: material.blobUrl,
    uploadedAt: material.uploadedAt,
    processedAt: material.processedAt,
    errorMessage: material.errorMessage,
    chunkCount: typeof material.chunkCount === 'number' ? material.chunkCount : undefined,
    reviewed: material.reviewed === true,
  });
}

function toClassEntity(subjectId, classData) {
  return compactObject({
    partitionKey: subjectId,
    rowKey: classData.id,
    title: classData.title,
    date: classData.date,
    topics: JSON.stringify(normalizeStringArray(classData.topics)),
    summaryReady: classData.summaryReady === true,
    professorIds: JSON.stringify(normalizeStringArray(classData.professorIds)),
    studentIds: JSON.stringify(normalizeStringArray(classData.studentIds)),
  });
}

function fromMaterialEntity(entity) {
  const classIds = normalizeStringArray(entity.classIds);
  return {
    id: entity.rowKey,
    materialId: entity.rowKey,
    subjectId: entity.partitionKey,
    classIds,
    type: entity.type,
    filename: entity.filename,
    status: entity.status,
    blobUrl: entity.blobUrl,
    uploadedAt: entity.uploadedAt,
    processedAt: entity.processedAt,
    errorMessage: entity.errorMessage,
    chunkCount: entity.chunkCount,
    reviewed: entity.reviewed === true,
  };
}

function fromClassEntity(entity) {
  return {
    id: entity.rowKey,
    subjectId: entity.partitionKey,
    title: entity.title,
    date: entity.date,
    topics: normalizeStringArray(entity.topics),
    summaryReady: entity.summaryReady === true,
    professorIds: normalizeStringArray(entity.professorIds),
    studentIds: normalizeStringArray(entity.studentIds),
  };
}

async function queryByPartition(tableName, partitionKey) {
  await ensureTable(tableName);
  const client = getTableClient(tableName);
  const filter = `PartitionKey eq '${escapeODataValue(partitionKey)}'`;
  const entities = [];
  for await (const entity of client.listEntities({ queryOptions: { filter } })) {
    entities.push(entity);
  }
  return entities;
}

export async function upsertMaterialState(material, mode = 'Merge') {
  if (!material?.subjectId || !material?.materialId) {
    throw new Error('upsertMaterialState requires subjectId and materialId');
  }

  await ensureTable(MATERIALS_TABLE);
  const client = getTableClient(MATERIALS_TABLE);
  const entity = toMaterialEntity(material);
  await client.upsertEntity(entity, mode);
  return fromMaterialEntity(entity);
}

export async function listMaterialsBySubject(subjectId) {
  const entities = await queryByPartition(MATERIALS_TABLE, subjectId);
  return entities.map(fromMaterialEntity);
}

export async function listMaterialsByClass(subjectId, classId) {
  const materials = await listMaterialsBySubject(subjectId);
  return materials.filter((item) => item.classIds.includes(classId));
}

export async function getMaterialState(subjectId, materialId) {
  if (!subjectId || !materialId) return null;

  await ensureTable(MATERIALS_TABLE);
  const client = getTableClient(MATERIALS_TABLE);

  try {
    const entity = await client.getEntity(subjectId, materialId);
    return fromMaterialEntity(entity);
  } catch {
    return null;
  }
}

export async function deleteMaterialState(subjectId, materialId) {
  if (!subjectId || !materialId) return false;

  await ensureTable(MATERIALS_TABLE);
  const client = getTableClient(MATERIALS_TABLE);
  try {
    await client.deleteEntity(subjectId, materialId);
    return true;
  } catch {
    return false;
  }
}

export async function deleteMaterialStateById(materialId) {
  if (!materialId) return false;

  await ensureTable(MATERIALS_TABLE);
  const client = getTableClient(MATERIALS_TABLE);

  const filter = `RowKey eq '${escapeODataValue(materialId)}'`;
  for await (const entity of client.listEntities({ queryOptions: { filter } })) {
    await client.deleteEntity(entity.partitionKey, entity.rowKey);
    return true;
  }

  return false;
}

export async function replaceClassesForSubject(subjectId, classes) {
  await ensureTable(CLASSES_TABLE);
  const client = getTableClient(CLASSES_TABLE);

  const existing = await queryByPartition(CLASSES_TABLE, subjectId);
  const existingById = new Map(existing.map((entity) => [entity.rowKey, entity]));
  const incomingIds = new Set();

  for (const classData of classes) {
    if (!classData?.id) continue;
    incomingIds.add(classData.id);
    const entity = toClassEntity(subjectId, classData);
    await client.upsertEntity(entity, 'Replace');
  }

  for (const entity of existingById.values()) {
    if (!incomingIds.has(entity.rowKey)) {
      await client.deleteEntity(entity.partitionKey, entity.rowKey);
    }
  }
}

export async function listClassesBySubject(subjectId) {
  const entities = await queryByPartition(CLASSES_TABLE, subjectId);
  return entities.map(fromClassEntity);
}

export async function deleteClassesBySubject(subjectId) {
  if (!subjectId) return;
  await ensureTable(CLASSES_TABLE);
  const client = getTableClient(CLASSES_TABLE);
  const entities = await queryByPartition(CLASSES_TABLE, subjectId);
  for (const entity of entities) {
    await client.deleteEntity(entity.partitionKey, entity.rowKey);
  }
}

export async function deleteMaterialsBySubject(subjectId) {
  if (!subjectId) return;
  await ensureTable(MATERIALS_TABLE);
  const client = getTableClient(MATERIALS_TABLE);
  const entities = await queryByPartition(MATERIALS_TABLE, subjectId);
  for (const entity of entities) {
    await client.deleteEntity(entity.partitionKey, entity.rowKey);
  }
}
