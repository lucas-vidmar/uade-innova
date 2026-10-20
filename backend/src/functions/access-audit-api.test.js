import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * access-audit-api.test.js — superficie de lectura y exportación del rastro
 * (UJ-62 pasos 5, 7, 8 y 9 / #456).
 *
 * Lo que se verifica: que el auditor pueda leer los pedidos con sus filtros y
 * que la exportación **separe lo entregado de lo denegado** sin que un vacío se
 * confunda con "no hubo pedidos".
 */

process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';

const tableData = [];

function tableClient() {
  return {
    createTable: async () => true,
    upsertEntity: async (entity) => {
      const idx = tableData.findIndex((row) => row.partitionKey === entity.partitionKey && row.rowKey === entity.rowKey);
      if (idx === -1) tableData.push({ ...entity });
      else tableData[idx] = { ...entity };
    },
    getEntity: async (partitionKey, rowKey) => {
      const found = tableData.find((row) => row.partitionKey === partitionKey && row.rowKey === rowKey);
      if (!found) throw Object.assign(new Error('NotFound'), { statusCode: 404 });
      return found;
    },
    listEntities: ({ queryOptions } = {}) => {
      const filter = queryOptions?.filter || '';
      const match = filter.match(/PartitionKey eq '(.+)'/);
      const partition = match ? match[1] : null;
      const rows = partition ? tableData.filter((row) => row.partitionKey === partition) : [...tableData];
      return {
        async *[Symbol.asyncIterator]() {
          for (const row of rows) yield row;
        },
      };
    },
  };
}

let principal = { userId: 'adm-001', userRoles: ['Admin'] };

mock.module('../services/storage.js', {
  namedExports: { getTableClient: () => tableClient() },
});
mock.module('../services/auth-utils.js', {
  namedExports: {
    validateFrontDoorId: () => true,
    parseClientPrincipal: () => principal,
    setStashedIdentity: () => {},
    getStashedIdentity: () => null,
  },
});

const captured = {};
mock.module('@azure/functions', {
  namedExports: {
    app: { http: (name, options) => { captured[name] = options.handler; } },
  },
});

const { recordAccess } = await import('../services/access-audit-store.js');
await import('./access-audit-api.js');

function makeRequest({ method = 'GET', url = 'https://api.test/api/audit/access-log', params = {}, headers = {} } = {}) {
  const normalized = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method,
    url,
    params,
    headers: { get: (name) => normalized.get(String(name).toLowerCase()) ?? null },
    query: new URL(url, 'http://local').searchParams,
  };
}

function context() {
  return { functionName: 'get-audit-access-log', log: () => {}, error: () => {}, principal };
}

const DAY = { from: '2026-10-20T00:00:00.000Z', to: '2026-10-20T23:59:59.000Z' };

async function seed() {
  await recordAccess({
    at: '2026-10-20T09:00:00.000Z', correlationId: 'corr-entregado',
    surface: 'get-dashboard-admin-users',
    request: { method: 'GET', path: '/api/dashboard-admin/users', resource: 'dashboard-admin', queryKeys: [] },
    actor: { id: 'adm_001', role: 'Admin', identified: true },
    outcome: 'delivered', status: 200,
    origin: { ip: '203.0.113.7', source: 'x-azure-clientip', available: true },
  });
  await recordAccess({
    at: '2026-10-20T09:30:00.000Z', correlationId: 'corr-denegado',
    surface: 'rag-query',
    request: { method: 'POST', path: '/api/rag-query', resource: 'rag-query', queryKeys: [] },
    actor: { id: 'alu_002', role: 'Alumno', identified: true },
    outcome: 'denied', status: 403, denial: { code: 'ENROLLMENT_REQUIRED', kind: 'permission' },
    origin: { ip: null, source: null, available: false },
  });
  await recordAccess({
    at: '2026-10-20T10:00:00.000Z', correlationId: 'corr-error',
    surface: 'rag-query',
    request: { method: 'POST', path: '/api/rag-query', resource: 'rag-query', queryKeys: [] },
    actor: { id: 'anonymous', role: null, identified: false },
    outcome: 'error', status: 500,
    origin: { ip: null, source: null, available: false },
  });
}

