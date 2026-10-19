import { test, expect } from '@playwright/test';

// #343: la tabla de "Políticas Activas" ya se leía de la API, pero la tarjeta de
// "Cumplimiento Normativo" seguía escrita a mano: fecha de revisión fija
// (01/01/2026) y estado "Vigente" aunque la API respondiera `configured:false`,
// con la vista de Cumplimiento diciendo "No configurado" para la misma política.
// Estos casos fijan que la tarjeta y la tabla salgan de la respuesta.
//
// #537: además, "Vigente" salía sólo con que hubiera política guardada: no había
// responsable que la aprobara ni inventario de qué se guarda de cada persona y
// con qué finalidad. Ahora el estado sale de `effective` (configurada + con
// responsable) y el inventario lo sirve el backend resuelto contra la política.

const SUBJECTS = [{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }];

function inventoryFixture({ configured, approvedBy, archiveDays }) {
  const effective = configured && Boolean(approvedBy);
  const estado = effective ? 'vigente' : 'pendiente';
  return {
    generatedAt: '2026-10-19T20:00:00.000Z',
    configured,
    effective,
    responsable: { approvedBy: approvedBy || null, approvedAt: approvedBy ? '2026-09-02T13:45:00.000Z' : null },
    policy: { archiveDays, softDeleteDays: 7 },
    totals: { categorias: 2, cubiertas: 1, sinPlazo: 1 },
    categories: [
      {
        id: 'transcripciones',
        persona: 'Alumno y docente',
        categoria: 'Transcripciones y audio de clase',
        queSeGuarda: 'Audio de la clase y su transcripción (VTT).',
        donde: 'Contenedores class-audio y processed',
        finalidad: 'Accesibilidad y repaso de la clase.',
        governedBy: 'archiveDays',
        periodoDias: archiveDays,
        accion: 'Archivo en frío (Cold Storage)',
        estado,
        cubierto: true,
      },
      {
        id: 'consentimiento',
        persona: 'Todos los roles',
        categoria: 'Consentimiento informado',
        queSeGuarda: 'Aceptación, versión y fecha del consentimiento.',
        donde: 'Tabla UserConsent',
        finalidad: 'Prueba de que la persona aceptó el tratamiento.',
        governedBy: null,
        periodoDias: null,
        accion: 'Sin acción declarada',
        estado: 'sin-plazo',
        cubierto: false,
      },
    ],
  };
}

async function mockAdminSession(page, policy, inventory) {
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
  await page.route('**/api/compliance/data-inventory**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(inventory) });
  });
  await page.route('**/api/compliance/retention-policy**', async (route) => {
    if (route.request().method() === 'PUT') {
      const sent = route.request().postDataJSON() || {};
      const approvedBy = sent.approvedBy ?? policy.approvedBy ?? null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...policy,
          ...sent,
          configured: true,
          approvedBy,
          effective: Boolean(approvedBy),
          updatedAt: '2026-10-19T20:00:00.000Z',
        }),
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

const BASE_POLICY = {
  rules: [],
  softDeleteDays: 7,
  archiveEnabled: true,
  archiveDays: 540,
  deleteEnabled: true,
  deleteDays: 1000,
  notifyTeachers: true,
  autoDelete: true,
  evaluatedAt: '2026-10-19T19:26:25.668Z',
};

test('la tarjeta de cumplimiento no inventa fecha ni estado cuando la política no está configurada', async ({ page }) => {
  await mockAdminSession(page, {
    ...BASE_POLICY,
    configured: false,
    effective: false,
    approvedBy: null,
    approvedAt: null,
    updatedAt: null,
    note: 'Política de retención no configurada — aplican valores por defecto de Azure Storage.',
  }, inventoryFixture({ configured: false, approvedBy: null, archiveDays: 540 }));

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
  const policy = {
    ...BASE_POLICY,
    configured: true,
    effective: true,
    approvedBy: 'Lucía Fernández (Dirección Académica)',
    approvedAt: '2026-09-02T13:45:00.000Z',
    updatedAt: '2026-09-02T13:45:00.000Z',
  };
  await mockAdminSession(page, policy, inventoryFixture({ configured: true, approvedBy: policy.approvedBy, archiveDays: 540 }));

  await page.goto('/#/admin/retention');
  const card = complianceCard(page);
  const revision = card.locator('p').first();
  await expect(revision).toBeVisible();

  await expect(revision).toContainText('Última revisión:');
  await expect(revision).toContainText('2026');
  await expect(card.locator('.badge').first()).toHaveText('Vigente');
  await expect(revision).not.toContainText('01/01/2026');
  await expect(page.locator('#page-content')).not.toContainText('01/01/2026');
  // #537: el responsable que aprueba queda nombrado en la tarjeta.
  await expect(page.locator('#retention-policy-responsable')).toContainText('Lucía Fernández');
  await expect(page.locator('#retention-approved-by')).toHaveValue('Lucía Fernández (Dirección Académica)');
});

test('#537 — una política guardada sin responsable no se declara «Vigente»', async ({ page }) => {
  await mockAdminSession(page, {
    ...BASE_POLICY,
    configured: true,
    effective: false,
    approvedBy: null,
    approvedAt: null,
    updatedAt: '2026-09-02T13:45:00.000Z',
  }, inventoryFixture({ configured: true, approvedBy: null, archiveDays: 540 }));

  await page.goto('/#/admin/retention');
  const card = complianceCard(page);
  await expect(card.locator('.badge').first()).toHaveText('Pendiente de aprobación');
  await expect(page.locator('#page-content')).not.toContainText('Vigente');
  await expect(card).toContainText('Sin responsable identificado');
  // Las filas de la tabla acompañan: no hay dato "Activo" sin responsable.
  await expect(page.locator('.data-table tbody').first()).not.toContainText('Activo');
});

test('#537 — el inventario dice qué se guarda de cada persona y con qué finalidad', async ({ page }) => {
  const policy = {
    ...BASE_POLICY,
    configured: true,
    effective: true,
    approvedBy: 'Lucía Fernández (Dirección Académica)',
    approvedAt: '2026-09-02T13:45:00.000Z',
    updatedAt: '2026-09-02T13:45:00.000Z',
  };
  await mockAdminSession(page, policy, inventoryFixture({ configured: true, approvedBy: policy.approvedBy, archiveDays: 540 }));

  await page.goto('/#/admin/retention');
  const inventario = page.locator('#data-inventory');
  await expect(inventario).toContainText('Transcripciones y audio de clase');
  await expect(inventario).toContainText('Accesibilidad y repaso de la clase.');
  await expect(inventario).toContainText('Alumno y docente');
  await expect(inventario).toContainText('18 meses');
  // Los datos que la política no cubre se declaran como hueco, sin plazo inventado.
  await expect(inventario).toContainText('Sin plazo en la política');
  await expect(inventario).toContainText('Sin plazo declarado');
});
