import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let storedPolicy = null;
let deletionRecords = {};
const containerState = {}; // nombre de contenedor -> nombres de blobs
const storageMocks = {
  loadJson: mock.fn(async (container, blob) => {
    if (typeof blob === 'string' && blob.startsWith('deletions/')) {
      return deletionRecords[blob] || null;
    }
    return storedPolicy;
  }),
  saveJson: mock.fn(async (container, blob, data) => {
    if (typeof blob === 'string' && blob.startsWith('deletions/')) {
      deletionRecords[blob] = data;
      return;
    }
    storedPolicy = { ...data };
  }),
  listBlobs: mock.fn(async (container, prefix = '') => Object.keys(deletionRecords).filter((name) => name.startsWith(prefix))),
  getClient: mock.fn(() => ({
    getContainerClient: (container) => ({
      exists: async () => container in containerState,
      listBlobsFlat: (options = {}) => (async function* () {
        for (const name of containerState[container] || []) {
          if (!options.prefix || name.startsWith(options.prefix)) yield { name };
        }
      })(),
    }),
  })),
  // telemetry -> safety-rate transitively imports getTableClient from storage.
  getTableClient: mock.fn(() => ({
    createTable: async () => {},
    getEntity: async () => { throw Object.assign(new Error('NotFound'), { statusCode: 404 }); },
    upsertEntity: async () => {},
  })),
};

const stateStoreMocks = {
  getMaterialStateById: mock.fn(async () => null),
};

const authUtilsMocks = {
  validateFrontDoorId: mock.fn(() => true),
  setStashedIdentity: mock.fn(() => {}),
  parseClientPrincipal: mock.fn(() => ({ userId: 'test-admin', userRoles: ['Director'] })),
};

mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });

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

function makeRequest({ method = 'GET', body = null, query = {}, params = {} } = {}) {
  return {
    method,
    params,
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

// ── Constancias de borrado de material (#538, UJ-56 pasos 4, 7 y 9) ────────

const MATERIAL_ID = '48f711e9-3f75-4429-a67c-a422798e4157';

function seedDeletionRecord(overrides = {}) {
  const recordId = '20261019T224710610-48f711e93f754429a67ca422798e4157-abc123';
  const record = {
    recordId,
    action: 'material-delete',
    requestedAt: '2026-10-19T22:47:10.610Z',
    completedAt: '2026-10-19T22:47:11.000Z',
    outcome: 'deleted',
    actor: { id: 'adm-001', email: 'admin@uade.edu.ar', roles: ['authenticated', 'Admin'] },
    authorization: { basis: 'role', allowedRoles: ['Docente', 'Director', 'Admin'], actorRoles: ['authenticated', 'Admin'] },
    target: { materialId: MATERIAL_ID, subjectId: 'arq-software-2026', filename: 'rv3-538.txt', materialType: 'notes', classIds: ['class-01'] },
    scope: {
      blobsMoved: [`deleted/arq-software-2026/${MATERIAL_ID}.txt`, `deleted/${MATERIAL_ID}.json`],
      chunkCount: 1,
      vectorsDeleted: true,
      stateDeleted: true,
      quotaReleased: true,
      errors: [],
    },
    retention: { container: 'deleted', declaredDays: 7, containerPurgeDays: 30 },
    correlationId: 'corr-538',
    version: 1,
  };
  const stored = { ...record, ...overrides };
  deletionRecords[`deletions/${stored.recordId}.json`] = stored;
  return stored.recordId;
}

function resetDeletionFixtures() {
  deletionRecords = {};
  for (const key of Object.keys(containerState)) delete containerState[key];
}

test('las rutas de constancias de borrado quedan registradas', () => {
  assert.strictEqual(typeof captured['get-compliance-deletion-records'], 'function');
  assert.strictEqual(typeof captured['get-compliance-deletion-record'], 'function');
  assert.strictEqual(typeof captured['get-compliance-deletion-record-verification'], 'function');
});

test('GET deletion-records lista la constancia con su alcance y responsable', async () => {
  resetDeletionFixtures();
  storedPolicy = { ...validPolicy(), rules: [], softDeleteDays: 7 };
  seedDeletionRecord();

  const res = await captured['get-compliance-deletion-records'](makeRequest({}), context());
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.count, 1);
  const [record] = body.records;
  assert.strictEqual(record.target.materialId, MATERIAL_ID);
  assert.strictEqual(record.actor.id, 'adm-001');
  assert.deepStrictEqual(record.authorization.allowedRoles, ['Docente', 'Director', 'Admin']);
  assert.deepStrictEqual(record.scope.blobsMoved, [`deleted/arq-software-2026/${MATERIAL_ID}.txt`, `deleted/${MATERIAL_ID}.json`]);
  assert.strictEqual(record.outcome, 'deleted');
  assert.ok(record.requestedAt);
  // La política vigente y el plazo real del depósito frío viajan con la lista.
  assert.strictEqual(body.policy.softDeleteDays, 7);
  assert.strictEqual(body.policy.deletedContainerPurgeDays, 30);
});

test('GET deletion-records filtra por material y respeta el límite', async () => {
  resetDeletionFixtures();
  seedDeletionRecord();
  seedDeletionRecord({ recordId: '20261019T224710611-otro-abc124', target: { materialId: 'otro-material', subjectId: 'arq-software-2026' } });

  const res = await captured['get-compliance-deletion-records'](
    makeRequest({ query: { materialId: MATERIAL_ID } }),
    context()
  );
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.count, 1);
  assert.strictEqual(body.records[0].target.materialId, MATERIAL_ID);
});