beforeEach(() => {
  tableData.length = 0;
  principal = { userId: 'adm-001', userRoles: ['Admin'] };
});

test('registra las tres rutas del rastro', () => {
  assert.strictEqual(typeof captured['get-audit-access-log'], 'function');
  assert.strictEqual(typeof captured['get-audit-access-log-export'], 'function');
  assert.strictEqual(typeof captured['get-audit-access-record'], 'function');
});

test('deniega la lectura a quien no responde por el cumplimiento', async () => {
  principal = { userId: 'alu-002', userRoles: ['Alumno'] };
  const res = await captured['get-audit-access-log'](makeRequest({ url: 'https://api.test/api/audit/access-log' }), context());
  assert.equal(res.status, 403);
});

test('lista los pedidos con conteos separados por resultado', async () => {
  await seed();
  const res = await captured['get-audit-access-log'](
    makeRequest({ url: `https://api.test/api/audit/access-log?from=${DAY.from}&to=${DAY.to}` }),
    context()
  );
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.count, 3);
  assert.deepEqual(body.totals, { delivered: 1, denied: 1, error: 1 });
  // Orden: del más reciente al más viejo.
  assert.equal(body.records[0].correlationId, 'corr-error');
  // Declara alcance, retención y si el rastro está activo: un vacío no se
  // confunde con "no hubo pedidos".
  assert.match(body.alcance, /pedidos HTTP/);
  assert.equal(body.retencion.enforced, false);
  assert.equal(body.trazado.activo, true);
  assert.equal(body.origen.disponible, true);
});

test('filtra por resultado y por identificador de correlación (paso 7)', async () => {
  await seed();
  const denegados = await captured['get-audit-access-log'](
    makeRequest({ url: `https://api.test/api/audit/access-log?from=${DAY.from}&to=${DAY.to}&outcome=denied` }),
    context()
  );
  const body = JSON.parse(denegados.body);
  assert.equal(body.count, 1);
  assert.equal(body.records[0].correlationId, 'corr-denegado');
  assert.equal(body.records[0].denial.code, 'ENROLLMENT_REQUIRED');

  const porCorrelacion = await captured['get-audit-access-log'](
    makeRequest({ url: `https://api.test/api/audit/access-log?from=${DAY.from}&to=${DAY.to}&correlationId=corr-entregado` }),
    context()
  );
  const porCorrBody = JSON.parse(porCorrelacion.body);
  assert.equal(porCorrBody.count, 1);
  assert.equal(porCorrBody.records[0].outcome, 'delivered');
  assert.equal(porCorrBody.records[0].actor.id, 'adm_001');
});

test('declara que el origen no está disponible en vez de dejarlo vacío sin explicación', async () => {
  await seed();
  const res = await captured['get-audit-access-log'](
    makeRequest({ url: `https://api.test/api/audit/access-log?from=${DAY.from}&to=${DAY.to}&outcome=denied` }),
    context()
  );
  const body = JSON.parse(res.body);
  assert.equal(body.records[0].origin.available, false);
  assert.equal(body.records[0].origin.ip, null);
  assert.match(body.records[0].origin.nota, /no disponible/);
  assert.match(body.origen.nota, /no informó el origen/);
});

test('una ventana inválida es 400 con nota, no un listado vacío', async () => {
  const res = await captured['get-audit-access-log'](
    makeRequest({ url: 'https://api.test/api/audit/access-log?from=2026-01-01&to=2026-10-20' }),
    context()
  );
  assert.equal(res.status, 400);
  const body = JSON.parse(res.body);
  assert.match(body.error, /ventana demasiado amplia/);
});

