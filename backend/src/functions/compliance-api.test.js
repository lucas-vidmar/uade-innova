import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let storedPolicy = null;
const storageMocks = {
  loadJson: mock.fn(async () => storedPolicy),
  saveJson: mock.fn(async (container, blob, data) => {
    storedPolicy = { ...data };
  }),
  // telemetry -> safety-rate transitively imports getTableClient from storage.
  getTableClient: mock.fn(() => ({
    createTable: async () => {},
    getEntity: async () => { throw Object.assign(new Error('NotFound'), { statusCode: 404 }); },
    upsertEntity: async () => {},
  })),
};

const authUtilsMocks = {
  validateFrontDoorId: mock.fn(() => true),
  setStashedIdentity: mock.fn(() => {}),
  parseClientPrincipal: mock.fn(() => ({ userId: 'test-admin', userRoles: ['Director'] })),
};

mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });

const captured = {};
mock.module('@azure/functions', {
  namedExports: {
    app: {
      http: (name, options) => {
        captured[name] = options.handler;
      },
    },
  },
});

await import('./compliance-api.js');

function makeRequest({ method = 'GET', body = null, query = {} } = {}) {
  return {
    method,
    params: {},
    headers: { get: () => null },
    query: { get: (key) => (key in query ? query[key] : null) },
    json: async () => body,
  };
}

function context() {
  return { log: () => {}, error: () => {}, info: () => {} };
}

function validPolicy(overrides = {}) {
  return { archiveEnabled: true, archiveDays: 730, deleteEnabled: true, deleteDays: 1095, notifyTeachers: true, autoDelete: true, ...overrides };
}

test('retention routes are registered', () => {
  assert.strictEqual(typeof captured['put-compliance-retention-policy'], 'function');
  assert.strictEqual(typeof captured['get-compliance-retention-policy'], 'function');
});

test('PUT retention-policy persists and returns readback', async () => {
  storedPolicy = null;
  const saveCallsBefore = storageMocks.saveJson.mock.callCount();
  const res = await captured['put-compliance-retention-policy'](
    makeRequest({ method: 'PUT', body: validPolicy({ deleteDays: 1460 }) }),
    context()
  );
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.configured, true);
  assert.strictEqual(body.archiveDays, 730);
  assert.strictEqual(body.deleteDays, 1460);
  assert.strictEqual(body.updatedBy, 'test-admin');
  assert.ok(body.updatedAt);
  assert.strictEqual(storageMocks.saveJson.mock.callCount(), saveCallsBefore + 1);
  assert.strictEqual(storedPolicy.deleteDays, 1460);
});

test('PUT retention-policy rejects deleteDays <= archiveDays (server-side AC #2)', async () => {
  storedPolicy = null;
  const saveCallsBefore = storageMocks.saveJson.mock.callCount();
  const res = await captured['put-compliance-retention-policy'](
    makeRequest({ method: 'PUT', body: validPolicy({ deleteDays: 365 }) }),
    context()
  );
  assert.strictEqual(res.status, 400);
  const body = JSON.parse(res.body);
  assert.match(body.error, /deleteDays \(365\) debe ser mayor que archiveDays \(730\)/);
  assert.strictEqual(storageMocks.saveJson.mock.callCount(), saveCallsBefore, 'invalid policy must not be persisted');
});

test('GET retention-policy returns persisted values (readback path)', async () => {
  storedPolicy = { ...validPolicy({ deleteDays: 1460 }), rules: [], softDeleteDays: 7 };
  const res = await captured['get-compliance-retention-policy'](makeRequest({}), context());
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.configured, true);
  assert.strictEqual(body.archiveDays, 730);
  assert.strictEqual(body.deleteDays, 1460);
});

test('GET retention-policy default-merges legacy blob shape (no undefined fields)', async () => {
  storedPolicy = { softDeleteDays: 7, rules: [] };
  const res = await captured['get-compliance-retention-policy'](makeRequest({}), context());
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.configured, true);
  assert.strictEqual(body.softDeleteDays, 7);
  assert.deepStrictEqual(body.rules, []);
  assert.strictEqual(body.archiveEnabled, true);
  assert.strictEqual(body.archiveDays, 730);
  assert.strictEqual(body.deleteEnabled, true);
  assert.strictEqual(body.deleteDays, 1095);
  assert.strictEqual(body.notifyTeachers, true);
  assert.strictEqual(body.autoDelete, true);
  assert.ok(!JSON.stringify(body).includes('undefined'));
});

