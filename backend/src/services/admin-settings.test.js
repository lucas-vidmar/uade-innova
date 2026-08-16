import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// In-memory Table Storage stand-in so the service can be exercised without Azurite.
const table = new Map();

const fakeClient = {
  async createTable() {},
  async getEntity(partitionKey, rowKey) {
    const key = `${partitionKey}/${rowKey}`;
    const entity = table.get(key);
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

mock.module('./storage.js', {
  namedExports: {
    getTableClient: mock.fn(() => fakeClient),
  },
});

const {
  DEFAULT_TECH_SETTINGS,
  DEFAULT_MODEL_CONFIG,
  DEFAULT_RETENTION_POLICY,
  validateTechSettings,
  validateModelConfig,
  validateRetentionPolicy,
  mergeWithDefaults,
  getAdminSettings,
  upsertAdminSettings,
  resetAdminSettings,
} = await import('./admin-settings.js');

function validTech(overrides = {}) {
  return { retentionDays: 90, maxFileSizeMb: 50, autoCleanup: true, optimizeImages: true, ...overrides };
}

function validModel(overrides = {}) {
  return { model: 'deepseek-v4-flash', temperature: 0.3, maxTokens: 2048, topP: 0.95, ...overrides };
}

function validPolicy(overrides = {}) {
  return { archiveEnabled: true, archiveDays: 730, deleteEnabled: true, deleteDays: 1095, notifyTeachers: true, autoDelete: true, ...overrides };
}

test('validateTechSettings bounds', async (t) => {
  await t.test('accepts valid settings', () => {
    assert.deepStrictEqual(validateTechSettings(validTech()).valid, true);
    assert.deepStrictEqual(validateTechSettings(validTech({ retentionDays: 1 })).valid, true);
    assert.deepStrictEqual(validateTechSettings(validTech({ retentionDays: 365 })).valid, true);
    assert.deepStrictEqual(validateTechSettings(validTech({ maxFileSizeMb: 1 })).valid, true);
    assert.deepStrictEqual(validateTechSettings(validTech({ maxFileSizeMb: 500 })).valid, true);
  });

  await t.test('rejects retentionDays out of bounds', () => {
    assert.deepStrictEqual(validateTechSettings(validTech({ retentionDays: 0 })).valid, false);
    assert.deepStrictEqual(validateTechSettings(validTech({ retentionDays: 366 })).valid, false);
    assert.deepStrictEqual(validateTechSettings(validTech({ retentionDays: 'x' })).valid, false);
  });

  await t.test('rejects maxFileSizeMb out of bounds', () => {
    assert.deepStrictEqual(validateTechSettings(validTech({ maxFileSizeMb: 0 })).valid, false);
    assert.deepStrictEqual(validateTechSettings(validTech({ maxFileSizeMb: 501 })).valid, false);
  });

  await t.test('rejects non-boolean flags', () => {
    assert.deepStrictEqual(validateTechSettings(validTech({ autoCleanup: 'yes' })).valid, false);
    assert.deepStrictEqual(validateTechSettings(validTech({ optimizeImages: 1 })).valid, false);
  });

  await t.test('rejects booleans/arrays/nulls for numeric fields', () => {
    assert.deepStrictEqual(validateTechSettings(validTech({ retentionDays: true })).valid, false);
    assert.deepStrictEqual(validateTechSettings(validTech({ retentionDays: [90] })).valid, false);
    assert.deepStrictEqual(validateTechSettings(validTech({ maxFileSizeMb: null })).valid, false);
    assert.deepStrictEqual(validateTechSettings(validTech({ maxFileSizeMb: '50' })).valid, true, 'numeric strings are accepted');
  });

  await t.test('rejects missing fields', () => {
    const { retentionDays, ...missing } = validTech();
    assert.deepStrictEqual(validateTechSettings(missing).valid, false);
  });

  await t.test('rejects non-object payloads', () => {
    assert.deepStrictEqual(validateTechSettings(null).valid, false);
    assert.deepStrictEqual(validateTechSettings([]).valid, false);
  });
});

test('validateModelConfig bounds', async (t) => {
  await t.test('accepts valid model config', () => {
    assert.deepStrictEqual(validateModelConfig(validModel()).valid, true);
    assert.deepStrictEqual(validateModelConfig(validModel({ model: 'gpt-4o-mini' })).valid, true);
    assert.deepStrictEqual(validateModelConfig(validModel({ temperature: 0 })).valid, true);
    assert.deepStrictEqual(validateModelConfig(validModel({ temperature: 1 })).valid, true);
    assert.deepStrictEqual(validateModelConfig(validModel({ maxTokens: 256 })).valid, true);
    assert.deepStrictEqual(validateModelConfig(validModel({ maxTokens: 8192 })).valid, true);
  });

  await t.test('rejects model outside allowed set', () => {
    const result = validateModelConfig(validModel({ model: 'gpt-5' }));
    assert.deepStrictEqual(result.valid, false);
    assert.match(result.error, /Modelo inválido/);
  });

  await t.test('rejects temperature/topP outside 0-1', () => {
    assert.deepStrictEqual(validateModelConfig(validModel({ temperature: -0.1 })).valid, false);
    assert.deepStrictEqual(validateModelConfig(validModel({ temperature: 1.1 })).valid, false);
    assert.deepStrictEqual(validateModelConfig(validModel({ topP: 1.01 })).valid, false);
  });

  await t.test('rejects non-numeric types for numeric fields', () => {
    assert.deepStrictEqual(validateModelConfig(validModel({ temperature: false })).valid, false);
    assert.deepStrictEqual(validateModelConfig(validModel({ temperature: [0.3] })).valid, false);
    assert.deepStrictEqual(validateModelConfig(validModel({ maxTokens: '2048' })).valid, true, 'numeric strings are accepted');
  });

  await t.test('rejects maxTokens outside 256-8192', () => {
    assert.deepStrictEqual(validateModelConfig(validModel({ maxTokens: 255 })).valid, false);
    assert.deepStrictEqual(validateModelConfig(validModel({ maxTokens: 8193 })).valid, false);
  });

  await t.test('rejects missing fields', () => {
    const { temperature, ...missing } = validModel();
    assert.deepStrictEqual(validateModelConfig(missing).valid, false);
  });
});

test('validateRetentionPolicy cross-field rule (AC #2)', async (t) => {
  await t.test('rejects deleteDays <= archiveDays when archiveEnabled', () => {
    const result = validateRetentionPolicy(validPolicy({ deleteDays: 365 }));
    assert.deepStrictEqual(result.valid, false);
    assert.match(result.error, /deleteDays \(365\) debe ser mayor que archiveDays \(730\)/);
  });

  await t.test('rejects deleteDays === archiveDays when archiveEnabled', () => {
    assert.deepStrictEqual(validateRetentionPolicy(validPolicy({ deleteDays: 730 })).valid, false);
  });

  await t.test('accepts deleteDays > archiveDays', () => {
    const result = validateRetentionPolicy(validPolicy({ deleteDays: 1095 }));
    assert.deepStrictEqual(result.valid, true);
    assert.deepStrictEqual(result.error, null);
  });

  await t.test('accepts deleteDays <= archiveDays when archive disabled', () => {
    assert.deepStrictEqual(validateRetentionPolicy(validPolicy({ archiveEnabled: false, deleteDays: 365 })).valid, true);
  });

  await t.test('validates bounds and flags', () => {
    assert.deepStrictEqual(validateRetentionPolicy(validPolicy({ archiveDays: 0 })).valid, false);
    assert.deepStrictEqual(validateRetentionPolicy(validPolicy({ deleteDays: 3651 })).valid, false);
    assert.deepStrictEqual(validateRetentionPolicy(validPolicy({ autoDelete: 'x' })).valid, false);
    const { deleteDays, ...missing } = validPolicy();
    assert.deepStrictEqual(validateRetentionPolicy(missing).valid, false);
  });
});

test('mergeWithDefaults overlays custom over defaults', async (t) => {
  await t.test('merges technical partial over defaults', () => {
    const merged = mergeWithDefaults('technical', { retentionDays: 120 });
    assert.equal(merged.retentionDays, 120);
    assert.equal(merged.maxFileSizeMb, DEFAULT_TECH_SETTINGS.maxFileSizeMb);
    assert.equal(merged.autoCleanup, true);
  });

  await t.test('merges model partial over defaults', () => {
    const merged = mergeWithDefaults('model', { temperature: 0.7 });
    assert.equal(merged.temperature, 0.7);
    assert.equal(merged.model, DEFAULT_MODEL_CONFIG.model);
    assert.equal(merged.maxTokens, DEFAULT_MODEL_CONFIG.maxTokens);
  });

  await t.test('returns full defaults for null/missing custom', () => {
    assert.deepStrictEqual(mergeWithDefaults('technical', null), DEFAULT_TECH_SETTINGS);
    assert.deepStrictEqual(mergeWithDefaults('model', {}), DEFAULT_MODEL_CONFIG);
  });

  await t.test('returns null for unknown scope', () => {
    assert.equal(mergeWithDefaults('retention', {}), null);
  });
});

test('upsertAdminSettings persists and returns readback', async (t) => {
  await t.test('persists valid technical config with audit fields', async () => {
    table.clear();
    const result = await upsertAdminSettings('technical', validTech({ retentionDays: 120 }), 'adm-001');
    assert.equal(result.defaults, false);
    assert.equal(result.data.retentionDays, 120);
    assert.equal(result.updatedBy, 'adm-001');
    assert.ok(result.updatedAt);

    const stored = await getAdminSettings('technical');
    assert.equal(stored.defaults, false);
    assert.equal(stored.data.retentionDays, 120);
    assert.equal(stored.data.autoCleanup, true);
  });

  await t.test('throws on invalid config (no persistence)', async () => {
    table.clear();
    await assert.rejects(
      () => upsertAdminSettings('technical', validTech({ retentionDays: 0 }), 'adm-001'),
      /retentionDays debe ser un número entre 1 y 365/
    );
    const stored = await getAdminSettings('technical');
    assert.equal(stored.defaults, true);
  });

  await t.test('throws on unknown scope', async () => {
    table.clear();
    await assert.rejects(() => upsertAdminSettings('retention', {}, 'adm-001'), /Scope inválido/);
  });
});

test('getAdminSettings falls back to defaults when empty', async (t) => {
  table.clear();
  const result = await getAdminSettings('technical');
  assert.equal(result.defaults, true);
  assert.deepStrictEqual(result.data, DEFAULT_TECH_SETTINGS);
  assert.equal(result.updatedAt, null);
});

test('getAdminSettings rethrows non-404 read errors', async () => {
  table.clear();
  const originalGetEntity = fakeClient.getEntity;
  fakeClient.getEntity = async () => { throw Object.assign(new Error('storage unavailable'), { statusCode: 500 }); };
  try {
    await assert.rejects(() => getAdminSettings('technical'), /storage unavailable/);
  } finally {
    fakeClient.getEntity = originalGetEntity;
  }
});

test('non-persisted keys are never stored and only shown from defaults (AC #3)', async (t) => {
  await t.test('embeddingModel is stripped from model persistence', async () => {
    table.clear();
    const result = await upsertAdminSettings('model', validModel({ embeddingModel: 'hacked-embed' }), 'adm-001');
    assert.strictEqual(result.data.embeddingModel, DEFAULT_MODEL_CONFIG.embeddingModel, 'display keeps the default embedding model');
    assert.ok(!('embeddingModel' in table.get('model/config')), 'embeddingModel must never be stored');
  });

  await t.test('containerName is stripped from technical persistence', async () => {
    table.clear();
    const result = await upsertAdminSettings('technical', validTech({ containerName: 'hacked-container' }), 'adm-001');
    assert.strictEqual(result.data.containerName, DEFAULT_TECH_SETTINGS.containerName, 'display keeps the default container name');
    assert.ok(!('containerName' in table.get('technical/config')), 'containerName must never be stored');
  });

  await t.test('mergeWithDefaults ignores client-supplied non-persisted keys', () => {
    assert.strictEqual(mergeWithDefaults('model', { embeddingModel: 'hacked' }).embeddingModel, DEFAULT_MODEL_CONFIG.embeddingModel);
    assert.strictEqual(mergeWithDefaults('technical', { containerName: 'hacked' }).containerName, DEFAULT_TECH_SETTINGS.containerName);
  });
});

test('resetAdminSettings restores defaults', async (t) => {
  table.clear();
  await upsertAdminSettings('model', validModel({ temperature: 0.9 }), 'adm-001');
  const result = await resetAdminSettings('model');
  assert.equal(result.defaults, true);
  assert.deepStrictEqual(result.data, DEFAULT_MODEL_CONFIG);
});

test('retention defaults are consistent (QA-006)', () => {
  assert.ok(DEFAULT_RETENTION_POLICY.deleteDays > DEFAULT_RETENTION_POLICY.archiveDays);
  assert.equal(DEFAULT_RETENTION_POLICY.archiveEnabled, true);
});
