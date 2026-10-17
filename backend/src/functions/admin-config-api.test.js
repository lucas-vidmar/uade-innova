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

// El handler informa el motor que efectivamente responde resolviéndolo por el
// mismo camino que el chat RAG. Se mockean para que el test no dependa del
// almacén de prompts ni de credenciales de Azure.
const promptsMocks = {
  resolveRagPrompt: mock.fn(async () => ({ id: 'v1-baseline', content: 'contenido', model: null, source: 'active' })),
};
const aiMocks = {
  resolveModelForTask: mock.fn(async () => 'deepseek-v4-flash'),
  getModelDisplayName: mock.fn((name) => (name === 'deepseek-v4-flash' ? 'DeepSeek-V4.1-Flash' : name)),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/prompts.js', { namedExports: promptsMocks });
mock.module('../services/ai.js', { namedExports: aiMocks });
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

// UJ-55: la superficie tiene que poder distinguir "lo que guardé" de "lo que
// responde", y el registro del cambio (quién/cuándo) no puede perderse.
test('el scope model informa el motor que efectivamente responde', async () => {
  table.clear();
  promptsMocks.resolveRagPrompt.mock.mockImplementation(async () => ({ id: 'v7-propuesta', content: 'x', model: 'gpt-4o-mini', source: 'active' }));
  aiMocks.resolveModelForTask.mock.mockImplementation(async () => 'gpt-4o-mini');
  try {
    const res = await captured['admin-config-get'](makeRequest({ params: { scope: 'model' } }), context());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.effective, 'la respuesta del scope model debe informar el motor vigente');
    assert.strictEqual(body.effective.model, 'gpt-4o-mini');
    assert.strictEqual(body.effective.deployment, 'gpt-4o-mini');
    assert.strictEqual(body.effective.source, 'prompt-version', 'el motor lo fija la versión activa del prompt');
    assert.strictEqual(body.effective.promptVersion, 'v7-propuesta');
  } finally {
    promptsMocks.resolveRagPrompt.mock.mockImplementation(async () => ({ id: 'v1-baseline', content: 'contenido', model: null, source: 'active' }));
    aiMocks.resolveModelForTask.mock.mockImplementation(async () => 'deepseek-v4-flash');
  }
});

test('el motor vigente no depende del valor guardado en el scope model', async () => {
  table.clear();
  const res = await captured['admin-config-put'](
    makeRequest({ method: 'PUT', params: { scope: 'model' }, body: { model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 2048, topP: 0.95 } }),
    context()
  );
  assert.strictEqual(res.status, 200);
  const body = JSON.parse(res.body);
  assert.strictEqual(body.data.model, 'gpt-4o-mini', 'la selección se persiste');
  assert.strictEqual(body.effective.model, 'DeepSeek-V4.1-Flash', 'el motor que responde sigue siendo el que fija el prompt/config, no esta selección');
  assert.strictEqual(body.effective.source, 'default');
  assert.strictEqual(body.updatedBy, 'test-admin', 'el registro del cambio viaja en la misma respuesta');
  assert.ok(body.updatedAt);
});

test('el scope technical no informa motor vigente', async () => {
  table.clear();
  const res = await captured['admin-config-get'](makeRequest({ params: { scope: 'technical' } }), context());
  const body = JSON.parse(res.body);
  assert.strictEqual(body.effective, undefined);
});

test('si la resolución del motor falla, el scope model no rompe la lectura', async () => {
  table.clear();
  promptsMocks.resolveRagPrompt.mock.mockImplementation(async () => { throw new Error('prompt store caído'); });
  aiMocks.resolveModelForTask.mock.mockImplementation(async () => { throw new Error('sin deployment'); });
  try {
    const res = await captured['admin-config-get'](makeRequest({ params: { scope: 'model' } }), context());
    assert.strictEqual(res.status, 200, 'la configuración se sigue leyendo');
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.model, 'deepseek-v4-flash');
    assert.ok(body.effective, 'se informa el motor de configuración como respaldo');
    assert.strictEqual(body.effective.source, 'default');
  } finally {
    promptsMocks.resolveRagPrompt.mock.mockImplementation(async () => ({ id: 'v1-baseline', content: 'contenido', model: null, source: 'active' }));
    aiMocks.resolveModelForTask.mock.mockImplementation(async () => 'deepseek-v4-flash');
  }
});
