import { getTableClient } from './storage.js';

const MATERIALS_TABLE = process.env.AZURE_TABLE_MATERIALS || 'materials';
const CLASSES_TABLE = process.env.AZURE_TABLE_CLASSES || 'classes';
const ENROLLMENTS_TABLE = process.env.AZURE_STORAGE_ENROLLMENTS_TABLE
  || process.env.AZURE_TABLE_ENROLLMENTS
  || 'Enrollments';
const CORRECTIONS_TABLE = process.env.AZURE_TABLE_CORRECTIONS || 'Corrections';
const CORRECTIONS_PENDING_TABLE = process.env.AZURE_TABLE_CORRECTIONS_PENDING || 'CorrectionsPending';
const TRANSCRIPTION_CORRECTIONS_TABLE = process.env.AZURE_TABLE_TRANSCRIPTION_CORRECTIONS || 'TranscriptionCorrections';
export const RATINGS_TABLE = process.env.AZURE_TABLE_CONVERSATION_RATINGS || 'ConversationRatings';
export const CONVERSATIONS_TABLE = process.env.AZURE_TABLE_CONVERSATIONS || 'Conversations';

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
    priority: material.priority,
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
    priority: entity.priority,
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

// ─── Enrollment Operations ─────────────────────────────────────────

function toEnrollmentEntity(enrollment) {
  return compactObject({
    partitionKey: enrollment.subjectId,
    rowKey: enrollment.userId,
    role: enrollment.role,
    status: enrollment.status || 'active',
    enrolledAt: enrollment.enrolledAt || new Date().toISOString(),
  });
}

function fromEnrollmentEntity(entity) {
  return {
    subjectId: entity.partitionKey,
    userId: entity.rowKey,
    role: entity.role,
    status: entity.status,
    enrolledAt: entity.enrolledAt,
  };
}

export async function getEnrollment(subjectId, userId) {
  if (!subjectId || !userId) return null;
  await ensureTable(ENROLLMENTS_TABLE);
  const client = getTableClient(ENROLLMENTS_TABLE);
  try {
    const entity = await client.getEntity(subjectId, userId);
    return fromEnrollmentEntity(entity);
  } catch {
    return null;
  }
}

export async function getEnrollmentsByUser(userId) {
  if (!userId) return [];
  await ensureTable(ENROLLMENTS_TABLE);
  const client = getTableClient(ENROLLMENTS_TABLE);
  const filter = `RowKey eq '${escapeODataValue(userId)}'`;
  const entities = [];
  for await (const entity of client.listEntities({ queryOptions: { filter } })) {
    entities.push(fromEnrollmentEntity(entity));
  }
  return entities;
}

export async function getEnrollmentsBySubject(subjectId) {
  if (!subjectId) return [];
  const entities = await queryByPartition(ENROLLMENTS_TABLE, subjectId);
  return entities.map(fromEnrollmentEntity);
}

export async function upsertEnrollment(enrollment) {
  if (!enrollment?.subjectId || !enrollment?.userId) {
    throw new Error('upsertEnrollment requires subjectId and userId');
  }
  await ensureTable(ENROLLMENTS_TABLE);
  const client = getTableClient(ENROLLMENTS_TABLE);
  const entity = toEnrollmentEntity(enrollment);
  await client.upsertEntity(entity, 'Replace');
  return fromEnrollmentEntity(entity);
}

export async function getConsentStatus(userId) {
  if (!userId) return false;
  try {
    const table = 'UserConsent';
    await ensureTable(table);
    const client = getTableClient(table);
    const entity = await client.getEntity(userId, 'consent');
    return entity?.acceptedAt ? true : false;
  } catch {
    return false;
  }
}

export async function deleteEnrollment(subjectId, userId) {
  if (!subjectId || !userId) return false;
  await ensureTable(ENROLLMENTS_TABLE);
  const client = getTableClient(ENROLLMENTS_TABLE);
  try {
    await client.deleteEntity(subjectId, userId);
    return true;
  } catch {
    return false;
  }
}

