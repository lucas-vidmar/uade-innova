import { loadJson, saveJson } from './storage.js';

const CONTAINER_NOTIFICATIONS = 'notifications';

function normalizeRecipientUserIds(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean)));
}

function normalizeNotification(item = {}, idx = 0) {
  const type = ['grade', 'summary', 'material'].includes(item.type) ? item.type : 'material';
  return {
    id: String(item.id || `notif-${Date.now()}-${idx}`),
    type,
    title: String(item.title || 'Nueva notificación'),
    message: String(item.message || 'Tienes una actualización académica.'),
    createdAt: item.createdAt || new Date().toISOString(),
    unread: item.unread !== false,
    targetHash: item.targetHash || '#/student/dashboard',
    subjectId: item.subjectId || null,
    recipientUserIds: normalizeRecipientUserIds(item.recipientUserIds),
    origin: item.origin || 'manual',
  };
}

export async function listNotificationsBySubject(subjectId) {
  if (!subjectId) return [];
  const data = await loadJson(CONTAINER_NOTIFICATIONS, `${subjectId}.json`);
  if (!Array.isArray(data)) return [];
  return data.map((item, idx) => normalizeNotification(item, idx));
}

export async function upsertNotificationForSubject(subjectId, notification) {
  if (!subjectId) return false;
  const current = await listNotificationsBySubject(subjectId);
  const normalized = normalizeNotification({ ...notification, subjectId }, current.length);
  const idx = current.findIndex((item) => item.id === normalized.id);

  const next = [...current];
  if (idx >= 0) {
    next[idx] = { ...next[idx], ...normalized };
  } else {
    next.push(normalized);
  }

  next.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  await saveJson(CONTAINER_NOTIFICATIONS, `${subjectId}.json`, next);
  return true;
}