test('GET deletion-records exige rol de cumplimiento (Admin/Director/Security)', async () => {
  resetDeletionFixtures();
  seedDeletionRecord();
  const prev = authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'prof-001', userRoles: ['Docente'] }));
  const res = await captured['get-compliance-deletion-records'](makeRequest({}), context());
  assert.strictEqual(res.status, 403);
  authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'test-admin', userRoles: ['Director'] }));
});

test('GET deletion-records/{id} devuelve la constancia, 404 si no existe y 400 si el id no es válido', async () => {
  resetDeletionFixtures();
  const recordId = seedDeletionRecord();

  const ok = await captured['get-compliance-deletion-record'](makeRequest({ params: { recordId } }), context());
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(JSON.parse(ok.body).recordId, recordId);

  const missing = await captured['get-compliance-deletion-record'](
    makeRequest({ params: { recordId: '20990101T000000000-inexistente-zzz999' } }),
    context()
  );
  assert.strictEqual(missing.status, 404);

  const invalid = await captured['get-compliance-deletion-record'](makeRequest({ params: { recordId: '../retention-policy' } }), context());
  assert.strictEqual(invalid.status, 400);
});

test('la comprobación reporta el residuo soft-borrado y el desvío de plazo', async () => {
  resetDeletionFixtures();
  const recordId = seedDeletionRecord();
  containerState['class-materials'] = ['arq-software-2026/otro-material.txt'];
  containerState.processed = [];
  containerState.deleted = [`arq-software-2026/${MATERIAL_ID}.txt`, `${MATERIAL_ID}.json`];

  const res = await captured['get-compliance-deletion-record-verification'](makeRequest({ params: { recordId } }), context());
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  const { verificacion } = body;
  assert.strictEqual(verificacion.verdict, 'residuo-soft-delete');
  assert.strictEqual(verificacion.materialEnInventario.presente, false);
  assert.deepStrictEqual(verificacion.contenedores.deleted.copias, [`arq-software-2026/${MATERIAL_ID}.txt`, `${MATERIAL_ID}.json`]);
  assert.deepStrictEqual(verificacion.contenedores['class-materials'].copias, []);
  // El residuo se declara: 30 días de vida en `deleted/` frente a 7 de política.
  assert.strictEqual(verificacion.retencion.diasDeclaradosPorPolitica, 7);
  assert.strictEqual(verificacion.retencion.diasDeVidaEnDepositoFrio, 30);
  assert.strictEqual(verificacion.retencion.excedeLaPolitica, true);
  assert.deepStrictEqual(verificacion.alcanceEsperado, body.constancia.scope.blobsMoved);
});

test('la comprobación detecta una copia viva en el acervo principal', async () => {
  resetDeletionFixtures();
  const recordId = seedDeletionRecord();
  containerState['class-materials'] = [`arq-software-2026/${MATERIAL_ID}.txt`];
  containerState.processed = [];
  containerState.deleted = [];

  const res = await captured['get-compliance-deletion-record-verification'](makeRequest({ params: { recordId } }), context());
  const { verificacion } = JSON.parse(res.body);
  assert.strictEqual(verificacion.verdict, 'copia-viva');
  assert.deepStrictEqual(verificacion.contenedores['class-materials'].copias, [`arq-software-2026/${MATERIAL_ID}.txt`]);
});

test('la comprobación detecta que el material sigue vivo en el inventario', async () => {
  resetDeletionFixtures();
  const recordId = seedDeletionRecord();
  containerState['class-materials'] = [];
  containerState.processed = [];
  containerState.deleted = [];
  stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => ({ materialId: MATERIAL_ID, status: 'ready' }));

  const res = await captured['get-compliance-deletion-record-verification'](makeRequest({ params: { recordId } }), context());
  const { verificacion } = JSON.parse(res.body);
  assert.strictEqual(verificacion.verdict, 'material-vivo');
  assert.strictEqual(verificacion.materialEnInventario.status, 'ready');
  stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => null);
});
