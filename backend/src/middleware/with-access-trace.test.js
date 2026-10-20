import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * with-access-trace.test.js — el rastro se asienta en el punto por el que pasan
 * todas las funciones HTTP (UJ-62 pasos 5, 7 y 8 / #456).
 *
 * Se ejercita a través de `withCorrelation` (el envoltorio real de los 149
 * registros) contra el almacén real con un cliente de tabla en memoria, para
 * que la prueba cubra traducción y persistencia juntas.
 */

process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';

const tableData = [];

function createTableClient() {
  return {
    createTable: async () => true,
    upsertEntity: async (entity) => {
      tableData.push({ ...entity });
    },
    getEntity: async () => { throw Object.assign(new Error('NotFound'), { statusCode: 404 }); },
    listEntities: () => ({
      async *[Symbol.asyncIterator]() {
        for (const row of tableData) yield row;
      },
    }),
  };
}

mock.module('../services/storage.js', {
  namedExports: { getTableClient: () => createTableClient() },
});

// Identidad "ya validada por withAuth": el rastro no la deduce, la lee.
let stashed = null;
mock.module('../services/auth-utils.js', {
  namedExports: {
    getStashedIdentity: () => stashed,
    setStashedIdentity: () => {},
    parseClientPrincipal: () => null,
  },
});

const { withCorrelation } = await import('./with-correlation.js');
const { classifyOutcome, denyKind, describeOrigin, extractDenialCode } = await import('./with-access-trace.js');

function makeRequest({ method = 'GET', url = 'https://api.test/api/dashboard-admin/users', headers = {} } = {}) {
  const normalized = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method,
    url,
    headers: { get: (name) => normalized.get(String(name).toLowerCase()) ?? null },
    query: new URL(url, 'http://local').searchParams,
    params: {},
  };
}

function makeContext() {
  return { functionName: 'get-dashboard-admin-users', log: () => {}, error: () => {} };
}

beforeEach(() => {
  tableData.length = 0;
  stashed = { user: { userId: 'adm-001', sanitizedId: 'adm_001', role: 'Admin' }, principal: null };
});

test('un pedido entregado deja asiento con quién, qué, cuándo y desde dónde', async () => {
  const handler = mock.fn(async () => ({
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ users: [] }),
  }));
  const res = await withCorrelation(handler)(
    makeRequest({ headers: { 'x-azure-clientip': '203.0.113.7', 'x-correlation-id': 'corr-456' } }),
    makeContext()
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-access-audit'], undefined);
  assert.equal(tableData.length, 1);
  const row = tableData[0];
  assert.equal(row.outcome, 'delivered');
  assert.equal(row.actorId, 'adm_001');
  assert.equal(row.actorRole, 'Admin');
  assert.equal(row.actorIdentified, true);
  assert.equal(row.surface, 'get-dashboard-admin-users');
  assert.equal(row.path, '/api/dashboard-admin/users');
  assert.equal(row.originIp, '203.0.113.7');
  assert.equal(row.originSource, 'x-azure-clientip');
  assert.equal(row.correlationId, 'corr-456');
  assert.ok(row.at);
});

test('un 403 deja asiento denegado con su código: lo entregado y lo denegado se separan', async () => {
  const handler = mock.fn(async () => ({
    status: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'No estás matriculado', code: 'ENROLLMENT_REQUIRED' }),
  }));
  await withCorrelation(handler)(
    makeRequest({ method: 'POST', url: 'https://api.test/api/rag-query', headers: { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' } }),
    makeContext()
  );
  const row = tableData[0];
  assert.equal(row.outcome, 'denied');
  assert.equal(row.status, 403);
  assert.equal(row.denialCode, 'ENROLLMENT_REQUIRED');
  assert.equal(row.denialKind, 'permission');
  assert.equal(row.method, 'POST');
  assert.equal(row.originIp, '198.51.100.9');
  assert.equal(row.originSource, 'x-forwarded-for');
});

test('un 429 de caudal también es una denegación registrada', async () => {
  const handler = mock.fn(async () => ({
    status: 429,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'RATE_LIMIT_EXCEEDED' }),
  }));
  await withCorrelation(handler)(makeRequest({ url: 'https://api.test/api/rag-query' }), makeContext());
  assert.equal(tableData[0].outcome, 'denied');
  assert.equal(tableData[0].denialKind, 'rate-limit');
});

