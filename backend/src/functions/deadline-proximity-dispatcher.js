import { app } from '@azure/functions';
import { withCorrelationTimer } from '../middleware/with-correlation.js';
import moment from 'moment-timezone';
import { listBlobs, loadJson, getTableClient } from '../services/storage.js';
import { listNotificationsBySubject, upsertNotificationForSubject } from '../services/notification-store.js';
import { getEnrollmentsBySubject } from '../services/state-store.js';
import { trackDispatcherRun } from '../services/telemetry.js';
import { CONFIG } from '../services/config.js';

const CONTAINER_DEADLINES = CONFIG.containers.deadlines;
const DEFAULT_TIMEZONE = CONFIG.timezone;
const NOTIFICATION_PREFS_TABLE = CONFIG.tables.notificationPreferences;
const VALID_CADENCES = CONFIG.validCadences;
const VALID_TIME_WINDOWS = CONFIG.validTimeWindows;

// Franja horaria (UJ-35 paso 3): rangos [desde, hasta) en hora local del
// vencimiento. 'any' no restringe.
const FRANJA_HOURS = {
  morning: [6, 12],
  afternoon: [12, 19],
  evening: [19, 23],
};

// Con franja declarada, el aviso se entrega en el primer tick dentro de la
// franja una vez alcanzado el umbral (no en la hora exacta del umbral). El
// margen acota esa espera y, junto con la regla de "umbral más ajustado",
// evita que dos umbrales disparen en el mismo tick.
const FRANJA_CATCHUP_HOURS = 23;

function resolveTimezone(deadline) {
  const tz = deadline?.timezone || DEFAULT_TIMEZONE;
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

function normalizeDatePrefs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [date, value] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!value || typeof value !== 'object' || typeof value.watch !== 'boolean') continue;
    const entry = { watch: value.watch };
    const lead = Number(value.leadHours);
    if (Number.isInteger(lead) && lead >= 1 && lead <= 336) entry.leadHours = lead;
    out[date] = entry;
  }
  return out;
}

async function loadUserPreferences(userId) {
  try {
    const client = getTableClient(NOTIFICATION_PREFS_TABLE);
    const entity = await client.getEntity(userId, 'deadline-reminders');
    const enabled = entity.enabled === true || entity.enabled === 'true';
    const cadence = VALID_CADENCES.includes(entity.cadence) ? entity.cadence : 'both';
    const timeWindow = VALID_TIME_WINDOWS.includes(entity.timeWindow) ? entity.timeWindow : 'any';
    let datePrefs = {};
    if (typeof entity.datePrefsJson === 'string' && entity.datePrefsJson.length > 0) {
      try {
        datePrefs = normalizeDatePrefs(JSON.parse(entity.datePrefsJson));
      } catch {
        datePrefs = {};
      }
    }
    return { enabled, cadence, timeWindow, datePrefs };
  } catch {
    return { enabled: true, cadence: 'both', timeWindow: 'any', datePrefs: {} };
  }
}

function dateKeyOf(dueDate) {
  return String(dueDate || '').slice(0, 10);
}

function defaultThresholds(cadence, highPriority, pending) {
  const base = cadence === '48h' ? [48] : cadence === '24h' ? [24] : [48, 24];
  if (highPriority && pending && cadence === 'both') base.push(2);
  return base;
}

/**
 * Umbrales (horas antes del vencimiento) que generan aviso para esta persona en
 * esta fecha. La decisión por fecha (UJ-35 pasos 1, 2 y 9) manda: `watch:false`
 * deja constancia de que esa fecha NO genera aviso; `leadHours` fija la
 * antelación. Sin decisión por fecha se conserva la cadencia global.
 */
function thresholdsForUser(prefs, dateKey, { highPriority, pending } = {}) {
  if (!prefs.enabled) return [];
  const declared = prefs.datePrefs && prefs.datePrefs[dateKey];
  if (declared && declared.watch === false) return [];
  if (declared && Number.isInteger(declared.leadHours)) return [declared.leadHours];
  return defaultThresholds(prefs.cadence, highPriority, pending);
}

function franjaKey(timeWindow) {
  return FRANJA_HOURS[timeWindow] ? timeWindow : 'any';
}

function isWithinFranja(timeWindow, now, timezone) {
  const range = FRANJA_HOURS[timeWindow];
  if (!range) return true;
  const hour = moment(now).tz(timezone || DEFAULT_TIMEZONE).hour();
  return hour >= range[0] && hour < range[1];
}

