import { app } from '@azure/functions';
import moment from 'moment-timezone';
import { listBlobs, loadJson } from '../services/storage.js';
import { listNotificationsBySubject, upsertNotificationForSubject } from '../services/notification-store.js';

const CONTAINER_DEADLINES = 'deadlines';
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

function resolveTimezone(deadline) {
  const tz = deadline?.timezone || process.env.DEFAULT_TIMEZONE || DEFAULT_TIMEZONE;
  if (moment.tz.zone(tz)) return tz;
  return DEFAULT_TIMEZONE;
}

function parseDeadlineDueAt(dueDate, timezone) {
  if (typeof dueDate !== 'string' || dueDate.trim().length === 0) return null;
  const trimmed = dueDate.trim();

  if (trimmed.length === 10) {
    const local = moment.tz(trimmed, 'YYYY-MM-DD', true, timezone);
    if (!local.isValid()) return null;
    return local.toDate();
  }

  const parsed = new Date(trimmed);
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

function buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt, now, timezone }) {
  const deadlineId = String(deadline?.id || `${deadline?.classId || 'class'}-${deadline?.title || 'deadline'}`).replace(/\s+/g, '-').toLowerCase();
  const id = `notif-deadline-${subjectId}-${deadlineId}-${thresholdHours}h`;
  const title = thresholdHours === 48 ? 'Deadline en 48 horas' : thresholdHours === 2 ? '⚠️ Deadline urgente — 2 horas restantes' : 'Deadline en 24 horas';
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
    dueDateTimezone: timezone,
  };
}

export async function runDeadlineProximityDispatcher(context = { log: () => {}, error: () => {} }, now = new Date()) {
  const windowHours = normalizeWindowHours(process.env.DEADLINE_PROXIMITY_WINDOW_HOURS);
  const weightThreshold = Number(process.env.DEADLINE_HIGH_PRIORITY_WEIGHT_THRESHOLD) || 25;
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
        const timezone = resolveTimezone(deadline);
        const dueAt = parseDeadlineDueAt(deadline?.dueDate, timezone);
        if (!dueAt) continue;

        const thresholds = [48, 24];
        for (const thresholdHours of thresholds) {
          const withinWindow = isWithinThresholdWindow({ dueAt, now, thresholdHours, windowHours });
          if (!withinWindow) continue;

          const notification = buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt, now, timezone });
          if (existingIds.has(notification.id)) continue;

          await upsertNotificationForSubject(subjectId, notification);
          existingIds.add(notification.id);
          dispatched += 1;
        }

        const isHighPriority = (deadline?.weight || 0) >= weightThreshold;
        const isPending = (deadline?.status || 'pending') !== 'completed';
        if (isHighPriority && isPending) {
          const withinWindow2h = isWithinThresholdWindow({ dueAt, now, thresholdHours: 2, windowHours });
          if (withinWindow2h) {
            const notification = buildReminderNotification({ subjectId, deadline, thresholdHours: 2, dueAt, now, timezone });
            if (!existingIds.has(notification.id)) {
              await upsertNotificationForSubject(subjectId, notification);
              existingIds.add(notification.id);
              dispatched += 1;
            }
          }
        }
      } catch (err) {
        context.error(`[deadline-proximity-dispatcher] subject=${subjectId} deadline=${deadline?.id || 'unknown'} timezone=${resolveTimezone(deadline)} error=${err.message}`);
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
