import { test, expect } from '@playwright/test';

// #343: la tabla de "Políticas Activas" ya se leía de la API, pero la tarjeta de
// "Cumplimiento Normativo" seguía escrita a mano: fecha de revisión fija
// (01/01/2026) y estado "Vigente" aunque la API respondiera `configured:false`,
// con la vista de Cumplimiento diciendo "No configurado" para la misma política.
// Estos dos casos fijan que la tarjeta y la tabla salgan de la respuesta.

const SUBJECTS = [{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }];

async function mockAdminSession(page, policy) {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
    sessionStorage.setItem('edu_role', 'admin');
    sessionStorage.setItem('edu_uid', 'adm-001');
    sessionStorage.setItem('edu_email', 'admin@uade.edu.ar');
    sessionStorage.setItem('edu_token', 'token-de-prueba');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  await page.route('**/api/subjects**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUBJECTS) });
  });
  await page.route('**/api/compliance/retention-policy**', async (route) => {
    if (route.request().method() === 'PUT') {
      const sent = route.request().postDataJSON() || {};
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...policy, ...sent, configured: true, updatedAt: '2026-10-19T20:00:00.000Z' }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(policy) });
  });
  for (const pattern of ['**/api/notifications**', '**/api/enrollments**', '**/api/reminder-preferences**']) {
    await page.route(pattern, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
  }
}

function complianceCard(page) {
  return page.locator('.card').filter({ hasText: 'Cumplimiento Normativo' });
}

test('la tarjeta de cumplimiento no inventa fecha ni estado cuando la política no está configurada', async ({ page }) => {
  await mockAdminSession(page, {
    configured: false,
    rules: [],
    softDeleteDays: 7,
    archiveEnabled: true,
    archiveDays: 540,
    deleteEnabled: true,
    deleteDays: 1000,
    notifyTeachers: true,
    autoDelete: true,
    updatedAt: null,
    evaluatedAt: '2026-10-19T19:26:25.668Z',
    note: 'Política de retención no configurada — aplican valores por defecto de Azure Storage.',
  });

  await page.goto('/#/admin/retention');
  const card = complianceCard(page);
  const revision = card.locator('p').first();
  await expect(revision).toBeVisible();

  // La constancia sale de la API: el motivo declarado por el servidor…
  await expect(revision).toContainText('no configurada');
  await expect(card.locator('.badge').first()).toHaveText('No configurado');
  // …y ninguna fecha de revisión escrita a mano.
  await expect(revision).not.toContainText('01/01/2026');
  await expect(revision).not.toContainText('Última revisión');
  await expect(page.locator('#page-content')).not.toContainText('01/01/2026');

  // La tabla también sigue a la API (540 y 1000 no son ninguno de los defaults).
  const filas = page.locator('.data-table tbody tr');
  await expect(filas.nth(0)).toContainText('18 meses');
  await expect(filas.nth(3)).toContainText('1000 días');
});

test('la tarjeta muestra la fecha de revisión que informa la API cuando la política está configurada', async ({ page }) => {
  await mockAdminSession(page, {
    configured: true,
    rules: [{ name: 'DeleteArchiveAfter2Years', enabled: true, action: 'delete', retentionDays: 730 }],
    softDeleteDays: 7,
    archiveEnabled: true,
    archiveDays: 730,
    deleteEnabled: true,
    deleteDays: 1095,
    notifyTeachers: true,
    autoDelete: true,
    updatedAt: '2026-09-02T13:45:00.000Z',
    evaluatedAt: '2026-10-19T19:26:25.668Z',
  });

  await page.goto('/#/admin/retention');
  const card = complianceCard(page);
  const revision = card.locator('p').first();
  await expect(revision).toBeVisible();

  await expect(revision).toContainText('Última revisión:');
  await expect(revision).toContainText('2026');
  await expect(card.locator('.badge').first()).toHaveText('Vigente');
  await expect(revision).not.toContainText('01/01/2026');
  await expect(page.locator('#page-content')).not.toContainText('01/01/2026');
});
