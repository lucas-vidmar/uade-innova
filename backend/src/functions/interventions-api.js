import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { getTableClient } from '../services/storage.js';
import { CONFIG } from '../services/config.js';

const INTERVENTIONS_TABLE = CONFIG.tables.interventions;
const RISK_THRESHOLDS_TABLE = CONFIG.tables.riskThresholds;
const USER_EVENTS_TABLE = CONFIG.tables.userEvents;

const VALID_STATES = ['assigned', 'contacted', 'resolved'];
const VALID_RISK_LEVELS = ['low', 'medium', 'high'];

const DEFAULT_THRESHOLDS = {
  attendanceWarning: 70,
  attendanceCritical: 50,
  engagementWarning: 60,
  engagementCritical: 40,
  gradeWarning: 6,
  noLoginDaysLow: 7,
  noLoginDaysMedium: 14,
  noLoginDaysHigh: 21,
  minQueriesMedium: 2,
  minQueriesHigh: 5,
  queryWindowDays: 7,
  queryWindowHighDays: 14,
};

function riskLevel(score) {
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

function computeRisk(row) {
  const today = new Date();
  const lastLogin = row.lastLogin ? new Date(row.lastLogin) : null;
  const queryCount7d = row.queryCount7d || 0;
  const queryCount14d = row.queryCount14d || 0;

  let score = 0;
  const reasons = [];

  if (!lastLogin) {
    score += 8;
    reasons.push('Sin actividad registrada');
  } else {
    const daysSinceLogin = Math.floor((today - lastLogin) / 86400000);
    if (daysSinceLogin >= 21) {
      score += 8;
      reasons.push(`Sin login en ${daysSinceLogin} días`);
    } else if (daysSinceLogin >= 14) {
      score += 5;
      reasons.push(`Sin login en ${daysSinceLogin} días`);
    } else if (daysSinceLogin >= 7) {
      score += 2;
      reasons.push(`Sin login en ${daysSinceLogin} días`);
    }
  }

  if (queryCount14d < 5 && queryCount14d >= 0) {
    if (queryCount7d < 2) {
      score += 4;
      reasons.push('Menos de 2 consultas en 7 días');
    } else {
      score += 1;
      reasons.push('Menos de 5 consultas en 14 días');
    }
  }

  return { risk: riskLevel(score), score, reason: reasons.join('; ') || 'Actividad normal' };
}

function escapeODataValue(value) {
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return String(value);
}

export async function getInterventions(request, context) {
  if (!validateFrontDoorId(request)) {
    return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
  }

  const principal = parseClientPrincipal(request);
  const isAuthorized = principal?.userRoles?.some(r => ['Director'].includes(r))
    || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
  if (!isAuthorized) {
    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
  }

  const subjectId = request.query.get('subjectId');
  const state = request.query.get('state');
  const risk = request.query.get('risk');

  try {
    const tableClient = getTableClient(INTERVENTIONS_TABLE);
    await tableClient.createTable();

    const filterParts = [];
    if (subjectId) filterParts.push(`PartitionKey eq ${escapeODataValue(subjectId)}`);
    if (state) {
      if (!VALID_STATES.includes(state)) {
        return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Invalid state. Must be one of: ${VALID_STATES.join(', ')}` }) };
      }
      filterParts.push(`state eq ${escapeODataValue(state)}`);
    }
    if (risk) {
      if (!VALID_RISK_LEVELS.includes(risk)) {
        return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Invalid risk level. Must be one of: ${VALID_RISK_LEVELS.join(', ')}` }) };
      }
      filterParts.push(`risk eq ${escapeODataValue(risk)}`);
    }

    const interventions = [];
    const iter = tableClient.listEntities({
      queryOptions: filterParts.length ? { filter: filterParts.join(' and ') } : undefined,
    });

    for await (const entity of iter) {
      interventions.push({
        id: entity.rowKey,
        subjectId: entity.partitionKey,
        studentId: entity.studentId,
        risk: entity.risk,
        score: Number(entity.score) || 0,
        reason: entity.reason || '',
        state: entity.state || 'assigned',
        assignedTo: entity.assignedTo || null,
        notes: entity.notes ? JSON.parse(entity.notes) : [],
        createdAt: entity.createdAt || '',
        updatedAt: entity.updatedAt || '',
      });
    }

    const sorted = interventions.sort((a, b) => b.score - a.score);
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: sorted, meta: { timestamp: new Date().toISOString() } }),
    };
  } catch (err) {
    context.log('[Interventions] Error listing interventions:', err.message);
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Error al obtener intervenciones' }),
    };
  }
}

