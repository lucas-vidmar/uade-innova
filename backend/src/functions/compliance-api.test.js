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
