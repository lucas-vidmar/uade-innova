import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('teacher can upload PPTX presentation and sees processing state', async ({ page }) => {
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

  let capturedPostBody = '';
  await page.route('**/api/ingest-material*', async (route) => {
    capturedPostBody = route.request().postData() || '';
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ materialId: 'mat-36', status: 'processing' }),
    });
  });

  await page.goto('/#/teacher/upload');

  await page.getByRole('button', { name: '📊 Presentación' }).click();
  const fileInput = page.locator('#file-input-presentation');
  await expect(fileInput).toBeAttached();

  await fileInput.setInputFiles({
    name: 'estructura-clase.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from('fake-pptx-content-for-ui-flow'),
  });

  await expect(page.locator('.file-item-name').filter({ hasText: 'estructura-clase.pptx' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Procesando archivo')).toBeVisible({ timeout: 15000 });

  expect(capturedPostBody).toContain('name="materialType"');
  expect(capturedPostBody).toContain('presentation');
});
