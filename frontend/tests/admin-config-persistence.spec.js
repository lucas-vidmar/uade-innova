import { test, expect } from '@playwright/test';

// Story 10.19 — Admin Configuration Persistence with Readback (QA-005/006/012)
// These specs mock the backend API routes so they are deterministic and never
// touch the production configuration store.
test.use({ channel: 'chrome' });

const DEFAULT_TECH = {
  retentionDays: 90,
  containerName: 'class-materials',
  maxFileSizeMb: 50,
  autoCleanup: true,
  optimizeImages: true,
};

const DEFAULT_MODEL = {
  model: 'deepseek-v4-flash',
  temperature: 0.3,
  maxTokens: 2048,
  topP: 0.95,
  embeddingModel: 'text-embedding-3-small',
};

const DEFAULT_RETENTION = {
  archiveEnabled: true,
  archiveDays: 730,
  deleteEnabled: true,
  deleteDays: 1095,
  notifyTeachers: true,
  autoDelete: true,
};

function bootMock(page) {
  return page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'true');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'admin');
    sessionStorage.setItem('edu_logged_in', 'true');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });
}

async function setupApiMock(page, state = {}) {
  const store = {
    technical: state.technical ?? null,
    model: state.model ?? null,
    retention: state.retention ?? null,
    retentionServerError: state.retentionServerError ?? null,
  };

  await page.route('**/.auth/me', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('config/technical')) {
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: store.technical || DEFAULT_TECH, defaults: !store.technical, updatedAt: store.technical ? '2026-01-01T00:00:00.000Z' : null }) });
      } else if (method === 'PUT') {
        store.technical = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: store.technical, defaults: false, updatedAt: '2026-01-01T00:00:00.000Z' }) });
      } else if (method === 'DELETE') {
        store.technical = null;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: DEFAULT_TECH, defaults: true, updatedAt: null }) });
      } else {
        await route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
      }
      return;
    }

    if (url.includes('config/model')) {
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: store.model || DEFAULT_MODEL, defaults: !store.model, updatedAt: store.model ? '2026-01-01T00:00:00.000Z' : null }) });
      } else if (method === 'PUT') {
        store.model = { ...DEFAULT_MODEL, ...route.request().postDataJSON() };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: store.model, defaults: false, updatedAt: '2026-01-01T00:00:00.000Z' }) });
      } else if (method === 'DELETE') {
        store.model = null;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: DEFAULT_MODEL, defaults: true, updatedAt: null }) });
      } else {
        await route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
      }
      return;
    }

    if (url.includes('/compliance/retention-policy')) {
      if (method === 'GET') {
        const policy = { ...DEFAULT_RETENTION, ...(store.retention || {}), rules: [], softDeleteDays: 7 };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...policy, configured: !!store.retention }) });
      } else if (method === 'PUT') {
        if (store.retentionServerError) {
          await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: store.retentionServerError }) });
          return;
        }
        store.retention = { ...DEFAULT_RETENTION, ...route.request().postDataJSON() };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...store.retention, configured: true, softDeleteDays: 7, rules: [] }) });
      } else {
        await route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
      }
      return;
    }

    if (url.includes('/compliance/retention-export')) {
      await route.fulfill({ status: 200, contentType: 'text/csv', body: 'rule_name,enabled,action,retention_days\n' });
      return;
    }

    // Silent fallback for the remaining boot-time API calls (profile, subjects,
    // notifications, material-status, classes, ...).
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return store;
}

test('technical settings save, read back and survive reload', async ({ page }) => {
  await bootMock(page);
  await setupApiMock(page);
  await page.goto('/#/admin/settings');

  await expect(page.locator('#setting-retention-days')).toHaveValue('90');

  await page.fill('#setting-retention-days', '120');
  await page.fill('#setting-max-file-size', '75');
  await page.click('#btn-settings-save');

  await expect(page.locator('#setting-retention-days')).toHaveValue('120');
  await expect(page.locator('#setting-max-file-size')).toHaveValue('75');

  await page.reload();
  await expect(page.locator('#setting-retention-days')).toHaveValue('120');
  await expect(page.locator('#setting-max-file-size')).toHaveValue('75');
});

test('model config saves, read back and survive reload', async ({ page }) => {
  await bootMock(page);
  await setupApiMock(page);
  await page.goto('/#/admin/model-config');

  await expect(page.locator('#setting-temperature')).toHaveValue('0.3');
  await expect(page.locator('#setting-max-tokens')).toHaveValue('2048');

  await page.locator('#setting-temperature').fill('0.7');
  await page.fill('#setting-max-tokens', '4096');
  await page.click('#btn-model-save');

  await expect(page.locator('#temperature-value')).toHaveText('0.7');
  await expect(page.locator('#setting-max-tokens')).toHaveValue('4096');

  await page.reload();
  await expect(page.locator('#setting-temperature')).toHaveValue('0.7');
  await expect(page.locator('#setting-max-tokens')).toHaveValue('4096');
});