function storedPolicyWithFilterRules() {
  return {
    ...validPolicy({ deleteDays: 1460 }),
    rules: [
      { name: 'DeleteArchiveAfter2Years', enabled: true, action: 'delete', filter: { containerPattern: 'archive-*', blobAgeDays: 730 } },
    ],
    softDeleteDays: 7,
  };
}

test('CSV export handles filter-shape rules and includes persisted settings', async () => {
  storedPolicy = storedPolicyWithFilterRules();
  const res = await captured['get-compliance-retention-export'](
    makeRequest({ query: { format: 'csv' } }),
    context()
  );
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['Content-Type'], /text\/csv/);
  // Rules with the { filter: { containerPattern, blobAgeDays } } shape must not crash (regression #1).
  assert.match(res.body, /DeleteArchiveAfter2Years,true,delete,730,"archive-\*"/);
  // Persisted archive/delete/notify settings appear in the CSV (regression #2).
  assert.match(res.body, /cold_archive_policy,true,archive,730,class-materials/);
  assert.match(res.body, /permanent_delete_policy,true,delete,1460,all_blobs/);
  assert.match(res.body, /notify_teachers,true,notify,,teachers/);
  assert.match(res.body, /auto_delete,true,autoDelete,,all_blobs/);
  assert.match(res.body, /soft_delete_policy,true,softDelete,7,all_blobs/);
  assert.match(res.body, /generated_at,/);
});

test('JSON export includes persisted archive/delete settings', async () => {
  storedPolicy = storedPolicyWithFilterRules();
  const res = await captured['get-compliance-retention-export'](
    makeRequest({ query: { format: 'json' } }),
    context()
  );
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['Content-Type'], /application\/json/);
  const body = JSON.parse(res.body);
  assert.deepStrictEqual(body.export.archivePolicy, { enabled: true, days: 730 });
  assert.deepStrictEqual(body.export.deletePolicy, { enabled: true, days: 1460 });
  assert.deepStrictEqual(body.export.notifications, { notifyTeachers: true, autoDelete: true });
  assert.strictEqual(body.export.softDeletePolicy.days, 7);
});

test('not-configured CSV export returns CSV, not JSON', async () => {
  storedPolicy = null;
  const res = await captured['get-compliance-retention-export'](
    makeRequest({ query: { format: 'csv' } }),
    context()
  );
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['Content-Type'], /text\/csv/);
  assert.match(res.body, /^rule_name,enabled,action,retention_days,prefixes/);
  assert.match(res.body, /cold_archive_policy,true,archive,730,class-materials/);
  assert.match(res.body, /generated_at,/);
});

// ── #537: responsable que aprueba + inventario por persona y finalidad ──────

test('#537 — PUT guarda el responsable y la política queda vigente', async () => {
  storedPolicy = null;
  const put = await captured['put-compliance-retention-policy'](
    makeRequest({ method: 'PUT', body: validPolicy({ approvedBy: '  Lucía Fernández (Dirección Académica)  ' }) }),
    context()
  );
  assert.strictEqual(put.status, 200);
  const saved = JSON.parse(put.body);
  assert.strictEqual(saved.approvedBy, 'Lucía Fernández (Dirección Académica)', 'el responsable se persiste sin espacios sobrantes');
  assert.ok(saved.approvedAt, 'se registra cuándo se aprobó');
  assert.strictEqual(saved.effective, true, 'con responsable identificado la política está vigente');

  const get = await captured['get-compliance-retention-policy'](makeRequest({}), context());
  const readback = JSON.parse(get.body);
  assert.strictEqual(readback.approvedBy, 'Lucía Fernández (Dirección Académica)');
  assert.strictEqual(readback.effective, true);
});

test('#537 — una política guardada sin responsable no se declara vigente', async () => {
  storedPolicy = null;
  const put = await captured['put-compliance-retention-policy'](
    makeRequest({ method: 'PUT', body: validPolicy() }),
    context()
  );
  const body = JSON.parse(put.body);
  assert.strictEqual(body.configured, true);
  assert.strictEqual(body.approvedBy, null);
  assert.strictEqual(body.approvedAt, null);
  assert.strictEqual(body.effective, false, 'sin responsable no hay aprobación que sostenga el "Vigente"');
});

