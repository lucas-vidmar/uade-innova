import { test, expect } from '@playwright/test';

// Story 10.20 (T5.3): the T1 application-state marker must appear only after a
// successful initAuth() and never on the access-denied / unreachable paths.
// Pattern mirrors auth-fallback.spec.js (page.route('**/.auth/me', …) + chrome).

test.use({ channel: 'chrome' });

test('T1 marker appears after a successful dev-mock initAuth()', async ({ page }) => {
  await page.route('**/.auth/me', async route => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/#/student/dashboard');

  // Dev mock fallback authenticates → the marker must be present.
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-state', 'authenticated', { timeout: 15000 });
  const sessionMarker = await page.evaluate(() => sessionStorage.getItem('edu_app_state'));
  expect(sessionMarker).toBe('authenticated');
});

test('T1 marker appears when /.auth/me returns an authenticated principal', async ({ page }) => {
  await page.route('**/.auth/me', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        clientPrincipal: {
          identityProvider: 'aad',
          userId: 'smoke-user',
          userDetails: 'smoke@uade.edu.ar',
          userRoles: ['anonymous', 'authenticated'],
        },
      }),
    });
  });
  await page.route('**/api/get-profile', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'smoke@uade.edu.ar', role: 'student', consentAccepted: true }),
    });
  });

  await page.goto('/#/student/dashboard');

  await expect(page.locator('html')).toHaveAttribute('data-app-state', 'authenticated', { timeout: 15000 });
});

test('T1 marker does NOT appear when access is denied (ACCESS_DENIED profile)', async ({ page }) => {
  await page.route('**/.auth/me', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        clientPrincipal: {
          identityProvider: 'aad',
          userId: 'smoke-user',
          userDetails: 'denied@uade.edu.ar',
          userRoles: ['anonymous', 'authenticated'],
        },
      }),
    });
  });
  // Server resolves the identity to a deny (403 semantics) — allowlist miss.
  await page.route('**/api/get-profile', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'ACCESS_DENIED' }),
    });
  });

  await page.goto('/#/student/dashboard');

  await expect(page.locator('html')).not.toHaveAttribute('data-app-state', 'authenticated', { timeout: 15000 });
  await expect(page.locator('text=Acceso denegado').first()).toBeVisible({ timeout: 15000 });
  const sessionMarker = await page.evaluate(() => sessionStorage.getItem('edu_app_state'));
  expect(sessionMarker).toBeNull();
});