test('la exportación CSV separa entregado de denegado y ordena por resultado (paso 8)', async () => {
  await seed();
  const res = await captured['get-audit-access-log-export'](
    makeRequest({ url: `https://api.test/api/audit/access-log/export?format=csv&from=${DAY.from}&to=${DAY.to}` }),
    context()
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'text/csv; charset=utf-8');
  assert.match(res.headers['Content-Disposition'], /rastro-accesos-\d{4}-\d{2}-\d{2}\.csv/);

  const lines = res.body.split('\n');
  const dataLines = lines.filter((line) => line && !line.startsWith('#'));
  assert.equal(dataLines[0].split(',')[0], 'registro');
  assert.equal(dataLines[0].split(',')[2], 'resultado');

  // Entregados primero; denegados y errores después.
  assert.match(dataLines[1], /ENTREGADO/);
  assert.match(dataLines[2], /DENEGADO/);
  assert.match(dataLines[3], /ERROR/);
  // El origen ausente se declara en la celda: no queda en blanco.
  assert.match(dataLines[2], /no disponible/);
  // El motivo de la denegación viaja con la fila.
  assert.match(dataLines[2], /ENROLLMENT_REQUIRED/);
  // Resumen en la cola, legible por personas.
  assert.match(res.body, /# resumen: entregados=1; denegados=1; errores=1; total=3/);
  assert.match(res.body, /retencion declarada: 365 dias/);
});

test('la exportación JSON entrega bloques con nombre: entregados, denegados, errores', async () => {
  await seed();
  const res = await captured['get-audit-access-log-export'](
    makeRequest({ url: `https://api.test/api/audit/access-log/export?format=json&from=${DAY.from}&to=${DAY.to}` }),
    context()
  );
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.entregados.length, 1);
  assert.equal(body.denegados.length, 1);
  assert.equal(body.errores.length, 1);
  assert.deepEqual(body.resumen, { entregados: 1, denegados: 1, errores: 1, total: 3 });
  assert.equal(body.entregados[0].correlationId, 'corr-entregado');
  assert.equal(body.denegados[0].denial.code, 'ENROLLMENT_REQUIRED');
  assert.equal(body.retencion.days, 365);
  assert.equal(body.retencion.enforced, false);
});

test('la exportación no inventa un archivo vacío cuando la lectura falló', async () => {
  const res = await captured['get-audit-access-log-export'](
    makeRequest({ url: 'https://api.test/api/audit/access-log/export?format=csv&from=2026-01-01&to=2026-10-20' }),
    context()
  );
  assert.equal(res.status, 400);
  const body = JSON.parse(res.body);
  assert.match(body.note, /no se genera una exportación vacía/);
});

test('un formato desconocido es 400', async () => {
  const res = await captured['get-audit-access-log-export'](
    makeRequest({ url: `https://api.test/api/audit/access-log/export?format=xml&from=${DAY.from}&to=${DAY.to}` }),
    context()
  );
  assert.equal(res.status, 400);
});

test('lee un asiento por su id y declara el 404 sin inventar', async () => {
  await seed();
  const list = await captured['get-audit-access-log'](
    makeRequest({ url: `https://api.test/api/audit/access-log?from=${DAY.from}&to=${DAY.to}&correlationId=corr-denegado` }),
    context()
  );
  const recordId = JSON.parse(list.body).records[0].recordId;

  const found = await captured['get-audit-access-record'](makeRequest({ params: { recordId } }), context());
  assert.equal(found.status, 200);
  const body = JSON.parse(found.body);
  assert.equal(body.record.correlationId, 'corr-denegado');
  assert.equal(body.retencion.enforced, false);

  const missing = await captured['get-audit-access-record'](
    makeRequest({ params: { recordId: '20261020-100000000-ffffff' } }),
    context()
  );
  assert.equal(missing.status, 404);

  const invalid = await captured['get-audit-access-record'](makeRequest({ params: { recordId: '../etc/passwd' } }), context());
  assert.equal(invalid.status, 400);
});

test('la lectura del rastro deja su propio asiento: quien audita también queda registrado', async () => {
  const before = tableData.length;
  await captured['get-audit-access-log'](
    makeRequest({ url: `https://api.test/api/audit/access-log?from=${DAY.from}&to=${DAY.to}`, headers: { 'x-azure-clientip': '203.0.113.7' } }),
    context()
  );
  assert.equal(tableData.length, before + 1);
  const row = tableData[tableData.length - 1];
  assert.equal(row.path, '/api/audit/access-log');
  assert.equal(row.outcome, 'delivered');
});
