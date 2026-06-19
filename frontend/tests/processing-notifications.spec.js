import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('teacher sees global toast when processing finishes after navigation', async ({ page }) => {
  let materialStatusCallCount = 0;
  let classesCallCount = 0;

  await page.addInitScript(() => {
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    localStorage.setItem('edu_consent_accepted', 'true');
    localStorage.setItem('uade.local.subjects', JSON.stringify([{ id: 'arq-software-2026', name: 'Arq. de Software' }]));
    window.__UADE_PROCESSING_POLL_MS = 250;
  });

  await page.route('**/api/material-status**', async route => {
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

  await expect(page.locator('#toast-container .toast.success')).toContainText('Procesamiento completado', { timeout: 15000 });
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
    localStorage.setItem('uade.local.subjects', JSON.stringify([{ id: 'arq-software-2026', name: 'Arq. de Software' }]));
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

test('grouped success toast when multiple materials finish within 3s window', async ({ page }) => {
  let materialStatusCallCount = 0;

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    localStorage.setItem('edu_consent_accepted', 'true');
    window.__UADE_PROCESSING_POLL_MS = 250;
  });

  await page.route('**/api/classes?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-21',
          subjectId: 'arq-software-2026',
          title: 'Clase 21 — Grupo',
          date: '2026-05-11',
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
      body: JSON.stringify({ materialId: 'material-021', status: 'processing' }),
    });
  });

  await page.route('**/api/material-status**', async route => {
    materialStatusCallCount += 1;
    const status = materialStatusCallCount < 2 ? 'processing' : 'ready';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subjectId: 'arq-software-2026',
        results: [
          { materialId: 'material-021a', found: true, httpStatus: 200, status, material: { status, filename: 'clase21a.txt' } },
          { materialId: 'material-021b', found: true, httpStatus: 200, status, material: { status, filename: 'clase21b.txt' } },
          { materialId: 'material-021c', found: true, httpStatus: 200, status, material: { status, filename: 'clase21c.txt' } },
        ],
      }),
    });
  });

  await page.goto('/#/teacher/upload');

  // Seed three tracked jobs so polling has something to check
  await page.evaluate(() => {
    localStorage.setItem('uade.processing.tracked-jobs', JSON.stringify([
      { materialId: 'material-021a', subjectId: 'arq-software-2026', filename: 'clase21a.txt', classIds: ['class-21'] },
      { materialId: 'material-021b', subjectId: 'arq-software-2026', filename: 'clase21b.txt', classIds: ['class-21'] },
      { materialId: 'material-021c', subjectId: 'arq-software-2026', filename: 'clase21c.txt', classIds: ['class-21'] },
    ]));
  });

  // Trigger init by navigating again so processingNotifications.init() runs with the seeded jobs
  await page.goto('/#/teacher/dashboard');

  // Wait for grouped toast to appear (poll 250ms + flush 3000ms = ~3250ms; use 8000ms buffer)
  const toastLocator = page.locator('#toast-container .toast.success');
  await expect(toastLocator).toContainText('3 materiales procesados correctamente', { timeout: 8000 });

  // Should list filenames
  await expect(toastLocator).toContainText('clase21a.txt');
  await expect(toastLocator).toContainText('clase21b.txt');
  await expect(toastLocator).toContainText('clase21c.txt');

  // Should be exactly ONE success toast (grouped)
  await expect(page.locator('#toast-container .toast.success')).toHaveCount(1);
});

