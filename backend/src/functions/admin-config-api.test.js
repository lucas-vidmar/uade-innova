import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// In-memory Table Storage stand-in, wired through the real admin-settings
// service so validation + persistence run end-to-end through the handler.
const table = new Map();
const fakeClient = {
  async createTable() {},
  async getEntity(partitionKey, rowKey) {
    const entity = table.get(`${partitionKey}/${rowKey}`);
    if (!entity) {
      const err = new Error('NotFound');
      err.statusCode = 404;
      throw err;
    }
    return { ...entity };
  },
  async upsertEntity(entity) {
    table.set(`${entity.partitionKey}/${entity.rowKey}`, { ...entity });
  },
  async deleteEntity(partitionKey, rowKey) {
    table.delete(`${partitionKey}/${rowKey}`);
  },
};

const authUtilsMocks = {
  validateFrontDoorId: mock.fn(() => true),
  setStashedIdentity: mock.fn(() => {}),
  parseClientPrincipal: mock.fn(() => ({ userId: 'test-admin', userRoles: ['Director'] })),
  getAuthenticatedUser: mock.fn(() => ({ userId: 'test-admin', sanitizedId: 'test_admin', role: 'Admin' })),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', {
  namedExports: {
    getTableClient: mock.fn(() => fakeClient),
  },
});

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

await import('./admin-config-api.js');

function makeRequest({ method = 'GET', params = {}, body = null } = {}) {
  return {
    method,
    params,
    headers: { get: () => null },
    query: { get: () => null },
    json: async () => body,
  };
}

function context() {
  return { log: () => {}, error: () => {}, info: () => {} };
}

function validTech(overrides = {}) {
  return { retentionDays: 90, maxFileSizeMb: 50, autoCleanup: true, optimizeImages: true, ...overrides };
}

test('admin-config routes are registered', () => {
  assert.strictEqual(typeof captured['admin-config-get'], 'function');
  assert.strictEqual(typeof captured['admin-config-put'], 'function');
  assert.strictEqual(typeof captured['admin-config-delete'], 'function');
});

test('GET returns persisted values or defaults', async (t) => {
  await t.test('returns defaults when nothing persisted', async () => {
    table.clear();
    const res = await captured['admin-config-get'](makeRequest({ params: { scope: 'technical' } }), context());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.defaults, true);
    assert.strictEqual(body.data.retentionDays, 90);
    assert.strictEqual(body.data.maxFileSizeMb, 50);
  });

  await t.test('returns persisted values after a PUT (readback path)', async () => {
    table.clear();
    await captured['admin-config-put'](
      makeRequest({ method: 'PUT', params: { scope: 'technical' }, body: validTech({ retentionDays: 120 }) }),
      context()
    );
    const res = await captured['admin-config-get'](makeRequest({ params: { scope: 'technical' } }), context());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.defaults, false);
    assert.strictEqual(body.data.retentionDays, 120);
  });

  await t.test('rejects unknown scope with 400', async () => {
    table.clear();
    const res = await captured['admin-config-get'](makeRequest({ params: { scope: 'retention' } }), context());
    assert.strictEqual(res.status, 400);
  });
});

test('PUT persists and returns readback', async () => {
  table.clear();
  const res = await captured['admin-config-put'](
    makeRequest({ method: 'PUT', params: { scope: 'model' }, body: { model: 'deepseek-v4-flash', temperature: 0.7, maxTokens: 4096, topP: 0.9 } }),
    context()
  );
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.defaults, false);
  assert.strictEqual(body.data.temperature, 0.7);
  assert.strictEqual(body.data.maxTokens, 4096);
  assert.strictEqual(body.updatedBy, 'test-admin');
  assert.ok(body.updatedAt);

  // Persisted in the table source of truth.
  const entity = table.get('model/config');
  assert.ok(entity);
  assert.strictEqual(entity.maxTokens, 4096);
});

test('PUT returns 400 on invalid config', async () => {
  table.clear();
  const res = await captured['admin-config-put'](
    makeRequest({ method: 'PUT', params: { scope: 'technical' }, body: validTech({ retentionDays: 0 }) }),
    context()
  );
  assert.strictEqual(res.status, 400);
  const body = JSON.parse(res.body);
  assert.match(body.error, /retentionDays debe ser un número entre 1 y 365/);
  assert.strictEqual(table.size, 0, 'nothing persisted on validation failure');
});

test('PUT returns 400 on invalid model config', async () => {
  table.clear();
  const res = await captured['admin-config-put'](
    makeRequest({ method: 'PUT', params: { scope: 'model' }, body: { model: 'deepseek-v4-flash', temperature: 2, maxTokens: 2048, topP: 0.9 } }),
    context()
  );
  assert.strictEqual(res.status, 400);
  assert.match(JSON.parse(res.body).error, /temperature debe ser un número entre 0 y 1/);
});

test('PUT returns 500 (not 400) on storage failure without leaking SDK errors', async () => {
  table.clear();
  const originalUpsert = fakeClient.upsertEntity;
  fakeClient.upsertEntity = async () => { throw new Error('RestError: TableServiceError 500 The specified resource is locked'); };
  try {
    const res = await captured['admin-config-put'](
      makeRequest({ method: 'PUT', params: { scope: 'technical' }, body: validTech() }),
      context()
    );
    assert.strictEqual(res.status, 500);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, 'Error al guardar la configuración.');
    assert.ok(!res.body.includes('RestError'), 'raw SDK error must not leak to the client');
  } finally {
    fakeClient.upsertEntity = originalUpsert;
  }
});

test('DELETE returns 400 for invalid scope instead of 500', async () => {
  table.clear();
  const res = await captured['admin-config-delete'](
    makeRequest({ method: 'DELETE', params: { scope: 'retention' } }),
    context()
  );
  assert.strictEqual(res.status, 400);
  assert.match(JSON.parse(res.body).error, /Scope inválido/);
});

test('DELETE resets to defaults', async () => {
  table.clear();
  await captured['admin-config-put'](
    makeRequest({ method: 'PUT', params: { scope: 'technical' }, body: validTech({ retentionDays: 200 }) }),
    context()
  );
  const res = await captured['admin-config-delete'](makeRequest({ method: 'DELETE', params: { scope: 'technical' } }), context());
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.defaults, true);
  assert.strictEqual(body.data.retentionDays, 90);
  assert.strictEqual(table.has('technical/config'), false);
});
