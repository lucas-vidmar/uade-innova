import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getTableClient } from '../services/storage.js';

const TABLE_NAME = process.env.AZURE_TABLE_NOTIFICATION_PREFERENCES || 'NotificationPreferences';

const VALID_CADENCES = ['48h', '24h', 'both'];
const DEFAULTS = { enabled: true, cadence: 'both' };

function jsonResponse(status, body) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function normalizePreferences(entity) {
  if (!entity) return { ...DEFAULTS };
  return {
    enabled: entity.enabled === true || entity.enabled === 'true',
    cadence: VALID_CADENCES.includes(entity.cadence) ? entity.cadence : DEFAULTS.cadence,
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
  handler: withCorrelation(async (request, context) => {
    if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
    const principal = parseClientPrincipal(request);
    const userId = principal?.oid || 'pilot-user';

    try {
      const record = await getPreferencesRecord(userId);
      return jsonResponse(200, normalizePreferences(record));
    } catch (error) {
      context.error(`[ReminderPreferences] Error reading for userId=${userId}:`, error);
      return jsonResponse(500, { error: 'Error al leer preferencias de recordatorios.' });
    }
  }),
});

app.http('reminder-preferences-post', {
  methods: ['POST', 'PUT'],
  route: 'reminder-preferences',
  authLevel: 'anonymous',
  handler: withCorrelation(async (request, context) => {
    if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
    const principal = parseClientPrincipal(request);
    const userId = principal?.oid || 'pilot-user';

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: 'Cuerpo de solicitud inválido.' });
    }

    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return jsonResponse(400, { error: 'enabled debe ser un booleano.' });
    }

    const enabled = body.enabled !== undefined ? body.enabled : DEFAULTS.enabled;
    const cadence = body.cadence || DEFAULTS.cadence;

    if (!VALID_CADENCES.includes(cadence)) {
      return jsonResponse(400, { error: 'cadence debe ser uno de: 48h, 24h, both.' });
    }

    try {
      const client = getTableClient(TABLE_NAME);
      const entity = {
        partitionKey: userId,
        rowKey: 'deadline-reminders',
        enabled: String(enabled),
        cadence,
      };
      await client.upsertEntity(entity, 'Replace');
      return jsonResponse(200, { saved: true, data: { enabled, cadence } });
    } catch (error) {
      context.error(`[ReminderPreferences] Error saving for userId=${userId}:`, error);
      return jsonResponse(500, { error: 'Error al guardar preferencias de recordatorios.' });
    }
  }),
});