test('grouped toasts separate success and error within 3s window', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    localStorage.setItem('edu_consent_accepted', 'true');
    window.__UADE_PROCESSING_POLL_MS = 250;
  });

  await page.route('**/api/classes?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-22',
          subjectId: 'arq-software-2026',
          title: 'Clase 22 — Mixto',
          date: '2026-05-12',
          topics: [],
          summaryReady: false,
          materials: [],
        },
      ]),
    });
  });

  await page.route('**/api/material-status**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subjectId: 'arq-software-2026',
        results: [
          { materialId: 'material-022a', found: true, httpStatus: 200, status: 'ready', material: { status: 'ready', filename: 'clase22a.txt' } },
          { materialId: 'material-022b', found: true, httpStatus: 200, status: 'error', material: { status: 'error', filename: 'clase22b.txt' } },
          { materialId: 'material-022c', found: true, httpStatus: 200, status: 'ready', material: { status: 'ready', filename: 'clase22c.txt' } },
        ],
      }),
    });
  });

  await page.goto('/#/teacher/dashboard');

  await page.evaluate(() => {
    localStorage.setItem('uade.processing.tracked-jobs', JSON.stringify([
      { materialId: 'material-022a', subjectId: 'arq-software-2026', filename: 'clase22a.txt', classIds: ['class-22'] },
      { materialId: 'material-022b', subjectId: 'arq-software-2026', filename: 'clase22b.txt', classIds: ['class-22'] },
      { materialId: 'material-022c', subjectId: 'arq-software-2026', filename: 'clase22c.txt', classIds: ['class-22'] },
    ]));
  });

  // Re-init by navigating
  await page.goto('/#/teacher/dashboard');

  // Wait for both grouped toasts
  await expect(page.locator('#toast-container .toast.success')).toContainText('2 materiales procesados correctamente', { timeout: 8000 });
  await expect(page.locator('#toast-container .toast.error')).toContainText('Procesamiento con error', { timeout: 8000 });
  await expect(page.locator('#toast-container .toast.error')).toContainText('clase22b.txt', { timeout: 8000 });

  // Should be exactly one success and one error toast
  await expect(page.locator('#toast-container .toast.success')).toHaveCount(1);
  await expect(page.locator('#toast-container .toast.error')).toHaveCount(1);
});

test('materials finishing outside 3s window show separate toasts', async ({ page }) => {
  let batchCallCount = 0;

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    localStorage.setItem('edu_consent_accepted', 'true');
    window.__UADE_PROCESSING_POLL_MS = 250;
  });

  await page.route('**/api/classes?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-23',
          subjectId: 'arq-software-2026',
          title: 'Clase 23 — Separado',
          date: '2026-05-13',
          topics: [],
          summaryReady: false,
          materials: [],
        },
      ]),
    });
  });

  // Dedicated batch endpoint mock — only counts batch calls
  await page.route('**/api/material-status?**', async route => {
    batchCallCount += 1;
    const results = [];
    if (batchCallCount >= 1) {
      results.push({ materialId: 'material-023a', found: true, httpStatus: 200, status: 'ready', material: { status: 'ready', filename: 'clase23a.txt' } });
    }
    // Return 023b as not-found until batch call 15 (~3.75s after first poll)
    if (batchCallCount >= 15) {
      results.push({ materialId: 'material-023b', found: true, httpStatus: 200, status: 'ready', material: { status: 'ready', filename: 'clase23b.txt' } });
    } else {
      results.push({ materialId: 'material-023b', found: false, httpStatus: 404 });
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subjectId: 'arq-software-2026',
        results,
      }),
    });
  });

  // Fallback single-status calls return 404 so they don't interfere with batch counting
  await page.route('**/api/material-status/*?**', async route => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Not found' }),
    });
  });

  await page.goto('/#/teacher/dashboard');

  await page.evaluate(() => {
    localStorage.setItem('uade.processing.tracked-jobs', JSON.stringify([
      { materialId: 'material-023a', subjectId: 'arq-software-2026', filename: 'clase23a.txt', classIds: ['class-23'] },
      { materialId: 'material-023b', subjectId: 'arq-software-2026', filename: 'clase23b.txt', classIds: ['class-23'] },
    ]));
  });

  await page.goto('/#/teacher/dashboard');

  // Wait for first toast (single material)
  const firstToast = page.locator('#toast-container .toast.success').first();
  await expect(firstToast).toContainText('Procesamiento completado', { timeout: 8000 });
  await expect(firstToast).toContainText('clase23a.txt', { timeout: 8000 });

  // The first toast should NOT contain the second filename (verifies not grouped)
  await expect(firstToast).not.toContainText('clase23b.txt');

  // Wait for second toast to appear (outside the 3s window)
  await expect(page.locator('#toast-container .toast.success').filter({ hasText: 'clase23b.txt' })).toBeVisible({ timeout: 12000 });
});
