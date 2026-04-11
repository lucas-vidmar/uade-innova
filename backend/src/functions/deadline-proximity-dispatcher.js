import { app } from '@azure/functions';
import { listBlobs, loadJson } from '../services/storage.js';
import { listNotificationsBySubject, upsertNotificationForSubject } from '../services/notification-store.js';

const CONTAINER_DEADLINES = 'deadlines';

function parseDeadlineDueAtUtc(dueDate) {
  if (typeof dueDate !== 'string' || dueDate.trim().length === 0) return null;
  const normalized = dueDate.trim().length === 10 ? `${dueDate.trim()}T00:00:00.000Z` : dueDate.trim();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function normalizeWindowHours(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return Math.min(parsed, 6);
}

function isWithinThresholdWindow({ dueAt, now, thresholdHours, windowHours }) {
  const diffMs = dueAt.getTime() - now.getTime();
  if (diffMs <= 0) return false;

  const thresholdMs = thresholdHours * 60 * 60 * 1000;
  const windowMs = windowHours * 60 * 60 * 1000;
  return diffMs <= thresholdMs && diffMs > (thresholdMs - windowMs);
}

function buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt, now }) {
  const deadlineId = String(deadline?.id || `${deadline?.classId || 'class'}-${deadline?.title || 'deadline'}`).replace(/\s+/g, '-').toLowerCase();
  const id = `notif-deadline-${subjectId}-${deadlineId}-${thresholdHours}h`;
  const title = thresholdHours === 48 ? 'Deadline en 48 horas' : 'Deadline en 24 horas';
  const classLabel = deadline?.classId ? ` · ${deadline.classId}` : '';
  const dueDateLabel = dueAt.toISOString().slice(0, 10);
  const message = `${deadline?.title || 'Entrega pendiente'} vence el ${dueDateLabel}${classLabel}.`;

  return {
    id,
    type: 'deadline',
    title,
    message,
    createdAt: now.toISOString(),
    unread: true,
    targetHash: '#/student/calendar',
    subjectId,
    recipientUserIds: [],
    origin: 'deadline-proximity-timer',
  };
}

export async function runDeadlineProximityDispatcher(context = { log: () => {}, error: () => {} }, now = new Date()) {
  const windowHours = normalizeWindowHours(process.env.DEADLINE_PROXIMITY_WINDOW_HOURS);
  const deadlineBlobs = await listBlobs(CONTAINER_DEADLINES);
  const subjectIds = deadlineBlobs
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .filter(Boolean);

  let dispatched = 0;

  for (const subjectId of subjectIds) {
    const deadlines = await loadJson(CONTAINER_DEADLINES, `${subjectId}.json`);
    if (!Array.isArray(deadlines) || deadlines.length === 0) continue;

    const existing = await listNotificationsBySubject(subjectId);
    const existingIds = new Set(existing.map((item) => item.id));

    for (const deadline of deadlines) {
      try {
        const dueAt = parseDeadlineDueAtUtc(deadline?.dueDate);
        if (!dueAt) continue;

        const thresholds = [48, 24];
        for (const thresholdHours of thresholds) {
          const withinWindow = isWithinThresholdWindow({ dueAt, now, thresholdHours, windowHours });
          if (!withinWindow) continue;

          const notification = buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt, now });
          if (existingIds.has(notification.id)) continue;

          await upsertNotificationForSubject(subjectId, notification);
          existingIds.add(notification.id);
          dispatched += 1;
        }
      } catch (err) {
        context.error(`[deadline-proximity-dispatcher] subject=${subjectId} deadline=${deadline?.id || 'unknown'} error=${err.message}`);
      }
    }
  }

  context.log(`[deadline-proximity-dispatcher] completed; notifications upserted=${dispatched}; subjects=${subjectIds.length}`);
  return { dispatched, subjectCount: subjectIds.length };
}

app.timer('deadline-proximity-dispatcher', {
  schedule: process.env.DEADLINE_PROXIMITY_TIMER_CRON || '0 */30 * * * *',
  handler: async (_timer, context) => {
    await runDeadlineProximityDispatcher(context);
  },
});
