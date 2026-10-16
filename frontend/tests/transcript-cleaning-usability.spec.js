import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

test('teacher transcript upload accepts .srt and starts processing flow', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-01',
          subjectId: 'arq-software-2026',
          title: 'Clase 1 — Arquitectura',
          date: '2026-03-05',
          topics: [],
          materials: [],
          summaryReady: false,
        },
      ]),
    });
  });

  // El patrón tiene que tolerar la cadena de consulta: en el servidor de
  // desarrollo apiFetch agrega ?_mock_role=...&_mock_uid=..., y un glob sin
  // comodín final no coincide, con lo cual la petición se iba a la red y la
  // prueba terminaba ejercitando el fallback falso que se eliminó en #386.
  await page.route(/\/api\/ingest-material(\?|$)/, async (route) => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ materialId: 'mat-34', status: 'processing' }),
    });
  });

  await page.goto('/#/teacher/upload');

  const fileInput = page.locator('#file-input-transcript');
  await expect(fileInput).toBeAttached();
  await expect(fileInput).toHaveAttribute('accept', /\.srt/);

  await fileInput.setInputFiles({
    name: 'clase1.srt',
    mimeType: 'application/x-subrip',
    buffer: Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nSPEAKER_00: Bienvenidos.\n'),
  });

  await expect(page.locator('.file-item-name').filter({ hasText: 'clase1.srt' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Procesando archivo')).toBeVisible({ timeout: 15000 });
});
