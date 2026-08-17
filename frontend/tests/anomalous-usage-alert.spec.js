import { test, expect } from '@playwright/test';

test('director can see anomalous usage alert policy in admin panel', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This usability check must run on Chrome/Chromium.');

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'admin');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  await page.route('**/api/manage/users*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'alu-001',
          theme: 'light',
          language: 'es',
          consentAccepted: true,
          lastActive: '2026-04-10T09:30:00Z',
        },
      ]),
    });
  });

  await page.goto('/#/admin/users');

  await expect(page.locator('#anomalous-usage-alert-card')).toContainText('1.000.000 tokens en 24 horas');
  await expect(page.locator('#anomalous-usage-alert-card')).toContainText('RAGInteraction');
  await expect(page.locator('table.table')).toBeVisible();
});
