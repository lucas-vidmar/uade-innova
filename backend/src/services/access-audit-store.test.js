import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * access-audit-store.test.js — rastro de los pedidos de datos (UJ-62 / #456).
 *
 * Un asiento por pedido, entregado o denegado, con quién, qué, cuándo y desde
 * dónde — sin copiar el contenido y sin inventar el origen.
 */

process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';

const tableData = [];

function createTableClient() {
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

mock.module('./storage.js', {
  namedExports: { getTableClient: () => createTableClient() },
});

const {
  recordAccess,
  listAccessRecords,
  getAccessRecord,
  buildAccessRecordId,
  isValidAccessRecordId,
  declaredRetention,
  ACCESS_AUDIT_RETENTION_DAYS,
} = await import('./access-audit-store.js');

const AT = '2026-10-20T10:00:00.000Z';

function baseEntry(overrides = {}) {
  return {
    at: AT,
    correlationId: 'corr-1',
    surface: 'get-dashboard-admin-users',
    request: { method: 'GET', path: '/api/dashboard-admin/users', resource: 'dashboard-admin', queryKeys: ['limit'] },
    actor: { id: 'adm_001', role: 'Admin', identified: true },
    outcome: 'delivered',
    status: 200,
    origin: { ip: '203.0.113.7', source: 'x-azure-clientip', available: true },
    durationMs: 12,
    ...overrides,
  };
}

beforeEach(() => {
  tableData.length = 0;
});

test('asienta un pedido entregado con quién, qué, cuándo y desde dónde', async () => {
  const out = await recordAccess(baseEntry());
  assert.equal(out.recorded, true);
  assert.equal(tableData.length, 1);
  const row = tableData[0];
  assert.equal(row.actorId, 'adm_001');
  assert.equal(row.actorRole, 'Admin');
  assert.equal(row.actorIdentified, true);
  assert.equal(row.outcome, 'delivered');
  assert.equal(row.status, 200);
  assert.equal(row.method, 'GET');
  assert.equal(row.path, '/api/dashboard-admin/users');
  assert.equal(row.originIp, '203.0.113.7');
  assert.equal(row.at, AT);
  assert.equal(row.correlationId, 'corr-1');
});

test('asienta lo denegado con su código, para poder separarlo de lo entregado (paso 8)', async () => {
  const out = await recordAccess(baseEntry({
    outcome: 'denied', status: 403,
    denial: { code: 'ENROLLMENT_REQUIRED', kind: 'permission' },
    request: { method: 'POST', path: '/api/rag-query', resource: 'rag-query', queryKeys: [] },
  }));
  assert.equal(out.recorded, true);
  const record = await getAccessRecord(out.recordId);
  assert.equal(record.record?.outcome, 'denied');
  assert.equal(record.record?.denial?.code, 'ENROLLMENT_REQUIRED');
  assert.equal(record.record?.denial?.kind, 'permission');
});

test('no copia el contenido del pedido: ni valores de query ni cuerpo', async () => {
  const out = await recordAccess(baseEntry({
    request: {
      method: 'POST', path: '/api/rag-query', resource: 'rag-query',
      queryKeys: ['q'], body: { question: 'datos sensibles del alumno' },
    },
  }));
  const record = (await getAccessRecord(out.recordId)).record;
  assert.deepEqual(record.request.queryKeys, ['q']);
  assert.equal(record.request.contentCopied, false);
  const serialized = JSON.stringify(tableData[0]);
  assert.equal(serialized.includes('datos sensibles'), false);
});

test('el origen no disponible queda declarado, no inventado', async () => {
  const out = await recordAccess(baseEntry({
    origin: { ip: null, source: null, available: false, nota: 'origen no disponible' },
  }));
  const record = (await getAccessRecord(out.recordId)).record;
  assert.equal(record.origin.ip, null);
  assert.equal(record.origin.available, false);
  assert.match(record.origin.nota, /no disponible/);
});

test('declara la retención del propio rastro y no la presenta como aplicada', () => {
  const retention = declaredRetention();
  assert.equal(retention.days, ACCESS_AUDIT_RETENTION_DAYS);
  assert.equal(retention.enforced, false);
  assert.match(retention.nota, /no le fija plazo/);
});

test('cada pedido deja su propio asiento: el registro es append-only', async () => {
  await recordAccess(baseEntry());
  await recordAccess(baseEntry({ at: '2026-10-20T10:00:01.000Z' }));
  await recordAccess(baseEntry({ at: '2026-10-20T10:00:02.000Z' }));
  assert.equal(tableData.length, 3);
  const ids = new Set(tableData.map((r) => r.rowKey));
  assert.equal(ids.size, 3);
});

test('lista del más reciente al más viejo y cuenta entregados, denegados y errores', async () => {
  await recordAccess(baseEntry({ at: '2026-10-20T09:00:00.000Z' }));
  await recordAccess(baseEntry({ at: '2026-10-20T10:00:00.000Z', outcome: 'denied', status: 401, denial: { code: 'AUTH_REQUIRED' } }));
  await recordAccess(baseEntry({ at: '2026-10-20T11:00:00.000Z', outcome: 'error', status: 500 }));

  const page = await listAccessRecords({ from: '2026-10-20T00:00:00.000Z', to: '2026-10-20T23:59:59.000Z' });
  assert.equal(page.error, null);
  assert.equal(page.count, 3);
  assert.equal(page.records[0].at, '2026-10-20T11:00:00.000Z');
  assert.equal(page.records[2].at, '2026-10-20T09:00:00.000Z');
  assert.deepEqual(page.totals, { delivered: 1, denied: 1, error: 1 });
});

test('filtra por resultado, actor y correlationId', async () => {
  await recordAccess(baseEntry({ at: '2026-10-20T09:00:00.000Z', correlationId: 'corr-a' }));
  await recordAccess(baseEntry({ at: '2026-10-20T10:00:00.000Z', correlationId: 'corr-b', outcome: 'denied', status: 403, denial: { code: 'SANDBOX_FORBIDDEN' } }));

  const denegados = await listAccessRecords({ from: '2026-10-20T00:00:00.000Z', to: '2026-10-20T23:59:59.000Z', outcome: 'denied' });
  assert.equal(denegados.count, 1);
  assert.equal(denegados.records[0].correlationId, 'corr-b');

  const porCorrelacion = await listAccessRecords({ from: '2026-10-20T00:00:00.000Z', to: '2026-10-20T23:59:59.000Z', correlationId: 'corr-a' });
  assert.equal(porCorrelacion.count, 1);
  assert.equal(porCorrelacion.records[0].outcome, 'delivered');

  const porActor = await listAccessRecords({ from: '2026-10-20T00:00:00.000Z', to: '2026-10-20T23:59:59.000Z', actor: 'ADM_001' });
  assert.equal(porActor.count, 2);

  const sinActor = await listAccessRecords({ from: '2026-10-20T00:00:00.000Z', to: '2026-10-20T23:59:59.000Z', actor: 'alu-002' });
  assert.equal(sinActor.count, 0);
});

test('pagina con cursor sin repetir ni saltear asientos', async () => {
  for (let i = 0; i < 5; i += 1) {
    await recordAccess(baseEntry({ at: `2026-10-20T10:00:0${i}.000Z` }));
  }
  const primera = await listAccessRecords({ from: '2026-10-20T00:00:00.000Z', to: '2026-10-20T23:59:59.000Z', limit: 2 });
  assert.equal(primera.count, 2);
  const segunda = await listAccessRecords({ from: '2026-10-20T00:00:00.000Z', to: '2026-10-20T23:59:59.000Z', limit: 2, cursor: primera.cursor });
  assert.equal(segunda.count, 2);
  const ids = new Set([...primera.records, ...segunda.records].map((r) => r.recordId));
  assert.equal(ids.size, 4);
});

test('rechaza ventanas inválidas y demasiado amplias en vez de escanear', async () => {
  const invertida = await listAccessRecords({ from: '2026-10-20T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' });
  assert.match(invertida.error, /from es posterior/);
  const amplia = await listAccessRecords({ from: '2026-01-01T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' });
  assert.match(amplia.error, /ventana demasiado amplia/);
  const basura = await listAccessRecords({ from: 'ayer', to: 'hoy' });
  assert.match(basura.error, /ventana inválida/);
});

test('rechaza un resultado que no es del rastro (no inventa categorías)', async () => {
  const out = await recordAccess(baseEntry({ outcome: 'quizas' }));
  assert.equal(out.recorded, false);
  assert.match(out.error, /outcome inválido/);
});

test('el id del asiento es citable y ubica su día', () => {
  const id = buildAccessRecordId({ at: AT, nonce: 'abc123' });
  assert.equal(id, '20261020-100000000-abc123');
  assert.equal(isValidAccessRecordId(id), true);
  assert.equal(isValidAccessRecordId('2026/10/20'), false);
});

test('sin almacén configurado no escribe ni lanza: lo declara', async () => {
  const saved = process.env.AZURE_STORAGE_CONNECTION_STRING;
  delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
  delete process.env.AZURE_STORAGE_ACCESS_KEY;
  try {
    const out = await recordAccess(baseEntry());
    assert.equal(out.recorded, false);
    assert.match(out.error, /sin almacén de auditoría configurado/);
    const page = await listAccessRecords({});
    assert.match(page.error, /sin almacén de auditoría configurado/);
  } finally {
    process.env.AZURE_STORAGE_CONNECTION_STRING = saved;
  }
});
