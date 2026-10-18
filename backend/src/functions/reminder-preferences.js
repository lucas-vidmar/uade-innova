import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import {
  resolveIdentityKey,
  hasResolvedIdentity,
  validateFrontDoorId,
} from '../services/auth-utils.js';
import { getTableClient } from '../services/storage.js';
import { CONFIG } from '../services/config.js';

const TABLE_NAME = CONFIG.tables.notificationPreferences;

const VALID_CADENCES = CONFIG.validCadences;
// Franja horaria (UJ-35 paso 3): el aviso llega dentro de la franja declarada,
// no a cualquier hora. 'any' preserva el comportamiento previo.
const VALID_TIME_WINDOWS = CONFIG.validTimeWindows;
const DEFAULTS = { enabled: true, cadence: 'both', timeWindow: 'any', datePrefs: {} };

// Antelación declarada por fecha (UJ-35 paso 2): horas antes del vencimiento.
const MIN_LEAD_HOURS = 1;
const MAX_LEAD_HOURS = 336; // 14 días
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function jsonResponse(status, body) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Normaliza una entrada de `datePrefs` (una fecha). Devuelve `null` si la
 * entrada no declara `watch` booleano: una fecha sin decisión no es una fecha.
 */
function normalizeDatePref(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.watch !== 'boolean') return null;
  const out = { watch: value.watch };
  if (value.leadHours !== undefined && value.leadHours !== null) {
    const lead = Number(value.leadHours);
    if (!Number.isInteger(lead) || lead < MIN_LEAD_HOURS || lead > MAX_LEAD_HOURS) return null;
    out.leadHours = lead;
  }
  return out;
}

function normalizeDatePrefs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [date, value] of Object.entries(raw)) {
    if (!DATE_KEY_RE.test(date)) continue;
    const normalized = normalizeDatePref(value);
    if (normalized) out[date] = normalized;
  }
  return out;
}

function parseStoredDatePrefs(entity) {
  const raw = entity?.datePrefsJson;
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    return normalizeDatePrefs(JSON.parse(raw));
  } catch {
    return {};
  }
}

function normalizePreferences(entity) {
  if (!entity) return { ...DEFAULTS };
  return {
    enabled: entity.enabled === true || entity.enabled === 'true',
    cadence: VALID_CADENCES.includes(entity.cadence) ? entity.cadence : DEFAULTS.cadence,
    timeWindow: VALID_TIME_WINDOWS.includes(entity.timeWindow) ? entity.timeWindow : DEFAULTS.timeWindow,
    datePrefs: parseStoredDatePrefs(entity),
  };
}

async function getPreferencesRecord(userId) {
  const client = getTableClient(TABLE_NAME);
  try {
    return await client.getEntity(userId, 'deadline-reminders');
  } catch {
    return null;
  }
}

app.http('reminder-preferences-get', {
  methods: ['GET'],
  route: 'reminder-preferences',
  authLevel: 'anonymous',
  handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

    // No identity → there is no per-person preference to read. Serving the
    // shared 'pilot-user' row here leaked one student's cadence to another
    // (#356, same class as #327/#434).
    if (!hasResolvedIdentity(context.user)) {
      return jsonResponse(401, { error: 'Se requiere autenticación para leer las preferencias de recordatorios.' });
    }

    // Single per-user identity (#356): session-token principals carry no `oid`,
    // so keying by `principal?.oid` collapsed every student onto 'pilot-user'.
    const userId = resolveIdentityKey(request, context);

    try {
      const record = await getPreferencesRecord(userId);
      return jsonResponse(200, normalizePreferences(record));
    } catch (error) {
      context.error(`[ReminderPreferences] Error reading for userId=${userId}:`, error);
      return jsonResponse(500, { error: 'Error al leer preferencias de recordatorios.' });
    }
  })),
});

app.http('reminder-preferences-post', {
  methods: ['POST', 'PUT'],
  route: 'reminder-preferences',
  authLevel: 'anonymous',
  handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

    // Same guard as the GET: an anonymous caller must not write preferences
    // onto the shared 'pilot-user' row.
    if (!hasResolvedIdentity(context.user)) {
      return jsonResponse(401, { error: 'Se requiere autenticación para guardar las preferencias de recordatorios.' });
    }

    const userId = resolveIdentityKey(request, context);

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: 'Cuerpo de solicitud inválido.' });
    }

    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return jsonResponse(400, { error: 'enabled debe ser un booleano.' });
    }
    if (body.cadence !== undefined && !VALID_CADENCES.includes(body.cadence)) {
      return jsonResponse(400, { error: 'cadence debe ser uno de: 48h, 24h, both.' });
    }
    if (body.timeWindow !== undefined && !VALID_TIME_WINDOWS.includes(body.timeWindow)) {
      return jsonResponse(400, { error: `timeWindow debe ser uno de: ${VALID_TIME_WINDOWS.join(', ')}.` });
    }

    // Per-date declaration (UJ-35 pasos 1, 2 y 9): qué fechas generan aviso y
    // con cuánta antelación. Una entrada inválida se rechaza entera para que
    // nadie crea que quedó guardada una decisión que no se guardó.
    let normalizedDatePrefs;
    if (body.datePrefs !== undefined) {
      if (!body.datePrefs || typeof body.datePrefs !== 'object' || Array.isArray(body.datePrefs)) {
        return jsonResponse(400, { error: 'datePrefs debe ser un objeto con fechas YYYY-MM-DD.' });
      }
      for (const [date, value] of Object.entries(body.datePrefs)) {
        if (!DATE_KEY_RE.test(date)) {
          return jsonResponse(400, { error: `datePrefs contiene una fecha inválida: ${date}.` });
        }
        if (!normalizeDatePref(value)) {
          return jsonResponse(400, {
            error: `datePrefs[${date}] debe declarar watch booleano y, si hay leadHours, un entero entre ${MIN_LEAD_HOURS} y ${MAX_LEAD_HOURS}.`,
          });
        }
      }
      normalizedDatePrefs = normalizeDatePrefs(body.datePrefs);
    }

    try {
      // Un cuerpo parcial no debe pisar lo que no menciona: guardar sólo la
      // franja desde Ajustes no puede borrar la decisión por fecha hecha en el
      // calendario (ni al revés).
      const current = normalizePreferences(await getPreferencesRecord(userId));
      const enabled = body.enabled !== undefined ? body.enabled : current.enabled;
      const cadence = body.cadence !== undefined ? body.cadence : current.cadence;
      const timeWindow = body.timeWindow !== undefined ? body.timeWindow : current.timeWindow;
      const datePrefs = normalizedDatePrefs !== undefined ? normalizedDatePrefs : current.datePrefs;

      const client = getTableClient(TABLE_NAME);
      const entity = {
        partitionKey: userId,
        rowKey: 'deadline-reminders',
        enabled: String(enabled),
        cadence,
        timeWindow,
        datePrefsJson: JSON.stringify(datePrefs),
      };
      await client.upsertEntity(entity, 'Replace');
      return jsonResponse(200, { saved: true, data: { enabled, cadence, timeWindow, datePrefs } });
    } catch (error) {
      context.error(`[ReminderPreferences] Error saving for userId=${userId}:`, error);
      return jsonResponse(500, { error: 'Error al guardar preferencias de recordatorios.' });
    }
  })),
});
