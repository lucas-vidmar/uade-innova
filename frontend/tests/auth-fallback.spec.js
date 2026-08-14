import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('DEV mock fallback boots a student session when /.auth/me is unreachable', async ({ page }) => {
  await page.route('**/.auth/me', async route => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/#/student/dashboard');

  // In dev builds the mock fallback must still work (no real SWA endpoint).
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#nav-student-chat-desktop, #nav-student-dashboard-desktop').first()).toBeVisible();
});

test('DEV mock fallback preserves an explicitly set role from sessionStorage', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  await page.route('**/.auth/me', async route => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/#/teacher/dashboard');

  await expect(page.locator('#nav-teacher-upload-desktop')).toBeVisible({ timeout: 15000 });
});
