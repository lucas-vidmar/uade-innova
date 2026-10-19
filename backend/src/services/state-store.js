import { getTableClient } from './storage.js';
import { CONFIG } from '../config.js';
import { isPublished, normalizePublicationState, resolveClassPublicationState } from './publication-state.js';
import { parseRetirementHistory } from './material-retirement.js';
import { normalizeClassIds } from './class-ids.js';

const MATERIALS_TABLE = CONFIG.tables.materials;
const CLASSES_TABLE = CONFIG.tables.classes;
const ENROLLMENTS_TABLE = CONFIG.tables.enrollments;
const USER_PROFILES_TABLE = 'UserProfiles';
const CORRECTIONS_TABLE = CONFIG.tables.corrections;
const CORRECTIONS_PENDING_TABLE = CONFIG.tables.correctionsPending;
const TRANSCRIPTION_CORRECTIONS_TABLE = CONFIG.tables.transcriptionCorrections;
export const RATINGS_TABLE = CONFIG.tables.conversationRatings;
export const CONVERSATIONS_TABLE = CONFIG.tables.conversations;
const CLASS_VIEWS_TABLE = CONFIG.tables.classViews;
const QUIZ_RESULTS_TABLE = CONFIG.tables.quizResults;
const QUIZZES_TABLE = CONFIG.tables.quizzes;
const QUIZ_ATTEMPTS_TABLE = CONFIG.tables.quizAttempts;
const QUIZ_WEAK_TOPICS_TABLE = CONFIG.tables.quizWeakTopics;

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

// Lee un campo que se guarda serializado en la tabla (UJ-10 paso 8).
function parseJsonSafe(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
  // #578: la fila autoritativa guarda los ids planos; un valor anidado como
  // texto (`'["class-01"]'`) deja el material fuera de su clase.
  const classIds = normalizeClassIds(material.classIds ?? material.classId);
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
    // #391: estado de retiro propio del material (no es `priority`).
    retirementState: material.retirementState,
    retiredBy: material.retiredBy,
    retiredAt: material.retiredAt,
    retireReason: material.retireReason,
    retirementHistory: Array.isArray(material.retirementHistory) && material.retirementHistory.length > 0
      ? JSON.stringify(material.retirementHistory)
      : undefined,
    uploadedBy: material.uploadedBy,
    fileSize: typeof material.fileSize === 'number' ? material.fileSize : undefined,
    // UJ-10 paso 8: constancia de la última corrección del texto extraído
    // (quién, cuándo, contra qué versión).
    textCorrectedBy: material.textCorrectedBy,
    textCorrectedAt: material.textCorrectedAt,
    textCorrectionCount: typeof material.textCorrectionCount === 'number' ? material.textCorrectionCount : undefined,
    lastTextCorrection: material.lastTextCorrection ? JSON.stringify(material.lastTextCorrection) : undefined,
  });
}

