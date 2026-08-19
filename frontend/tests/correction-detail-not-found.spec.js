import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

const VALID_CORRECTION = {
  correctionId: 'corr-001',
  studentId: 'alu-012',
  question: '¿Qué es la arquitectura hexagonal?',
  originalAnswer: 'Una arquitectura basada en capas.',
  issueDetail: 'Falta profundidad en la respuesta.',
  classId: 'class-03',
  status: 'pending',
  createdAt: '2026-04-10T12:00:00.000Z',
};

async function stubShell(page, options = {}) {
  const seedActiveSubject = options.seedActiveSubject !== false;

  await page.addInitScript((seedActiveSubject) => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_uid', 'doc-001');
    if (seedActiveSubject) sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
    sessionStorage.setItem('uade.enrollments.doc-001', JSON.stringify({
      data: [{ subjectId: 'arq-software-2026', role: 'teacher', status: 'active' }],
      timestamp: Date.now(),
    }));
  }, seedActiveSubject);

  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.route('**/api/subjects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(seedActiveSubject ? [{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }] : []),
    });
  });

  await page.route('**/api/get-profile*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ consentAccepted: true }) });
  });

  await page.route('**/api/reminder-preferences', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, cadence: 'both' }) });
  });

  await page.route('**/api/consent', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true }) });
  });

  await page.route('**/api/sga/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-03',
          subjectId: 'arq-software-2026',
          title: 'Clase 3 — Arquitectura Hexagonal y DDD',
          date: '2026-03-19',
          topics: ['Puertos y adaptadores'],
          materials: [],
          summaryReady: true,
        },
      ]),
    });
  });

  await page.route('**/api/deadlines?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test('invalid correction ID renders not-found state with back control and no retry', async ({ page }) => {
  await stubShell(page);

  await page.route('**/api/corrections-pending?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });

  await page.goto('/#/teacher/correction/nonexistent');

  const backLink = page.locator('.page-header a[href="#/teacher/corrections"]');
  await expect(backLink).toBeVisible();
  await expect(backLink).toHaveText('← Volver');
  await expect(page.getByText('Corrección no encontrada.')).toBeVisible();
  await expect(page.locator('#retry-correction-btn')).toHaveCount(0);
});

test('retryable 500 error shows Reintentar and re-invokes the load on click', async ({ page }) => {
  await stubShell(page);

  let calls = 0;
  await page.route('**/api/corrections-pending?**', async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Error obteniendo correcciones pendientes.' } }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [VALID_CORRECTION] }) });
    }
  });

  await page.goto('/#/teacher/correction/corr-001');

  await expect(page.locator('.page-header a[href="#/teacher/corrections"]')).toBeVisible();
  await expect(page.getByText('Error cargando corrección. Intentá de nuevo.')).toBeVisible();

  const retryBtn = page.locator('#retry-correction-btn');
  await expect(retryBtn).toBeVisible();
  await retryBtn.click();

  await expect(page.locator('#correction-input')).toBeVisible();
  await expect(page.locator('#submit-correction-btn')).toBeVisible();
});

test('network failure renders retryable error with Reintentar', async ({ page }) => {
  await stubShell(page);

  await page.route('**/api/corrections-pending?**', async (route) => {
    await route.abort('failed');
  });

  await page.goto('/#/teacher/correction/corr-001');

  await expect(page.locator('.page-header a[href="#/teacher/corrections"]')).toBeVisible();
  await expect(page.getByText('Error cargando corrección. Intentá de nuevo.')).toBeVisible();
  await expect(page.locator('#retry-correction-btn')).toBeVisible();
});

test('HTTP 403 error renders without a retry button (non-retryable)', async ({ page }) => {
  await stubShell(page);

  await page.route('**/api/corrections-pending?**', async (route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado.' } }),
    });
  });

  await page.goto('/#/teacher/correction/corr-001');

  await expect(page.locator('.page-header a[href="#/teacher/corrections"]')).toBeVisible();
  await expect(page.getByText('Error cargando corrección.')).toBeVisible();
  await expect(page.locator('#retry-correction-btn')).toHaveCount(0);
});

test('missing correctionId renders not-found state with back control and no retry', async ({ page }) => {
  await stubShell(page);

  await page.goto('/#/teacher/correction/');

  const backLink = page.locator('.page-header a[href="#/teacher/corrections"]');
  await expect(backLink).toBeVisible();
  await expect(backLink).toHaveText('← Volver');
  await expect(page.getByText('Corrección no encontrada.')).toBeVisible();
  await expect(page.locator('#retry-correction-btn')).toHaveCount(0);
});

test('missing active subject renders no-subject state with back control and no retry', async ({ page }) => {
  await stubShell(page, { seedActiveSubject: false });

  await page.goto('/#/teacher/correction/corr-001');

  const backLink = page.locator('.page-header a[href="#/teacher/corrections"]');
  await expect(backLink).toBeVisible();
  await expect(backLink).toHaveText('← Volver');
  await expect(page.getByText('No hay materias vinculadas a tu cuenta.')).toBeVisible();
  await expect(page.locator('#retry-correction-btn')).toHaveCount(0);
});

test('timeout (AbortError) renders retryable error with Reintentar', async ({ page }) => {
  await stubShell(page);

  await page.route('**/api/corrections-pending?**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4500));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [VALID_CORRECTION] }) }).catch(() => {});
  });

  await page.goto('/#/teacher/correction/corr-001');

  await expect(page.locator('.page-header a[href="#/teacher/corrections"]')).toBeVisible();
  await expect(page.getByText('Error cargando corrección. Intentá de nuevo.')).toBeVisible();
  await expect(page.locator('#retry-correction-btn')).toBeVisible();
});
