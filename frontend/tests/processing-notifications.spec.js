import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('teacher sees global toast when processing finishes after navigation', async ({ page }) => {
  let materialStatusCallCount = 0;
  let classesCallCount = 0;

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    localStorage.setItem('edu_consent_accepted', 'true');
    localStorage.removeItem('uade.processing.tracked-jobs');
    window.__UADE_PROCESSING_POLL_MS = 250;
  });

  await page.route('**/api/material-status/**', async route => {
    materialStatusCallCount += 1;
    const status = materialStatusCallCount < 2 ? 'processing' : 'ready';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'material-001',
        materialId: 'material-001',
        subjectId: 'arq-software-2026',
        classIds: ['class-14'],
        filename: 'clase14.txt',
        status,
      }),
    });
  });

  await page.route('**/api/classes?**', async route => {
    classesCallCount += 1;

    const status = classesCallCount < 2 ? 'processing' : 'ready';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-14',
          subjectId: 'arq-software-2026',
          title: 'Clase 14 — Integración',
          date: '2026-04-30',
          topics: [],
          summaryReady: false,
          materials: [
            {
              id: 'material-001',
              classId: 'class-14',
              type: 'transcript',
              filename: 'clase14.txt',
              mimeType: 'text/plain',
              status,
              uploadedAt: '2026-04-10T10:00:00Z',
            },
          ],
        },
      ]),
    });
  });

  await page.route('**/api/ingest-material', async route => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ materialId: 'material-001', status: 'processing' }),
    });
  });

  await page.goto('/#/teacher/upload');

  const fileInput = page.locator('#file-input-transcript');
  await fileInput.setInputFiles({
    name: 'clase14.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('contenido de prueba'),
  });

  await expect(page.locator('#toast-container .toast')).toContainText('Procesando archivo');

  await page.goto('/#/teacher/dashboard');

  await expect(page.locator('#toast-container .toast.success')).toContainText('Procesamiento completado', { timeout: 7000 });
  await expect(page.locator('#toast-container .toast.success')).toContainText('clase14.txt');
  expect(materialStatusCallCount).toBeGreaterThan(0);
  expect(classesCallCount).toBeLessThanOrEqual(2);
});

test('notification polling ignores invalid persisted jobs and still resolves valid one', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    localStorage.setItem('edu_consent_accepted', 'true');
    window.__UADE_PROCESSING_POLL_MS = 250;

    localStorage.setItem(
      'uade.processing.tracked-jobs',
      JSON.stringify([
        { materialId: '', subjectId: 'arq-software-2026', filename: 'invalid.txt' },
        { materialId: 'material-002', subjectId: 'arq-software-2026', filename: 'clase15.txt', classIds: ['class-15', 'class-15'] },
      ])
    );
  });

  await page.route('**/api/material-status/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'material-002',
        materialId: 'material-002',
        subjectId: 'arq-software-2026',
        classIds: ['class-15'],
        filename: 'clase15.txt',
        status: 'ready',
      }),
    });
  });

  await page.goto('/#/teacher/dashboard');

  await expect(page.locator('#toast-container .toast.success')).toContainText('Procesamiento completado', { timeout: 7000 });
  await expect(page.locator('#toast-container .toast.success')).toContainText('clase15.txt');
});

test('upload status badge transitions from Procesando to Listo without refresh', async ({ page }) => {
  let materialStatusCallCount = 0;

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    localStorage.setItem('edu_consent_accepted', 'true');
    localStorage.removeItem('uade.processing.tracked-jobs');
    window.__UADE_PROCESSING_POLL_MS = 250;
  });

  await page.route('**/api/classes?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-20',
          subjectId: 'arq-software-2026',
          title: 'Clase 20 — Cierre',
          date: '2026-05-10',
          topics: [],
          summaryReady: false,
          materials: [],
        },
      ]),
    });
  });

  await page.route('**/api/ingest-material', async route => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ materialId: 'material-020', status: 'processing' }),
    });
  });

  await page.route('**/api/material-status/**', async route => {
    materialStatusCallCount += 1;
    const status = materialStatusCallCount < 2 ? 'processing' : 'ready';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'material-020',
        materialId: 'material-020',
        subjectId: 'arq-software-2026',
        classIds: ['class-20'],
        filename: 'clase20.txt',
        status,
      }),
    });
  });

  await page.goto('/#/teacher/upload');

  await page.locator('#file-input-transcript').setInputFiles({
    name: 'clase20.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('contenido de prueba para estado'),
  });

  const statusBadge = page.locator('#file-list-transcript .badge').first();
  await expect(statusBadge).toContainText('Procesando');
  await expect(statusBadge).toContainText('Listo', { timeout: 7000 });
  expect(materialStatusCallCount).toBeGreaterThan(0);
});