function toClassEntity(subjectId, classData) {
  const publicationState = resolveClassPublicationState(classData);
  return compactObject({
    partitionKey: subjectId,
    rowKey: classData.id,
    title: classData.title,
    date: classData.date,
    topics: JSON.stringify(normalizeStringArray(classData.topics)),
    // #428: el estado de publicación es el único dato real de visibilidad;
    // `summaryReady` es su espejo derivado para el contrato heredado.
    publicationState,
    publicationChangedBy: classData.publicationChangedBy,
    publicationChangedAt: classData.publicationChangedAt,
    publicationChangedReason: classData.publicationChangedReason,
    summaryReady: isPublished(publicationState),
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
    // #391: la constancia del retiro viaja con el material.
    retirementState: entity.retirementState,
    retiredBy: entity.retiredBy,
    retiredAt: entity.retiredAt,
    retireReason: entity.retireReason,
    retirementHistory: parseRetirementHistory(entity.retirementHistory),
    uploadedBy: entity.uploadedBy,
    fileSize: typeof entity.fileSize === 'number' ? entity.fileSize : Number(entity.fileSize) || undefined,
    // UJ-10 paso 8: constancia de la corrección del texto extraído.
    textCorrectedBy: entity.textCorrectedBy,
    textCorrectedAt: entity.textCorrectedAt,
    textCorrectionCount: typeof entity.textCorrectionCount === 'number' ? entity.textCorrectionCount : Number(entity.textCorrectionCount) || undefined,
    lastTextCorrection: parseJsonSafe(entity.lastTextCorrection),
  };
}

function fromClassEntity(entity) {
  // #428: `summaryReady` heredado (sin publicationState) se interpreta como publicado.
  const publicationState = normalizePublicationState(entity.publicationState, entity.summaryReady === true);
  return {
    id: entity.rowKey,
    subjectId: entity.partitionKey,
    title: entity.title,
    date: entity.date,
    topics: normalizeStringArray(entity.topics),
    publicationState,
    publicationChangedBy: entity.publicationChangedBy,
    publicationChangedAt: entity.publicationChangedAt,
    publicationChangedReason: entity.publicationChangedReason,
    summaryReady: isPublished(publicationState),
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

/**
 * Lista TODAS las entidades de una tabla sin filtro de partición.
 * Deliberadamente NO llama a ensureTable(): es solo lectura y no debe mutar el
 * storage (crear tablas) durante un dry-run/verify. Si la tabla no existe,
 * listEntities() lanza y el caller (cleanup-test-data) lo captura por categoría.
 */
async function queryAllEntities(tableName) {
  const client = getTableClient(tableName);
  const entities = [];
  for await (const entity of client.listEntities()) {
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

export async function listAllMaterials() {
  const entities = await queryAllEntities(MATERIALS_TABLE);
  return entities.map(fromMaterialEntity);
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
  // #564: se recolectan todas las coincidencias antes de borrar. Antes se
  // borraba solo la primera y se salía, así que una fila duplicada (mismo
  // materialId en otra partición) dejaba el material listado en la clase.
  const keys = [];
  for await (const entity of client.listEntities({ queryOptions: { filter } })) {
    keys.push({ partitionKey: entity.partitionKey, rowKey: entity.rowKey });
  }

  let deleted = 0;
  for (const key of keys) {
    await client.deleteEntity(key.partitionKey, key.rowKey);
    deleted += 1;
  }

  return deleted > 0;
}

/**
 * Indica si el estado del material sigue existiendo en la tabla.
 *
 * #564: el pipeline necesita distinguir "el material se borró" (no volver a
 * escribir su estado) de "el storage no respondió" (no descartar el trabajo
 * ya hecho). `getMaterialState()` devuelve null en ambos casos, así que acá
 * solo se trata como ausencia el 404 real; cualquier otro error se propaga.
 *
 * @param {string} subjectId
 * @param {string} materialId
 * @returns {Promise<boolean>}
 */
export async function materialStateExists(subjectId, materialId) {
  if (!subjectId || !materialId) return false;

  await ensureTable(MATERIALS_TABLE);
  const client = getTableClient(MATERIALS_TABLE);

  try {
    await client.getEntity(subjectId, materialId);
    return true;
  } catch (err) {
    const notFound = err?.statusCode === 404
      || err?.code === 'ResourceNotFound'
      || err?.details?.errorCode === 'ResourceNotFound';
    if (notFound) return false;
    throw err;
  }
}

/**
 * Finds a material across subjects by its RowKey (materialId).
 * @param {string} materialId
 * @returns {Promise<Object|null>} The material state (with uploadedBy/fileSize) or null.
 */
export async function getMaterialStateById(materialId) {
  if (!materialId) return null;

  await ensureTable(MATERIALS_TABLE);
  const client = getTableClient(MATERIALS_TABLE);

  const filter = `RowKey eq '${escapeODataValue(materialId)}'`;
  for await (const entity of client.listEntities({ queryOptions: { filter } })) {
    return fromMaterialEntity(entity);
  }

  return null;
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
    const previous = existingById.get(classData.id);
    // #428: guardar la lista de clases no publica ni retira. El estado sólo lo
    // cambia la acción explícita de publicación, así que acá se conserva el que
    // ya estaba guardado en lugar de tomar el del payload.
    const entity = toClassEntity(subjectId, {
      ...classData,
      publicationState: previous
        ? normalizePublicationState(previous.publicationState, previous.summaryReady === true)
        : undefined,
      publicationChangedBy: previous?.publicationChangedBy,
      publicationChangedAt: previous?.publicationChangedAt,
      publicationChangedReason: previous?.publicationChangedReason,
    });
    await client.upsertEntity(entity, 'Replace');
  }

  for (const entity of existingById.values()) {
    if (!incomingIds.has(entity.rowKey)) {
      await client.deleteEntity(entity.partitionKey, entity.rowKey);
    }
  }
}

/**
 * #428 — Único camino de escritura del estado de publicación de una clase.
 * Con `Merge` conserva el resto de la fila; si la clase sólo existía en el blob
 * heredado, crea la fila completa a partir de los datos que ya se conocen.
 */
export async function upsertClassPublicationState(subjectId, classId, {
  publicationState,
  by,
  at,
  reason,
  classData,
} = {}) {
  if (!subjectId || !classId) {
    throw new Error('upsertClassPublicationState requires subjectId and classId');
  }

  const state = normalizePublicationState(publicationState);
  await ensureTable(CLASSES_TABLE);
  const client = getTableClient(CLASSES_TABLE);

  let exists = true;
  try {
    await client.getEntity(subjectId, classId);
  } catch {
    exists = false;
  }

  const publicationFields = {
    partitionKey: subjectId,
    rowKey: classId,
    publicationState: state,
    publicationChangedBy: by,
    publicationChangedAt: at,
    publicationChangedReason: reason,
    summaryReady: isPublished(state),
  };

  const entity = exists
    ? compactObject(publicationFields)
    : toClassEntity(subjectId, {
        ...(classData || { id: classId }),
        publicationState: state,
        publicationChangedBy: by,
        publicationChangedAt: at,
        publicationChangedReason: reason,
      });

  await client.upsertEntity(entity, exists ? 'Merge' : 'Replace');

  return {
    subjectId,
    classId,
    publicationState: state,
    summaryReady: isPublished(state),
    publicationChangedBy: by,
    publicationChangedAt: at,
    publicationChangedReason: reason,
  };
}

export async function listClassesBySubject(subjectId) {
  const entities = await queryByPartition(CLASSES_TABLE, subjectId);
  return entities.map(fromClassEntity);
}

export async function listAllClasses() {
  const entities = await queryAllEntities(CLASSES_TABLE);
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

export async function listAllEnrollments() {
  const entities = await queryAllEntities(ENROLLMENTS_TABLE);
  return entities.map(fromEnrollmentEntity);
}

/**
 * Real cohort base for the adoption reading: the number of distinct people with
 * an ACTIVE student enrollment. Used instead of the fabricated 60-per-subject
 * default that produced adoption percentages with no source (#417).
 * @returns {Promise<number>}
 */
export async function countActiveStudentEnrollments() {
  const entities = await queryAllEntities(ENROLLMENTS_TABLE);
  const userIds = new Set();
  for (const entity of entities) {
    const { userId, role, status } = fromEnrollmentEntity(entity);
    if (String(role || '').toLowerCase() === 'student'
      && String(status || '').toLowerCase() === 'active'
      && userId) {
      userIds.add(userId);
    }
  }
  return userIds.size;
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
    // Accepted when the v1 `accepted` flag is set OR a timestamp exists
    // (legacy rows may carry only acceptedAt).
    return entity?.accepted === true || entity?.accepted === 'true' || !!entity?.acceptedAt;
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

/**
 * Retires every ACTIVE enrollment of a user (UJ-52 paso 4).
 *
 * Una matrícula es un permiso: mientras siga `active`, el inventario y la
 * nómina de la materia siguen mostrando a una persona que ya no puede entrar
 * como tenedora de ese permiso, y la revisión periódica (UJ-53) no puede
 * distinguir un permiso huérfano de uno vivo. Se pasa a `disabled` —no se
 * borra— para no perder la historia ni la atribución: la fila queda con su
 * dueño, su rol y su fecha de alta.
 *
 * @param {string} userId
 * @returns {Promise<{count: number, subjects: string[]}>} permisos retirados
 */
export async function deactivateEnrollmentsForUser(userId) {
  if (!userId) return { count: 0, subjects: [] };
  let enrollments = [];
  try {
    enrollments = await getEnrollmentsByUser(userId);
  } catch {
    return { count: 0, subjects: [] };
  }
  const subjects = [];
  for (const enrollment of enrollments) {
    if (!enrollment || enrollment.status !== 'active') continue;
    try {
      await upsertEnrollment({ ...enrollment, status: 'disabled' });
      subjects.push(enrollment.subjectId);
    } catch {
      // best-effort por matrícula: una que falle no impide retirar el resto
    }
  }
  return { count: subjects.length, subjects };
}

// ─── User Profiles Operations (Story 10.23 — cleanup de perfiles de test) ─

export async function listAllUserProfiles() {
  const entities = await queryAllEntities(USER_PROFILES_TABLE);
  return entities;
}

export async function deleteUserProfile(userId) {
  if (!userId) return false;
  await ensureTable(USER_PROFILES_TABLE);
  const client = getTableClient(USER_PROFILES_TABLE);
  const filter = `RowKey eq '${escapeODataValue(userId)}'`;
  let deleted = false;
  try {
    for await (const entity of client.listEntities({ queryOptions: { filter } })) {
      await client.deleteEntity(entity.partitionKey, entity.rowKey);
      deleted = true;
    }
  } catch {
    return false;
  }
  return deleted;
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
    message: correction.message || '',
    classId: correction.classId || '',
    messageId: correction.messageId || '',
    type: correction.type || undefined,
    groupKey: correction.groupKey || undefined,
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
    message: entity.message || '',
    classId: entity.classId || '',
    messageId: entity.messageId || '',
    type: entity.type || '',
    groupKey: entity.groupKey || '',
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
    // #514: la vista por defecto de la bandeja lee este índice, así que el
    // punto de convergencia y el origen de la señal viajan también acá.
    messageId: correction.messageId || '',
    groupKey: correction.groupKey || '',
    type: correction.type || '',
  });
}

/**
 * @param {object} correction
 * @param {{syncPending?: boolean}} [options] `syncPending: false` deja el
 *   índice de pendientes como está. Hace falta al volver a escribir una señal
 *   que la cátedra ya revisó: recrear su fila en `pending` la haría aparecer de
 *   nuevo en la bandeja como si nunca se hubiera cerrado (#514).
 */
export async function upsertCorrection(correction, { syncPending = true } = {}) {
  if (!correction?.subjectId || !correction?.correctionId) {
    throw new Error('upsertCorrection requires subjectId and correctionId');
  }

  const main = toCorrectionEntity(correction);
  const pending = toCorrectionPendingEntity(correction);

  await ensureTable(CORRECTIONS_TABLE);
  let client = getTableClient(CORRECTIONS_TABLE);
  await client.upsertEntity(main, 'Replace');

  if (syncPending) {
    await ensureTable(CORRECTIONS_PENDING_TABLE);
    client = getTableClient(CORRECTIONS_PENDING_TABLE);
    await client.upsertEntity(pending, 'Replace');
  }

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

  // #552: la lista tiene que coincidir con la que acepta la ruta de escritura, si
  // no un estado válido para la API revienta acá y la respuesta es un 500.
  const validStatuses = ['pending', 'reviewed', 'resolved', 'verified'];
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

export async function listAllConversations() {
  const entities = await queryAllEntities(CONVERSATIONS_TABLE);
  return entities.map(fromConversationEntity);
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

// ─── Class Views Operations ───────────────────────────────────

function toClassViewEntity(subjectId, studentId, classId, existing) {
  return compactObject({
    partitionKey: subjectId,
    rowKey: `${studentId}__${classId}`,
    studentId,
    classId,
    viewedAt: existing?.viewedAt || new Date().toISOString(),
    lastViewedAt: new Date().toISOString(),
    viewCount: existing ? (existing.viewCount || 0) + 1 : 1,
  });
}

function fromClassViewEntity(entity) {
  return {
    subjectId: entity.partitionKey,
    studentId: entity.studentId,
    classId: entity.classId,
    viewedAt: entity.viewedAt,
    lastViewedAt: entity.lastViewedAt,
    viewCount: Number(entity.viewCount || 1),
  };
}

export async function upsertClassView(subjectId, studentId, classId) {
  if (!subjectId || !studentId || !classId) {
    throw new Error('upsertClassView requires subjectId, studentId, and classId');
  }

  await ensureTable(CLASS_VIEWS_TABLE);
  const client = getTableClient(CLASS_VIEWS_TABLE);

  let existing = null;
  try {
    const entity = await client.getEntity(subjectId, `${studentId}__${classId}`);
    existing = fromClassViewEntity(entity);
  } catch {
    // First view
  }

  const entity = toClassViewEntity(subjectId, studentId, classId, existing);
  await client.upsertEntity(entity, 'Replace');
  return fromClassViewEntity(entity);
}

export async function listClassViewsBySubject(subjectId) {
  if (!subjectId) return [];
  const entities = await queryByPartition(CLASS_VIEWS_TABLE, subjectId);
  return entities.map(fromClassViewEntity);
}

export async function listClassViewsByStudent(subjectId, studentId) {
  if (!subjectId || !studentId) return [];
  const all = await listClassViewsBySubject(subjectId);
  return all.filter((v) => v.studentId === studentId);
}

export async function deleteClassViewsBySubject(subjectId) {
  if (!subjectId) return;
  const entities = await queryByPartition(CLASS_VIEWS_TABLE, subjectId);
  if (entities.length === 0) return;
  await ensureTable(CLASS_VIEWS_TABLE);
  const client = getTableClient(CLASS_VIEWS_TABLE);
  for (const entity of entities) {
    await client.deleteEntity(entity.partitionKey, entity.rowKey);
  }
}

// ─── Quiz Results Operations (Autoevaluación) ───────────────

function toQuizResultEntity(result) {
  return compactObject({
    partitionKey: result.subjectId,
    rowKey: `${result.userId}__${result.classId}`,
    userId: result.userId,
    classId: result.classId,
    quizId: result.quizId || '',
    score: result.score,
    totalQuestions: result.totalQuestions,
    correctCount: result.correctCount,
    passed: result.passed === true,
    weakTopics: JSON.stringify(result.weakTopics || []),
    answers: JSON.stringify(result.answers || []),
    attemptCount: result.attemptCount || 1,
    createdAt: result.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function fromQuizResultEntity(entity) {
  let weakTopics = [];
  let answers = [];
  try { weakTopics = JSON.parse(entity.weakTopics || '[]'); } catch { weakTopics = []; }
  try { answers = JSON.parse(entity.answers || '[]'); } catch { answers = []; }
  return {
    subjectId: entity.partitionKey,
    userId: entity.userId,
    classId: entity.classId,
    quizId: entity.quizId || '',
    score: Number(entity.score || 0),
    totalQuestions: Number(entity.totalQuestions || 0),
    correctCount: Number(entity.correctCount || 0),
    passed: entity.passed === true,
    weakTopics,
    answers,
    attemptCount: Number(entity.attemptCount || 1),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export async function upsertQuizResult(result) {
  if (!result?.subjectId || !result?.userId || !result?.classId) {
    throw new Error('upsertQuizResult requires subjectId, userId, and classId');
  }
  await ensureTable(QUIZ_RESULTS_TABLE);
  const client = getTableClient(QUIZ_RESULTS_TABLE);
  const entity = toQuizResultEntity(result);
  await client.upsertEntity(entity, 'Replace');
  return fromQuizResultEntity(entity);
}

export async function getQuizResult(subjectId, userId, classId) {
  if (!subjectId || !userId || !classId) return null;
  await ensureTable(QUIZ_RESULTS_TABLE);
  const client = getTableClient(QUIZ_RESULTS_TABLE);
  try {
    const entity = await client.getEntity(subjectId, `${userId}__${classId}`);
    return fromQuizResultEntity(entity);
  } catch {
    return null;
  }
}

export async function listQuizResultsBySubject(subjectId) {
  if (!subjectId) return [];
  const entities = await queryByPartition(QUIZ_RESULTS_TABLE, subjectId);
  return entities.map(fromQuizResultEntity);
}

export async function listQuizResultsByClass(subjectId, classId) {
  if (!subjectId || !classId) return [];
  const all = await listQuizResultsBySubject(subjectId);
  return all.filter((r) => r.classId === classId);
}

// ─── Quiz (cuestionario emitido) Operations ─────────────────
// El cuestionario se guarda en el servidor al emitirlo: es la única copia con
// las respuestas correctas, y contra ella se corrige el intento. Sin este
// registro la corrección queda delegada al navegador (puntaje forjable).

function toQuizEntity(quiz) {
  return compactObject({
    partitionKey: quiz.subjectId,
    rowKey: quiz.quizId,
    userId: quiz.userId,
    classId: quiz.classId,
    questions: JSON.stringify(quiz.questions || []),
    createdAt: quiz.createdAt || new Date().toISOString(),
    expiresAt: quiz.expiresAt,
  });
}

function fromQuizEntity(entity) {
  let questions = [];
  try { questions = JSON.parse(entity.questions || '[]'); } catch { questions = []; }
  return {
    subjectId: entity.partitionKey,
    quizId: entity.rowKey,
    userId: entity.userId,
    classId: entity.classId,
    questions,
    createdAt: entity.createdAt,
    expiresAt: entity.expiresAt,
  };
}

export async function saveQuiz(quiz) {
  if (!quiz?.subjectId || !quiz?.quizId || !quiz?.userId || !quiz?.classId) {
    throw new Error('saveQuiz requires subjectId, quizId, userId, and classId');
  }
  await ensureTable(QUIZZES_TABLE);
  const client = getTableClient(QUIZZES_TABLE);
  const entity = toQuizEntity(quiz);
  await client.upsertEntity(entity, 'Replace');
  return fromQuizEntity(entity);
}

export async function getQuiz(subjectId, quizId) {
  if (!subjectId || !quizId) return null;
  await ensureTable(QUIZZES_TABLE);
  const client = getTableClient(QUIZZES_TABLE);
  try {
    return fromQuizEntity(await client.getEntity(subjectId, quizId));
  } catch {
    return null;
  }
}

// ─── Quiz Attempts (historial de intentos) ──────────────────
// El resultado "vigente" (QuizResults) se reemplaza en cada intento; para poder
// comparar intentos y no repetir preguntas hace falta que cada uno quede como
// registro propio.

function toQuizAttemptEntity(attempt) {
  return compactObject({
    partitionKey: attempt.subjectId,
    rowKey: `${attempt.userId}__${attempt.classId}__${String(attempt.attemptNumber).padStart(4, '0')}`,
    userId: attempt.userId,
    classId: attempt.classId,
    quizId: attempt.quizId || '',
    attemptNumber: attempt.attemptNumber,
    score: attempt.score,
    totalQuestions: attempt.totalQuestions,
    correctCount: attempt.correctCount,
    passed: attempt.passed === true,
    weakTopics: JSON.stringify(attempt.weakTopics || []),
    answers: JSON.stringify(attempt.answers || []),
    createdAt: attempt.createdAt || new Date().toISOString(),
  });
}

function fromQuizAttemptEntity(entity) {
  let weakTopics = [];
  let answers = [];
  try { weakTopics = JSON.parse(entity.weakTopics || '[]'); } catch { weakTopics = []; }
  try { answers = JSON.parse(entity.answers || '[]'); } catch { answers = []; }
  return {
    subjectId: entity.partitionKey,
    userId: entity.userId,
    classId: entity.classId,
    quizId: entity.quizId || '',
    attemptNumber: Number(entity.attemptNumber || 0),
    score: Number(entity.score || 0),
    totalQuestions: Number(entity.totalQuestions || 0),
    correctCount: Number(entity.correctCount || 0),
    passed: entity.passed === true,
    weakTopics,
    answers,
    createdAt: entity.createdAt,
  };
}

export async function appendQuizAttempt(attempt) {
  if (!attempt?.subjectId || !attempt?.userId || !attempt?.classId || !attempt?.attemptNumber) {
    throw new Error('appendQuizAttempt requires subjectId, userId, classId, and attemptNumber');
  }
  await ensureTable(QUIZ_ATTEMPTS_TABLE);
  const client = getTableClient(QUIZ_ATTEMPTS_TABLE);
  const entity = toQuizAttemptEntity(attempt);
  await client.upsertEntity(entity, 'Replace');
  return fromQuizAttemptEntity(entity);
}

export async function listQuizAttempts(subjectId, userId, classId) {
  if (!subjectId || !userId || !classId) return [];
  const entities = await queryByPartition(QUIZ_ATTEMPTS_TABLE, subjectId);
  return entities
    .map(fromQuizAttemptEntity)
    .filter((a) => a.userId === userId && a.classId === classId)
    .sort((a, b) => a.attemptNumber - b.attemptNumber);
}

// ─── Quiz Weak Topics (temas flojos marcados por la persona) ─
// El resultado de la práctica propone temas a repasar, pero es la persona quien
// decide cuáles son un tema flojo suyo (UJ-30, paso 7). Esa marca vive por
// persona y unidad, al margen de los intentos: cerrar la pestaña no la borra.

function toQuizWeakTopicsEntity(record) {
  return compactObject({
    partitionKey: record.subjectId,
    rowKey: `${record.userId}__${record.classId}`,
    userId: record.userId,
    classId: record.classId,
    topics: JSON.stringify(record.topics || []),
    updatedAt: new Date().toISOString(),
  });
}

function fromQuizWeakTopicsEntity(entity) {
  let topics = [];
  try { topics = JSON.parse(entity.topics || '[]'); } catch { topics = []; }
  return {
    subjectId: entity.partitionKey,
    userId: entity.userId,
    classId: entity.classId,
    topics: Array.isArray(topics) ? topics : [],
    updatedAt: entity.updatedAt,
  };
}

export async function upsertQuizWeakTopics(record) {
  if (!record?.subjectId || !record?.userId || !record?.classId) {
    throw new Error('upsertQuizWeakTopics requires subjectId, userId, and classId');
  }
  await ensureTable(QUIZ_WEAK_TOPICS_TABLE);
  const client = getTableClient(QUIZ_WEAK_TOPICS_TABLE);
  const entity = toQuizWeakTopicsEntity(record);
  await client.upsertEntity(entity, 'Replace');
  return fromQuizWeakTopicsEntity(entity);
}

export async function getQuizWeakTopics(subjectId, userId, classId) {
  if (!subjectId || !userId || !classId) return null;
  await ensureTable(QUIZ_WEAK_TOPICS_TABLE);
  const client = getTableClient(QUIZ_WEAK_TOPICS_TABLE);
  try {
    const entity = await client.getEntity(subjectId, `${userId}__${classId}`);
    return fromQuizWeakTopicsEntity(entity);
  } catch {
    return null;
  }
}