// ─── Corrections Operations ───────────────────────────────────

function toCorrectionEntity(correction) {
  return compactObject({
    partitionKey: correction.subjectId,
    rowKey: correction.correctionId,
    studentId: correction.studentId,
    teacherId: correction.teacherId || '',
    question: correction.question,
    originalAnswer: correction.originalAnswer,
    correctedAnswer: correction.correctedAnswer || '',
    explanation: correction.explanation || '',
    comments: correction.comments || '',
    status: correction.status || 'pending',
    issueDetail: correction.issueDetail || '',
    classId: correction.classId || '',
    messageId: correction.messageId || '',
    createdAt: correction.createdAt || new Date().toISOString(),
    resolvedAt: correction.resolvedAt || '',
    reviewedAt: correction.reviewedAt || '',
  });
}

function fromCorrectionEntity(entity) {
  return {
    correctionId: entity.rowKey,
    subjectId: entity.partitionKey,
    studentId: entity.studentId,
    teacherId: entity.teacherId || '',
    question: entity.question,
    originalAnswer: entity.originalAnswer,
    correctedAnswer: entity.correctedAnswer || '',
    explanation: entity.explanation || '',
    comments: entity.comments || '',
    status: entity.status || 'pending',
    issueDetail: entity.issueDetail || '',
    classId: entity.classId || '',
    messageId: entity.messageId || '',
    createdAt: entity.createdAt,
    resolvedAt: entity.resolvedAt || '',
    reviewedAt: entity.reviewedAt || '',
  };
}

function toCorrectionPendingEntity(correction) {
  return compactObject({
    partitionKey: 'pending',
    rowKey: correction.correctionId,
    subjectId: correction.subjectId,
    classId: correction.classId || '',
    teacherId: correction.teacherId || '',
    createdAt: correction.createdAt || new Date().toISOString(),
    studentId: correction.studentId,
    question: correction.question,
    originalAnswer: correction.originalAnswer,
    issueDetail: correction.issueDetail || '',
  });
}

export async function upsertCorrection(correction) {
  if (!correction?.subjectId || !correction?.correctionId) {
    throw new Error('upsertCorrection requires subjectId and correctionId');
  }

  const main = toCorrectionEntity(correction);
  const pending = toCorrectionPendingEntity(correction);

  await ensureTable(CORRECTIONS_TABLE);
  let client = getTableClient(CORRECTIONS_TABLE);
  await client.upsertEntity(main, 'Replace');

  await ensureTable(CORRECTIONS_PENDING_TABLE);
  client = getTableClient(CORRECTIONS_PENDING_TABLE);
  await client.upsertEntity(pending, 'Replace');

  return fromCorrectionEntity(main);
}

export async function getCorrection(subjectId, correctionId) {
  if (!subjectId || !correctionId) return null;
  await ensureTable(CORRECTIONS_TABLE);
  const client = getTableClient(CORRECTIONS_TABLE);
  try {
    const entity = await client.getEntity(subjectId, correctionId);
    return fromCorrectionEntity(entity);
  } catch {
    return null;
  }
}

