import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

/* ============================================================
   Production auth — frontend state assertions (Story 10.25 / QA-001, QA-009)

   NOTE: Story 10.25 (backend allowlist + smoke identities) is OPEN, so these
   tests assert the FRONTEND behavior against mocked `/.auth/me` and
   `/api/get-profile` responses only — the browser never calls a live backend.

   The boot-time "unauthenticated → login CTA" branch (initAuth redirect) is
   unreachable under the Vite dev server because isDevMockEnabled() is always
   true there (auth.js:20-26), so the dev mock session always resolves before
   the CTA can render. That path is covered in production by the smoke probe
   (Story 10.20 / backend/scripts/smoke-prod-application-state.js). The
   unauthenticated test below asserts the same frontend state (renderLogin with
   the Microsoft sign-in link) by flipping the hash to the public #/login route
   after a dev-mock boot.
   ============================================================ */

function mockAuthDiscovery(page) {
  return page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });
}

async function stubDashboardBoot(page) {
  await page.route('**/api/subjects*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
  });
  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
    ]) });
  });
  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/deadlines?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/reminder-preferences*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, cadence: 'both' }) });
  });
  await page.route('**/api/consent*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true }) });
  });
  await page.route('**/api/sga/tasks?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test('allowed identity boots to the student dashboard with the authenticated marker', async ({ page }) => {
  await mockAuthDiscovery(page);

  await page.route('**/.auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        clientPrincipal: { userId: 'alu-001', userDetails: 'lvidmar@uade.edu.ar', identityProvider: 'aad' },
      }),
    });
  });

  await page.route('**/api/get-profile*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        role: 'student',
        consentAccepted: true,
        email: 'lvidmar@uade.edu.ar',
        name: 'Lucas Vidmar',
        scope: { subjects: [{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }] },
      }),
    });
  });

  await stubDashboardBoot(page);

  await page.goto('/#/student/dashboard');

  // Allowlist-resolved role drives the routing (main.js:112-128)…
  await expect(page).toHaveURL(/#\/student\/dashboard/);
  await expect(page.locator('#section-classes')).toBeVisible({ timeout: 15000 });

  // …and the authenticated application-state marker (Story 10.20) is set.
  await expect(page.locator('html[data-app-state="authenticated"]')).toHaveCount(1);
  await expect(page.evaluate(() => sessionStorage.getItem('edu_role'))).resolves.toBe('student');
});

test('unlisted identity is routed to the access-denied page with recovery controls', async ({ page }) => {
  await mockAuthDiscovery(page);

  await page.route('**/.auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        clientPrincipal: { userId: 'unknown-001', userDetails: 'no-listado@uade.edu.ar', identityProvider: 'aad' },
      }),
    });
  });

  await page.route('**/api/get-profile*', async (route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'ACCESS_DENIED', error: 'Identidad no habilitada' }),
    });
  });

  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.goto('/');

  await expect(page).toHaveURL(/#\/access-denied/);
  await expect(page.getByText('Acceso denegado')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
});

test('unauthenticated session renders the email/password login form (no Microsoft redirect)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_logged_in', 'false');
  });

  await stubDashboardBoot(page);

  // Boot once under the dev-mock session, then move to the public #/login route
  // where handleRoute() renders the sign-in card (see file header note).
  await page.goto('/#/student/dashboard');
  await page.waitForSelector('#section-classes', { timeout: 15000 });
  await page.evaluate(() => { window.location.hash = '#/login'; });

  await expect(page.getByText('Iniciá sesión')).toBeVisible();
  // Email/password form replaces the Microsoft CTA.
  await expect(page.locator('#login-email')).toBeVisible();
  await expect(page.locator('#login-password')).toBeVisible();
  await expect(page.locator('#login-submit')).toBeVisible();
  await expect(page.locator('a[href*="/.auth/login/aad"]')).toHaveCount(0);
});

test('email/password login with valid credentials boots the role dashboard', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_logged_in', 'false');
  });

  await page.route('**/api/auth/login*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        token: 'session-token-123',
        expiresAt: '2026-12-31T00:00:00Z',
        user: { id: 'alu-001', name: 'Lucas Vidmar', surname: '', email: 'lvidmar@uade.edu.ar', role: 'student', mustChangePassword: false, scope: { subjects: ['arq-software-2026'], classes: [] } },
      }),
    });
  });
  await page.route('**/api/get-profile*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ role: 'student', consentAccepted: true, email: 'lvidmar@uade.edu.ar' }),
    });
  });
  await stubDashboardBoot(page);

  await page.goto('/#/login');
  await page.waitForSelector('#login-email', { timeout: 15000 });
  await page.fill('#login-email', 'lvidmar@uade.edu.ar');
  await page.fill('#login-password', 'secret-1');
  await page.click('#login-submit');

  await expect(page).toHaveURL(/#\/student\/dashboard/, { timeout: 15000 });
  await expect(page.evaluate(() => sessionStorage.getItem('edu_token'))).resolves.toBe('session-token-123');
  await expect(page.evaluate(() => sessionStorage.getItem('edu_role'))).resolves.toBe('student');
});

test('email/password login with invalid credentials shows an inline error (no redirect)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_logged_in', 'false');
  });

  await page.route('**/api/auth/login*', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Credenciales inválidas.', code: 'INVALID_CREDENTIALS', errorCategory: 'AUTH' }),
    });
  });

  await page.goto('/#/login');
  await page.waitForSelector('#login-email', { timeout: 15000 });
  await page.fill('#login-email', 'lvidmar@uade.edu.ar');
  await page.fill('#login-password', 'wrong-password');
  await page.click('#login-submit');

  await expect(page.locator('#login-error')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#login-error')).toContainText('Credenciales inválidas');
  await expect(page).toHaveURL(/#\/login/);
});