test('#537 — editar un período no borra el responsable ya declarado', async () => {
  storedPolicy = {
    ...validPolicy(),
    rules: [],
    softDeleteDays: 7,
    approvedBy: 'Lucía Fernández',
    approvedAt: '2026-09-01T10:00:00.000Z',
  };
  const put = await captured['put-compliance-retention-policy'](
    makeRequest({ method: 'PUT', body: validPolicy({ deleteDays: 1200 }) }),
    context()
  );
  const body = JSON.parse(put.body);
  assert.strictEqual(body.deleteDays, 1200);
  assert.strictEqual(body.approvedBy, 'Lucía Fernández');
  assert.strictEqual(body.approvedAt, '2026-09-01T10:00:00.000Z', 'la fecha de aprobación original se conserva');
  assert.strictEqual(body.effective, true);
});

test('#537 — la ruta del inventario de datos está registrada', () => {
  assert.strictEqual(typeof captured['get-compliance-data-inventory'], 'function');
});

test('#537 — el inventario nombra a la persona, la finalidad y el almacén de cada dato', async () => {
  storedPolicy = null;
  const res = await captured['get-compliance-data-inventory'](makeRequest({}), context());
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.configured, false);
  assert.strictEqual(body.effective, false);
  assert.strictEqual(body.responsable.approvedBy, null);
  assert.match(body.note, /no configurada/i);
  assert.ok(body.categories.length >= 6, 'el inventario declara las categorías de datos personales');
  for (const row of body.categories) {
    assert.ok(row.persona, `la categoría ${row.id} dice de quién es el dato`);
    assert.ok(row.finalidad, `la categoría ${row.id} declara finalidad`);
    assert.ok(row.donde, `la categoría ${row.id} nombra el almacén real`);
    assert.ok(row.queSeGuarda, `la categoría ${row.id} dice qué se guarda`);
    assert.ok(['vigente', 'pendiente', 'sin-plazo'].includes(row.estado));
  }
  assert.ok(!body.categories.some((r) => r.estado === 'vigente'), 'sin política aprobada no hay plazos vigentes');
  const sinPlazo = body.categories.filter((r) => !r.cubierto);
  assert.ok(sinPlazo.length >= 1, 'los datos que la política no cubre se informan como hueco');
  for (const row of sinPlazo) {
    assert.strictEqual(row.periodoDias, null, `no se le inventa un plazo a ${row.id}`);
    assert.strictEqual(row.estado, 'sin-plazo');
  }
});

test('#537 — el inventario resuelve los plazos contra la política aprobada', async () => {
  storedPolicy = {
    ...validPolicy({ archiveDays: 400, deleteDays: 900 }),
    rules: [],
    softDeleteDays: 7,
    approvedBy: 'Lucía Fernández',
    approvedAt: '2026-09-01T10:00:00.000Z',
  };
  const res = await captured['get-compliance-data-inventory'](makeRequest({}), context());
  const body = JSON.parse(res.body);
  assert.strictEqual(body.effective, true);
  assert.strictEqual(body.responsable.approvedBy, 'Lucía Fernández');
  const transcripciones = body.categories.find((r) => r.id === 'transcripciones');
  assert.strictEqual(transcripciones.periodoDias, 400, 'usa archiveDays de la política, no un valor fijo');
  assert.strictEqual(transcripciones.estado, 'vigente');
  const chat = body.categories.find((r) => r.id === 'conversaciones');
  assert.strictEqual(chat.periodoDias, 900, 'usa deleteDays de la política');
  assert.strictEqual(body.totals.sinPlazo, body.categories.filter((r) => !r.cubierto).length);
  assert.strictEqual(body.totals.cubiertas + body.totals.sinPlazo, body.categories.length);
});

test('#537 — el inventario rechaza a quien no tiene rol de cumplimiento', async () => {
  authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'alu-003', userRoles: ['Student'] }));
  try {
    const res = await captured['get-compliance-data-inventory'](makeRequest({}), context());
    assert.strictEqual(res.status, 403);
  } finally {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'test-admin', userRoles: ['Director'] }));
  }
});