export async function deletePendingCorrection(correctionId) {
  if (!correctionId) return;
  await ensureTable(CORRECTIONS_PENDING_TABLE);
  const client = getTableClient(CORRECTIONS_PENDING_TABLE);
  try {
    await client.deleteEntity('pending', correctionId);
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
}

export async function listPendingCorrections(subjectId) {
  if (!subjectId) return [];
  await ensureTable(CORRECTIONS_PENDING_TABLE);
  const client = getTableClient(CORRECTIONS_PENDING_TABLE);
  const filter = `PartitionKey eq 'pending'`;
  const all = [];
  for await (const entity of client.listEntities({ queryOptions: { filter } })) {
    if (entity.subjectId === subjectId) {
      all.push(entity);
    }
  }
  all.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return all.map(fromCorrectionEntity);
}

export async function listCorrections(subjectId, statusFilter) {
  if (!subjectId) return [];
  await ensureTable(CORRECTIONS_TABLE);
  const client = getTableClient(CORRECTIONS_TABLE);
  const filter = `PartitionKey eq '${escapeODataValue(subjectId)}'`;
  const all = [];
  for await (const entity of client.listEntities({ queryOptions: { filter } })) {
    if (!statusFilter || entity.status === statusFilter) {
      all.push(entity);
    }
  }
  all.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return all.map(fromCorrectionEntity);
}

export async function updateCorrectionStatus(subjectId, correctionId, newStatus, comments) {
  if (!subjectId || !correctionId || !newStatus) {
    throw new Error('updateCorrectionStatus requires subjectId, correctionId, and newStatus');
  }

  const correction = await getCorrection(subjectId, correctionId);
  if (!correction) {
    throw new Error('Corrección no encontrada.');
  }

  const validStatuses = ['pending', 'resolved', 'verified'];
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Estado inválido: ${newStatus}`);
  }

  correction.status = newStatus;
  if (comments) {
    correction.comments = comments;
    correction.reviewedAt = new Date().toISOString();
  }
  if (newStatus === 'resolved' || newStatus === 'verified') {
    correction.resolvedAt = new Date().toISOString();
  }

  const mainEntity = toCorrectionEntity(correction);
  await ensureTable(CORRECTIONS_TABLE);
  const client = getTableClient(CORRECTIONS_TABLE);
  await client.upsertEntity(mainEntity, 'Replace');

  // Sync CorrectionsPending table: remove if no longer pending, add if now pending
  await ensureTable(CORRECTIONS_PENDING_TABLE);
  const pendingClient = getTableClient(CORRECTIONS_PENDING_TABLE);
  if (newStatus !== 'pending') {
    try {
      await pendingClient.deleteEntity('pending', correctionId);
    } catch (err) {
      if (err.statusCode !== 404) throw err;
    }
  } else {
    try {
      await pendingClient.getEntity('pending', correctionId);
    } catch {
      const pendingEntity = toCorrectionPendingEntity(correction);
      await pendingClient.upsertEntity(pendingEntity, 'Replace');
    }
  }

  return correction;
}

export async function listReviewedCorrections(subjectId) {
  if (!subjectId) return [];
  await ensureTable(CORRECTIONS_TABLE);
  const client = getTableClient(CORRECTIONS_TABLE);
  const filter = `PartitionKey eq '${escapeODataValue(subjectId)}'`;
  const all = [];
  for await (const entity of client.listEntities({ queryOptions: { filter } })) {
    if (entity.comments && entity.status === 'resolved') {
      all.push(fromCorrectionEntity(entity));
    }
  }
  all.sort((a, b) => new Date(b.resolvedAt || b.createdAt || 0) - new Date(a.resolvedAt || a.createdAt || 0));
  return all;
}

// ─── Transcription Corrections Operations ─────────────────────

export async function listTranscriptionSuggestions(subjectId, statusFilter = 'all') {
  if (!subjectId) return [];
  await ensureTable(TRANSCRIPTION_CORRECTIONS_TABLE);
  const client = getTableClient(TRANSCRIPTION_CORRECTIONS_TABLE);
  const filter = `PartitionKey eq '${escapeODataValue(subjectId)}'`;
  const all = [];
  for await (const entity of client.listEntities({ queryOptions: { filter } })) {
    if (statusFilter === 'all' || entity.status === statusFilter) {
      all.push(entity);
    }
  }
  all.sort((a, b) => new Date(b.detectedAt || 0) - new Date(a.detectedAt || 0));
  return all;
}

export async function getTranscriptionSuggestion(subjectId, suggestionId) {
  if (!subjectId || !suggestionId) return null;
  await ensureTable(TRANSCRIPTION_CORRECTIONS_TABLE);
  const client = getTableClient(TRANSCRIPTION_CORRECTIONS_TABLE);
  try {
    return await client.getEntity(subjectId, suggestionId);
  } catch {
    return null;
  }
}

export async function updateTranscriptionSuggestion(subjectId, suggestionId, updates) {
  if (!subjectId || !suggestionId) throw new Error('subjectId and suggestionId are required');
  await ensureTable(TRANSCRIPTION_CORRECTIONS_TABLE);
  const client = getTableClient(TRANSCRIPTION_CORRECTIONS_TABLE);
  const entity = await client.getEntity(subjectId, suggestionId);
  const merged = { ...entity, ...updates };
  await client.upsertEntity(merged, 'Replace');
  return merged;
}

// ─── Conversations Operations (Story 3.2b) ─────────────────

const MAX_TS = 8640000000000000;

function toConversationRowKey(conversationId, timestamp) {
  const ts = timestamp ? new Date(timestamp).getTime() : Date.now();
  const inverted = (MAX_TS - ts).toString().padStart(16, '0');
  return `${inverted}${conversationId}`;
}

function fromConversationRowKey(rowKey) {
  return rowKey.substring(16);
}

function toConversationEntity(conversation) {
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const firstQuestion = messages.find((m) => m.role === 'user')?.content || '';
  return compactObject({
    partitionKey: conversation.userId,
    rowKey: toConversationRowKey(conversation.conversationId, conversation.lastMessageAt),
    subjectId: conversation.subjectId,
    messages: JSON.stringify(messages),
    createdAt: conversation.createdAt || new Date().toISOString(),
    lastMessageAt: conversation.lastMessageAt || new Date().toISOString(),
    messageCount: messages.length,
    firstQuestion: firstQuestion.slice(0, 200),
  });
}

function fromConversationEntity(entity) {
  let messages = [];
  try {
    messages = typeof entity.messages === 'string' ? JSON.parse(entity.messages) : (entity.messages || []);
  } catch {
    messages = [];
  }
  return {
    conversationId: fromConversationRowKey(entity.rowKey),
    userId: entity.partitionKey,
    subjectId: entity.subjectId,
    messages,
    createdAt: entity.createdAt,
    lastMessageAt: entity.lastMessageAt,
    messageCount: entity.messageCount || 0,
    firstQuestion: entity.firstQuestion || '',
  };
}

export async function saveConversation(conversation) {
  if (!conversation?.userId || !conversation?.conversationId || !conversation?.subjectId) {
    throw new Error('saveConversation requires userId, conversationId, and subjectId');
  }

  await ensureTable(CONVERSATIONS_TABLE);
  const client = getTableClient(CONVERSATIONS_TABLE);
  const entity = toConversationEntity(conversation);
  await client.upsertEntity(entity, 'Replace');
  return fromConversationEntity(entity);
}

export async function getConversation(userId, conversationId) {
  if (!userId || !conversationId) return null;

  await ensureTable(CONVERSATIONS_TABLE);
  const client = getTableClient(CONVERSATIONS_TABLE);

  try {
    const entities = client.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${escapeODataValue(userId)}'`,
      },
    });

    for await (const entity of entities) {
      if (fromConversationRowKey(entity.rowKey) === conversationId) {
        return fromConversationEntity(entity);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function listConversationsByUser(userId, subjectId) {
  if (!userId) return [];

  await ensureTable(CONVERSATIONS_TABLE);
  const client = getTableClient(CONVERSATIONS_TABLE);

  const filter = `PartitionKey eq '${escapeODataValue(userId)}'`;
  const all = [];
  try {
    for await (const entity of client.listEntities({ queryOptions: { filter } })) {
      if (!subjectId || entity.subjectId === subjectId) {
        all.push(fromConversationEntity(entity));
      }
    }
  } catch {
    return [];
  }

  all.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
  return all;
}

export async function deleteConversation(userId, conversationId) {
  if (!userId || !conversationId) return false;

  await ensureTable(CONVERSATIONS_TABLE);
  const client = getTableClient(CONVERSATIONS_TABLE);

  try {
    const entities = client.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${escapeODataValue(userId)}'`,
      },
    });

    for await (const entity of entities) {
      if (fromConversationRowKey(entity.rowKey) === conversationId) {
        await client.deleteEntity(entity.partitionKey, entity.rowKey);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
