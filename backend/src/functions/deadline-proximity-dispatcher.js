import { app } from '@azure/functions';
import { withCorrelationTimer } from '../middleware/with-correlation.js';
import moment from 'moment-timezone';
import { listBlobs, loadJson, getTableClient } from '../services/storage.js';
import { listNotificationsBySubject, upsertNotificationForSubject } from '../services/notification-store.js';
import { getEnrollmentsBySubject } from '../services/state-store.js';
import { trackDispatcherRun } from '../services/telemetry.js';

const CONTAINER_DEADLINES = 'deadlines';
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
const NOTIFICATION_PREFS_TABLE = process.env.AZURE_TABLE_NOTIFICATION_PREFERENCES || 'NotificationPreferences';
const VALID_CADENCES = ['48h', '24h', 'both'];

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

async function loadUserPreferences(userId) {
  try {
    const client = getTableClient(NOTIFICATION_PREFS_TABLE);
    const entity = await client.getEntity(userId, 'deadline-reminders');
    const enabled = entity.enabled === true || entity.enabled === 'true';
    const cadence = VALID_CADENCES.includes(entity.cadence) ? entity.cadence : 'both';
    return { enabled, cadence };
  } catch {
    return { enabled: true, cadence: 'both' };
  }
}

function shouldNotifyForThreshold(prefs, thresholdHours) {
  if (!prefs.enabled) return false;
  if (prefs.cadence === 'both') return true;
  if (prefs.cadence === '48h' && thresholdHours === 48) return true;
  if (prefs.cadence === '24h' && thresholdHours === 24) return true;
  return false;
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
  const startedAt = Date.now();
  const windowHours = normalizeWindowHours(process.env.DEADLINE_PROXIMITY_WINDOW_HOURS);
  const weightThreshold = Number(process.env.DEADLINE_HIGH_PRIORITY_WEIGHT_THRESHOLD) || 25;
  const deadlineBlobs = await listBlobs(CONTAINER_DEADLINES);
  const subjectIds = deadlineBlobs
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .filter(Boolean);

  let dispatched = 0;
  let errors = 0;
  let retryAttempts = 0;
  let deadLetterWrites = 0;
  const errorEntries = [];

  for (const subjectId of subjectIds) {
    const deadlines = await loadJson(CONTAINER_DEADLINES, `${subjectId}.json`);
    if (!Array.isArray(deadlines) || deadlines.length === 0) continue;

    const existing = await listNotificationsBySubject(subjectId);
    const existingIds = new Set(existing.map((item) => item.id));

    const enrollments = await getEnrollmentsBySubject(subjectId);
    const enrolledUserIds = enrollments
      .filter((e) => e?.status === 'active')
      .map((e) => e.userId)
      .filter(Boolean);

    const prefsCache = new Map();
    async function getPrefs(userId) {
      if (!prefsCache.has(userId)) {
        prefsCache.set(userId, await loadUserPreferences(userId));
      }
      return prefsCache.get(userId);
    }

    for (const deadline of deadlines) {
      try {
        const timezone = resolveTimezone(deadline);
        const dueAt = parseDeadlineDueAt(deadline?.dueDate, timezone);
        if (!dueAt) continue;

        const isHighPriority = (deadline?.weight || 0) >= weightThreshold;
        const isPending = (deadline?.status || 'pending') !== 'completed';

        const thresholdHoursList = [48, 24];
        if (isHighPriority && isPending) {
          thresholdHoursList.push(2);
        }

        for (const thresholdHours of thresholdHoursList) {
          const withinWindow = isWithinThresholdWindow({ dueAt, now, thresholdHours, windowHours });
          if (!withinWindow) continue;

          const recipientUserIds = [];
          for (const userId of enrolledUserIds) {
            const prefs = await getPrefs(userId);
            if (shouldNotifyForThreshold(prefs, thresholdHours)) {
              recipientUserIds.push(userId);
            }
          }

          if (recipientUserIds.length === 0) continue;

          const notification = buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt, now, timezone });
          notification.recipientUserIds = recipientUserIds;

          if (existingIds.has(notification.id)) continue;

          const { retryAttempts: retries, deadLetterWrites: dlWrites } = await upsertNotificationForSubject(subjectId, notification);
          retryAttempts += retries;
          deadLetterWrites += dlWrites;
          existingIds.add(notification.id);
          dispatched += 1;
        }
      } catch (err) {
        errors += 1;
        errorEntries.push(`subject=${subjectId} deadline=${deadline?.id || 'unknown'}`);
        context.error(`[deadline-proximity-dispatcher] subject=${subjectId} deadline=${deadline?.id || 'unknown'} timezone=${resolveTimezone(deadline)} error=${err.message}`);
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  context.log(`[deadline-proximity-dispatcher] completed; notifications upserted=${dispatched} errors=${errors} retryAttempts=${retryAttempts} deadLetterWrites=${deadLetterWrites} subjects=${subjectIds.length} duration=${durationMs}ms`);

  try {
    await trackDispatcherRun({
      dispatcherName: 'deadline-proximity',
      subjectCount: subjectIds.length,
      classCount: 0,
      dispatched,
      skipped: 0,
      errors,
      retryAttempts,
      deadLetterWrites,
      durationMs,
      errorDetails: errorEntries.length > 0 ? errorEntries.join(' | ') : undefined,
    });
  } catch (telemetryErr) {
    context.error(`[deadline-proximity-dispatcher] telemetry error: ${telemetryErr.message}`);
  }

  return { dispatched, subjectCount: subjectIds.length, errors, retryAttempts, deadLetterWrites, durationMs };
}

app.timer('deadline-proximity-dispatcher', {
  schedule: process.env.DEADLINE_PROXIMITY_TIMER_CRON || '0 */30 * * * *',
  handler: withCorrelationTimer(async (_timer, context) => {
    await runDeadlineProximityDispatcher(context);
  }),
});