/**
 * ¿Qué umbrales le corresponden a esta persona ahora?
 * Sin franja: la ventana ajustada de siempre (comportamiento previo intacto).
 * Con franja declarada (UJ-35 paso 3): sólo el umbral más ajustado ya alcanzado,
 * entregado en el primer tick dentro de la franja.
 */
function dueThresholdsForPlan({ plan, dueAt, now, windowHours }) {
  const diffMs = dueAt.getTime() - now.getTime();
  if (diffMs <= 0) return [];
  if (FRANJA_HOURS[plan.timeWindow]) {
    const tightest = [...plan.thresholds].sort((a, b) => a - b).find((t) => diffMs <= t * 60 * 60 * 1000);
    if (tightest === undefined) return [];
    return diffMs > tightest * 60 * 60 * 1000 - FRANJA_CATCHUP_HOURS * 60 * 60 * 1000 ? [tightest] : [];
  }
  return plan.thresholds.filter((t) => isWithinThresholdWindow({ dueAt, now, thresholdHours: t, windowHours }));
}

function buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt, now, timezone, deliveryWindow }) {
  const deadlineId = String(deadline?.id || `${deadline?.classId || 'class'}-${deadline?.title || 'deadline'}`).replace(/\s+/g, '-').toLowerCase();
  const windowSuffix = deliveryWindow && deliveryWindow !== 'any' ? `-${deliveryWindow}` : '';
  const id = `notif-deadline-${subjectId}-${deadlineId}-${thresholdHours}h${windowSuffix}`;
  const title = thresholdHours === 48 ? 'Deadline en 48 horas'
    : thresholdHours === 2 ? '⚠️ Deadline urgente — 2 horas restantes'
    : thresholdHours === 24 ? 'Deadline en 24 horas'
    : `Aviso anticipado — ${thresholdHours} horas antes`;
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
    deliveryWindow: deliveryWindow || 'any',
  };
}

export async function runDeadlineProximityDispatcher(context = { log: () => {}, error: () => {} }, now = new Date()) {
  const startedAt = Date.now();
const windowHours = normalizeWindowHours(process.env.DEADLINE_PROXIMITY_WINDOW_HOURS);
const weightThreshold = Number(process.env.DEADLINE_HIGH_PRIORITY_WEIGHT_THRESHOLD) || CONFIG.deadline.highPriorityWeightThreshold;
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
        const dateKey = dateKeyOf(deadline?.dueDate);

        // Plan por persona (UJ-35): qué umbrales le corresponden a cada una en
        // esta fecha y en qué franja quiere recibirlos.
        const plans = [];
        for (const userId of enrolledUserIds) {
          const prefs = await getPrefs(userId);
          const thresholds = thresholdsForUser(prefs, dateKey, { highPriority: isHighPriority, pending: isPending });
          if (thresholds.length === 0) continue;
          plans.push({ userId, thresholds, timeWindow: prefs.timeWindow || 'any' });
        }

        // Umbral → franja → destinatarios. Cada franja emite su propio aviso
        // para que una persona con franja no bloquee (ni sea bloqueada por) el
        // aviso sin franja.
        const recipientsByThreshold = new Map();
        for (const plan of plans) {
          if (!isWithinFranja(plan.timeWindow, now, timezone)) continue;
          for (const thresholdHours of dueThresholdsForPlan({ plan, dueAt, now, windowHours })) {
            if (!recipientsByThreshold.has(thresholdHours)) recipientsByThreshold.set(thresholdHours, new Map());
            const byFranja = recipientsByThreshold.get(thresholdHours);
            const key = franjaKey(plan.timeWindow);
            if (!byFranja.has(key)) byFranja.set(key, []);
            byFranja.get(key).push(plan.userId);
          }
        }

        const thresholdHoursList = [...recipientsByThreshold.keys()].sort((a, b) => b - a);

        for (const thresholdHours of thresholdHoursList) {
          const recipientsByFranja = recipientsByThreshold.get(thresholdHours);
          for (const [deliveryWindow, recipientUserIds] of recipientsByFranja) {
            if (recipientUserIds.length === 0) continue;

            const notification = buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt, now, timezone, deliveryWindow });
            notification.recipientUserIds = recipientUserIds;

            if (existingIds.has(notification.id)) continue;

            const { retryAttempts: retries, deadLetterWrites: dlWrites } = await upsertNotificationForSubject(subjectId, notification);
            retryAttempts += retries;
            deadLetterWrites += dlWrites;
            existingIds.add(notification.id);
            dispatched += 1;
          }
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
  schedule: CONFIG.cron.deadlineProximity,
  handler: withCorrelationTimer(async (_timer, context) => {
    await runDeadlineProximityDispatcher(context);
  }),
});
