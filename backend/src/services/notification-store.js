import { loadJson, saveJson } from './storage.js';
import { getEnrollmentsBySubject } from './state-store.js';
import { CONFIG } from '../config.js';

const CONTAINER_NOTIFICATIONS = 'notifications';
const CONTAINER_CLASS_MATERIALS = CONFIG.containers.materials;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveJsonWithRetry(container, blobName, data) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await saveJson(container, blobName, data);
      return { retryAttempts: attempt - 1, deadLetterWritten: false };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }

  const subjectId = data?.subjectId || 'unknown';
  const notificationId = data?.id || 'unknown';
  const dlBlobName = `dead-letter/notifications/${subjectId}/${Date.now()}-${notificationId}.json`;
  const dlPayload = {
    originalPayload: data,
    _dlMeta: {
      originalError: lastError.message,
      retryCount: MAX_RETRIES,
      failedAt: new Date().toISOString(),
    },
  };
  try {
    await saveJson(CONTAINER_CLASS_MATERIALS, dlBlobName, dlPayload);
    return { retryAttempts: MAX_RETRIES, deadLetterWritten: true };
  } catch (dlErr) {
    console.error(
      `[notification-store] saveJson failed after ${MAX_RETRIES} retries and dead-letter write also failed: ${lastError.message} | dl: ${dlErr.message}`
    );
    return { retryAttempts: MAX_RETRIES, deadLetterWritten: false, dlWriteError: dlErr.message };
  }
}

function normalizeRecipientUserIds(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)));
}

function normalizeReadByUserIds(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)));
}

function normalizeNotification(item = {}, idx = 0) {
  const type = ['grade', 'summary', 'material', 'deadline', 'teacher-reminder'].includes(item.type) ? item.type : 'material';
  return {
    id: String(item.id || `notif-${Date.now()}-${idx}`),
    type,
    title: String(item.title || 'Nueva notificación'),
    message: String(item.message || 'Tienes una actualización académica.'),
    createdAt: item.createdAt ?? new Date().toISOString(),
    unread: item.unread !== false,
    targetHash: item.targetHash || '#/student/dashboard',
    subjectId: item.subjectId || null,
    recipientUserIds: normalizeRecipientUserIds(item.recipientUserIds),
    readByUserIds: normalizeReadByUserIds(item.readByUserIds),
    origin: item.origin || 'manual',
  };
}

export async function listNotificationsBySubject(subjectId) {
  if (!subjectId) return [];
  const data = await loadJson(CONTAINER_NOTIFICATIONS, `${subjectId}.json`);
  if (!Array.isArray(data)) return [];
  return data.map((item, idx) => normalizeNotification(item, idx));
}

export async function listNotificationsSince(subjectId, sinceTimestamp) {
  if (!subjectId) return [];
  const data = await loadJson(CONTAINER_NOTIFICATIONS, `${subjectId}.json`);
  if (!Array.isArray(data)) return [];
  const since = new Date(sinceTimestamp).getTime();
  if (Number.isNaN(since)) return [];
  return data
    .filter((item) => new Date(item.createdAt).getTime() >= since)
    .map((item, idx) => normalizeNotification(item, idx));
}

export async function upsertNotificationForSubject(subjectId, notification) {
  if (!subjectId) return { success: false, retryAttempts: 0, deadLetterWrites: 0 };
  const current = await listNotificationsBySubject(subjectId);
  const normalized = normalizeNotification({ ...notification, subjectId }, current.length);
  const idx = current.findIndex((item) => item.id === normalized.id);

  const next = [...current];
  if (idx >= 0) {
    // Un aviso que se actualiza (p. ej. la fecha de una entrega que se mueve) sigue
    // siendo el MISMO aviso: lo que cada persona ya marcó como leído no se puede
    // perder, y sin esto el aviso vuelve a quedar pendiente para toda la cohorte
    // (UJ-58, paso 8).
    const readByUserIds = normalizeReadByUserIds([
      ...(next[idx].readByUserIds || []),
      ...(normalized.readByUserIds || []),
    ]);
    next[idx] = { ...next[idx], ...normalized, readByUserIds };
  } else {
    next.push(normalized);
  }

  next.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const result = await saveJsonWithRetry(CONTAINER_NOTIFICATIONS, `${subjectId}.json`, next);
  return {
    success: !result.deadLetterWritten && !result.dlWriteError,
    retryAttempts: result.retryAttempts,
    deadLetterWrites: result.deadLetterWritten ? 1 : 0,
  };
}

export function notificationIdForClass(subjectId, classId) {
  return `notif-auto-summary-${subjectId}-${classId}`;
}

export function summaryMessageForClass(classData) {
  const classLabel = classData?.title || classData?.id || 'Clase';
  return `${classLabel} ya tiene resumen validado.`;
}

export async function resolveEnrolledStudentIds(subjectId, classData) {
  const fromClass = Array.isArray(classData?.studentIds) ? classData.studentIds.map((item) => String(item).trim()).filter(Boolean) : [];
  try {
    const enrollments = await getEnrollmentsBySubject(subjectId);
    const fromEnrollments = enrollments
      .filter((e) => e.role === 'student' && e.status === 'active')
      .map((e) => e.userId)
      .filter(Boolean)
      .map((item) => String(item).trim());
    return Array.from(new Set([...fromEnrollments, ...fromClass]));
  } catch {
    return fromClass;
  }
}

export async function dispatchClassSummaryNotification({ subjectId, classData, origin = 'class-publish' }) {
  if (!subjectId || !classData?.id) {
    return { success: false, retryAttempts: 0, deadLetterWrites: 0, dispatched: 0 };
  }

  const classId = String(classData.id);
  const recipientUserIds = await resolveEnrolledStudentIds(subjectId, classData);

  const { retryAttempts, deadLetterWrites } = await upsertNotificationForSubject(subjectId, {
    id: notificationIdForClass(subjectId, classId),
    type: 'summary',
    title: 'Resumen validado por docente',
    message: summaryMessageForClass(classData),
    createdAt: new Date().toISOString(),
    unread: true,
    targetHash: `#/student/class/${classId}`,
    subjectId,
    recipientUserIds,
    origin,
  });

  return { success: !deadLetterWrites, retryAttempts, deadLetterWrites, dispatched: 1, recipientCount: recipientUserIds.length };
}

export async function markNotificationReadForUser(subjectId, notificationId, userId) {
  if (!subjectId || !notificationId || !userId) return { success: false, retryAttempts: 0, deadLetterWrites: 0 };

  const current = await listNotificationsBySubject(subjectId);
  const idx = current.findIndex((item) => item.id === notificationId);
  if (idx < 0) return { success: false, retryAttempts: 0, deadLetterWrites: 0 };

  const target = current[idx];
  const readByUserIds = normalizeReadByUserIds(target.readByUserIds);
  if (!readByUserIds.includes(userId)) {
    readByUserIds.push(userId);
  }

  const next = [...current];
  next[idx] = { ...target, readByUserIds };
  const result = await saveJsonWithRetry(CONTAINER_NOTIFICATIONS, `${subjectId}.json`, next);
  return {
    success: !result.deadLetterWritten && !result.dlWriteError,
    retryAttempts: result.retryAttempts,
    deadLetterWrites: result.deadLetterWritten ? 1 : 0,
  };
}