test('sin cabecera de origen el asiento declara que no está disponible (no lo inventa)', async () => {
  const handler = mock.fn(async () => ({ status: 200, headers: {}, body: '{}' }));
  await withCorrelation(handler)(makeRequest({ url: 'https://api.test/api/get-profile' }), makeContext());
  const row = tableData[0];
  assert.equal(row.originIp, null);
  assert.equal(row.originAvailable, false);
  assert.equal(row.originSource, null);
  assert.equal(describeOrigin(makeRequest()).available, false);
});

test('no copia valores de query ni el cuerpo: sólo describe el pedido', async () => {
  const handler = mock.fn(async () => ({ status: 200, headers: {}, body: '{}' }));
  const request = makeRequest({ url: 'https://api.test/api/global-search?q=nombre+de+un+alumno&limit=10' });
  request.body = { question: 'contenido sensible que no debe copiarse' };
  await withCorrelation(handler)(request, makeContext());
  const row = tableData[0];
  assert.equal(row.path, '/api/global-search');
  assert.deepEqual(JSON.parse(row.queryKeys).sort(), ['limit', 'q']);
  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes('nombre+de+un+alumno'), false);
  assert.equal(serialized.includes('contenido sensible'), false);
  assert.equal(row.bodyCopied, false);
});

test('un handler que lanza deja asiento de error y la excepción sigue su curso', async () => {
  const handler = mock.fn(async () => { throw new Error('boom'); });
  await assert.rejects(
    () => withCorrelation(handler)(makeRequest({ url: 'https://api.test/api/rag-query' }), makeContext()),
    /boom/
  );
  assert.equal(tableData.length, 1);
  assert.equal(tableData[0].outcome, 'error');
  assert.equal(tableData[0].status, 500);
});

test('si el rastro no se puede escribir, el pedido se responde igual y lo declara', async () => {
  const handler = mock.fn(async () => ({ status: 200, headers: {}, body: '{}' }));
  const saved = process.env.AZURE_STORAGE_CONNECTION_STRING;
  delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
  delete process.env.AZURE_STORAGE_ACCESS_KEY;
  try {
    const res = await withCorrelation(handler)(makeRequest({ url: 'https://api.test/api/get-profile' }), makeContext());
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-access-audit'], 'not-recorded');
  } finally {
    process.env.AZURE_STORAGE_CONNECTION_STRING = saved;
  }
});

test('el preflight no deja asiento: no es un pedido de datos', async () => {
  const handler = mock.fn(async () => ({ status: 200, headers: {}, body: '' }));
  const res = await withCorrelation(handler)(
    makeRequest({ method: 'OPTIONS', url: 'https://api.test/api/get-profile', headers: { origin: 'http://localhost:5173' } }),
    makeContext()
  );
  assert.equal(res.status, 204);
  assert.equal(handler.mock.callCount(), 0);
  assert.equal(tableData.length, 0);
});

test('la clasificación del resultado no deja zonas grises sin nombre', () => {
  assert.equal(classifyOutcome(200), 'delivered');
  assert.equal(classifyOutcome(304), 'delivered');
  assert.equal(classifyOutcome(401), 'denied');
  assert.equal(classifyOutcome(403), 'denied');
  assert.equal(classifyOutcome(429), 'denied');
  assert.equal(classifyOutcome(400), 'error');
  assert.equal(classifyOutcome(404), 'error');
  assert.equal(classifyOutcome(500), 'error');
  assert.equal(denyKind(403), 'permission');
  assert.equal(denyKind(200), null);
});

test('el motivo de la denegación se toma del código, no del mensaje', () => {
  const body = (payload) => ({ status: 403, body: JSON.stringify(payload) });
  assert.equal(extractDenialCode(body({ error: 'texto libre', code: 'SANDBOX_FORBIDDEN' })), 'SANDBOX_FORBIDDEN');
  assert.equal(extractDenialCode(body({ error: { code: 'NESTED_CODE' } })), 'NESTED_CODE');
  assert.equal(extractDenialCode({ status: 403, body: 'plano' }), null);
  assert.equal(extractDenialCode({ status: 403, body: 'no-json' }), null);
  assert.equal(extractDenialCode(null), null);
});
