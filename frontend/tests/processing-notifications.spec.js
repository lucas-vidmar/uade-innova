import { test, expect } from '@playwright/test';

test('teacher sees global toast when processing finishes after navigation', async ({ page }) => {
  let classesCallCount = 0;

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    localStorage.setItem('edu_consent_accepted', 'true');
    localStorage.removeItem('uade.processing.tracked-jobs');
    window.__UADE_PROCESSING_POLL_MS = 250;
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
});