test('persisted gpt-4o-mini model is not silently reverted on save (#318)', async ({ page }) => {
  await bootMock(page);
  const store = await setupApiMock(page, {
    model: { model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 2048, topP: 0.95, embeddingModel: 'text-embedding-3-small' },
  });
  await page.goto('/#/admin/model-config');

  // #318 removed the disabled gpt-4o-mini prototype radio: only deepseek is
  // selectable, and it renders unchecked when the persisted model is gpt.
  const deepseekRadio = page.locator('input[name="ai-model"][value="deepseek-v4-flash"]');
  await expect(deepseekRadio).toBeVisible();
  await expect(deepseekRadio).not.toBeChecked();
  await expect(page.locator('input[name="ai-model"][value="gpt-4o-mini"]')).toHaveCount(0);

  // Save must keep gpt-4o-mini (readValues falls back to config.model) instead
  // of silently reverting to the hardcoded deepseek default.
  await page.click('#btn-model-save');
  await expect(page.locator('text=Configuración guardada').first()).toBeVisible();
  expect(store.model.model).toBe('gpt-4o-mini');
});

test('retention policy saves, read back and survive reload', async ({ page }) => {
  await bootMock(page);
  await setupApiMock(page);
  await page.goto('/#/admin/retention');

  await expect(page.locator('#retention-cold-days')).toHaveValue('730');
  await expect(page.locator('#retention-delete-days')).toHaveValue('1095');

  await page.fill('#retention-cold-days', '365');
  await page.fill('#retention-delete-days', '730');
  await page.click('#btn-retention-save');

  await expect(page.locator('#retention-cold-days')).toHaveValue('365');
  await expect(page.locator('#retention-delete-days')).toHaveValue('730');

  await page.reload();
  await expect(page.locator('#retention-cold-days')).toHaveValue('365');
  await expect(page.locator('#retention-delete-days')).toHaveValue('730');
});

test('rejects deleteDays <= archiveDays when archive is enabled (client-side AC #2)', async ({ page }) => {
  await bootMock(page);
  await setupApiMock(page);
  await page.goto('/#/admin/retention');

  await page.fill('#retention-delete-days', '365');
  await page.click('#btn-retention-save');

  const error = page.locator('#retention-validation-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('deleteDays (365) debe ser mayor que archiveDays (730)');
  await expect(page.locator('#retention-delete-days')).toHaveValue('365');
});

test('surfaces server-side 400 message on retention save', async ({ page }) => {
  await bootMock(page);
  await setupApiMock(page, {
    retentionServerError: 'deleteDays (730) debe ser mayor que archiveDays (365) cuando el archivado está habilitado.',
  });
  await page.goto('/#/admin/retention');

  // Client-valid (730 > 365) but the server rejects -> message must surface.
  await page.fill('#retention-cold-days', '365');
  await page.fill('#retention-delete-days', '730');
  await page.click('#btn-retention-save');

  const error = page.locator('#retention-validation-error');
  await expect(error).toBeVisible();
  await expect(error).toContainText('debe ser mayor que archiveDays');
});

test('non-persistent controls are disabled or labeled prototype (AC #3)', async ({ page }) => {
  await bootMock(page);
  await setupApiMock(page);
  await page.goto('/#/admin/settings');

  await expect(page.locator('#setting-container-name')).toBeDisabled();
  await expect(page.locator('#setting-api-url')).toBeDisabled();

  await page.goto('/#/admin/model-config');
  // #318 removed the gpt-4o-mini prototype radio: the non-persistent control
  // is now the fixed embeddings model, labeled "Prototipo · Fijo".
  await expect(page.locator('input[name="ai-model"][value="gpt-4o-mini"]')).toHaveCount(0);
  await expect(page.locator('#model-gpt')).toHaveCount(0);
  await expect(page.getByText('Prototipo · Fijo')).toBeVisible();
});

test('settings page shows effective BASE_URL, not window.location.origin (AC #4)', async ({ page }) => {
  await bootMock(page);
  await setupApiMock(page);
  await page.goto('/#/admin/settings');

  const origin = new URL(page.url()).origin;
  const apiUrl = await page.locator('#setting-api-url').inputValue();
  expect(apiUrl).toBeTruthy();
  expect(apiUrl).not.toContain(origin);
  expect(apiUrl).toContain('api');
});
