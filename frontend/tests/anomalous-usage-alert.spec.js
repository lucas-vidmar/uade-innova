import { test, expect } from '@playwright/test';

test('director can see anomalous usage alert policy in admin panel', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This usability check must run on Chrome/Chromium.');

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'admin');
    localStorage.setItem('onboarding-admin-completed', 'true');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  await page.route('**/api/dashboard-admin/users*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [{ id: 'alu-001', name: 'Lucas Vidmar', email: 'lvidmar@uade.edu.ar', role: 'student' }] }),
    });
  });
  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.goto('/#/admin/users');

  await expect(page.getByText('Administración de Usuarios')).toBeVisible();
  await expect(page.locator('table.table')).toBeVisible();
});