export async function updateIntervention(request, context) {
  if (!validateFrontDoorId(request)) {
    return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
  }

  const principal = parseClientPrincipal(request);
  const isAuthorized = principal?.userRoles?.some(r => ['Director'].includes(r))
    || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
  if (!isAuthorized) {
    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
  }

  try {
    const body = await request.json();
    const { id, subjectId, state, note } = body;

    if (!id || !subjectId || !state) {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing required fields: id, subjectId, state' }) };
    }

    if (!VALID_STATES.includes(state)) {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Invalid state. Must be one of: ${VALID_STATES.join(', ')}` }) };
    }

    const tableClient = getTableClient(INTERVENTIONS_TABLE);
    await tableClient.createTable();

    let entity;
    try {
      entity = await tableClient.getEntity(subjectId, id);
    } catch {
      return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Intervention not found' }) };
    }

    const existingNotes = entity.notes ? JSON.parse(entity.notes) : [];
    const auditEntry = {
      action: `state_changed:${state}`,
      actor: principal?.userId || 'unknown',
      timestamp: new Date().toISOString(),
      note: note || '',
    };
    existingNotes.push(auditEntry);

    const updatedEntity = {
      partitionKey: subjectId,
      rowKey: id,
      state,
      assignedTo: state === 'assigned' ? (body.assignedTo || entity.assignedTo || '') : entity.assignedTo || '',
      notes: JSON.stringify(existingNotes),
      updatedAt: new Date().toISOString(),
      studentId: entity.studentId,
      risk: entity.risk,
      score: entity.score,
      reason: entity.reason,
      createdAt: entity.createdAt,
    };

    await tableClient.upsertEntity(updatedEntity, 'Replace');

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: { id, subjectId, state, updatedAt: updatedEntity.updatedAt }, meta: { timestamp: new Date().toISOString() } }),
    };
  } catch (err) {
    context.log('[Interventions] Error updating intervention:', err.message);
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Error al actualizar intervención' }),
    };
  }
}

export async function computeAndStoreInterventions(request, context) {
  if (!validateFrontDoorId(request)) {
    return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
  }

  const principal = parseClientPrincipal(request);
  const isAuthorized = principal?.userRoles?.some(r => ['Director'].includes(r))
    || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
  if (!isAuthorized) {
    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
  }

  try {
    const subjectId = request.query.get('subjectId');

    const userEventsClient = getTableClient(USER_EVENTS_TABLE);
    await userEventsClient.createTable();

    const now = new Date();
    const cutoff14d = new Date(now.getTime() - 14 * 86400000).toISOString();
    const cutoff7d = new Date(now.getTime() - 7 * 86400000).toISOString();

    const userMap = {};
    const filterParts = [];
    if (subjectId) filterParts.push(`subjectId eq ${escapeODataValue(subjectId)}`);

    for await (const event of userEventsClient.listEntities({
      queryOptions: filterParts.length ? { filter: filterParts.join(' and ') } : undefined,
    })) {
      const uid = event.userId || event.rowKey;
      if (!userMap[uid]) {
        userMap[uid] = { userId: uid, subjectId: event.subjectId || '', lastLogin: null, queryCount7d: 0, queryCount14d: 0 };
      }
      const u = userMap[uid];
      if (event.subjectId) u.subjectId = event.subjectId;

      if (event.eventType === 'login' || event.eventType === 'rag_query') {
        const ts = event.timestamp || event.createdAt || '';
        if (ts && (!u.lastLogin || ts > u.lastLogin)) {
          u.lastLogin = ts;
        }
      }

      if (event.eventType === 'rag_query') {
        const ts = event.timestamp || event.createdAt || '';
        if (ts) {
          if (ts >= cutoff7d) u.queryCount7d++;
          if (ts >= cutoff14d) u.queryCount14d++;
        }
      }
    }

    const nowIso = new Date().toISOString();
    const interventionsClient = getTableClient(INTERVENTIONS_TABLE);
    await interventionsClient.createTable();

    const results = [];
    for (const user of Object.values(userMap)) {
      if (!user.subjectId) continue;

      const { risk, score, reason } = computeRisk(user);
      if (risk === 'low') continue;

      const rowKey = `${user.userId}_${user.subjectId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const entity = {
        partitionKey: user.subjectId,
        rowKey,
        studentId: user.userId,
        risk,
        score: String(score),
        reason,
        state: 'assigned',
        notes: '[]',
        createdAt: nowIso,
        updatedAt: nowIso,
        lastLogin: user.lastLogin || '',
        queryCount7d: String(user.queryCount7d),
        queryCount14d: String(user.queryCount14d),
      };

      try {
        await interventionsClient.upsertEntity(entity, 'Replace');
      } catch (writeErr) {
        context.log('[Interventions] Error saving intervention:', writeErr.message);
      }
      results.push({ studentId: user.userId, subjectId: user.subjectId, risk, score, reason });
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: { computed: results.length, interventions: results }, meta: { timestamp: nowIso } }),
    };
  } catch (err) {
    context.log('[Interventions] Error computing interventions:', err.message);
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Error al computar intervenciones' }),
    };
  }
}

export async function getRiskThresholds(request, context) {
  if (!validateFrontDoorId(request)) {
    return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
  }

  const principal = parseClientPrincipal(request);
  const isAuthorized = principal?.userRoles?.some(r => ['Director'].includes(r))
    || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
  if (!isAuthorized) {
    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
  }

  try {
    const subjectId = request.query.get('subjectId');
    const tableClient = getTableClient(RISK_THRESHOLDS_TABLE);
    await tableClient.createTable();

    if (subjectId) {
      try {
        const entity = await tableClient.getEntity(subjectId, 'config');
        const thresholds = JSON.parse(entity.config);
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, data: { subjectId, thresholds, source: 'override' }, meta: { timestamp: new Date().toISOString() } }),
        };
      } catch {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, data: { subjectId, thresholds: DEFAULT_THRESHOLDS, source: 'default' }, meta: { timestamp: new Date().toISOString() } }),
        };
      }
    }

    const allThresholds = {};
    for await (const entity of tableClient.listEntities()) {
      allThresholds[entity.partitionKey] = JSON.parse(entity.config);
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: { thresholds: allThresholds, defaults: DEFAULT_THRESHOLDS }, meta: { timestamp: new Date().toISOString() } }),
    };
  } catch (err) {
    context.log('[Interventions] Error getting thresholds:', err.message);
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Error al obtener umbrales' }),
    };
  }
}

export async function updateRiskThresholds(request, context) {
  if (!validateFrontDoorId(request)) {
    return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
  }

  const principal = parseClientPrincipal(request);
  const isAuthorized = principal?.userRoles?.some(r => ['Director'].includes(r))
    || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
  if (!isAuthorized) {
    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
  }

  try {
    const body = await request.json();
    const { subjectId, thresholds } = body;

    if (!subjectId || !thresholds) {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing required fields: subjectId, thresholds' }) };
    }

    const merged = { ...DEFAULT_THRESHOLDS, ...thresholds };

    const tableClient = getTableClient(RISK_THRESHOLDS_TABLE);
    await tableClient.createTable();

    let existingNotes = [];
    try {
      const existing = await tableClient.getEntity(subjectId, 'config');
      existingNotes = existing.auditNotes ? JSON.parse(existing.auditNotes) : [];
    } catch {
      // new entry
    }

    existingNotes.push({
      action: 'thresholds_updated',
      actor: principal?.userId || 'unknown',
      timestamp: new Date().toISOString(),
      previous: null,
    });

    await tableClient.upsertEntity({
      partitionKey: subjectId,
      rowKey: 'config',
      config: JSON.stringify(merged),
      auditNotes: JSON.stringify(existingNotes),
      updatedAt: new Date().toISOString(),
    }, 'Replace');

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: { subjectId, thresholds: merged }, meta: { timestamp: new Date().toISOString() } }),
    };
  } catch (err) {
    context.log('[Interventions] Error updating thresholds:', err.message);
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Error al actualizar umbrales' }),
    };
  }
}

app.http('get-interventions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'interventions',
  handler: withCorrelation(withAuth(getInterventions)),
});

app.http('update-intervention', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'interventions',
  handler: withCorrelation(withAuth(updateIntervention)),
});

app.http('compute-interventions', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'interventions/compute',
  handler: withCorrelation(withAuth(computeAndStoreInterventions)),
});

app.http('get-risk-thresholds', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'risk-thresholds',
  handler: withCorrelation(withAuth(getRiskThresholds)),
});

app.http('update-risk-thresholds', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'risk-thresholds',
  handler: withCorrelation(withAuth(updateRiskThresholds)),
});
