import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

const RETENTION_POLICY = {
  configured: true,
  rules: [
    { name: 'Transcripciones', enabled: true, action: 'tierToArchive', retentionDays: 365, prefixes: ['transcripts/'] },
    { name: 'Videos', enabled: false, action: 'delete', retentionDays: 30, prefixes: ['videos/'] },
  ],
  softDeleteDays: 7,
  evaluatedAt: '2026-08-10T12:00:00.000Z',
};

async function mockDirectorSession(page) {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'director');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  // Director dashboard data (globs end in "*" because apiFetch relays the
  // mock role as a `?_mock_role=director` query in dev).
  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/sga/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/subjects*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software' }]) });
  });
  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/director/stats*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dau: 52,
        dauDelta: '+8%',
        ragInteractions: 171,
        adoptionRate: 68,
        subjectAdoption: [{ name: 'Arq. de Software', rate: 82 }],
        materialUploads: { byTeacher: [] },
        earlyAlertSummary: { totalStudentsAtRisk: 3, highRiskCount: 1, mediumRiskCount: 2, lowAttendanceCount: 2, lowGradeCount: 2, attendanceBelow60Count: 1, attendance60To75Count: 2, attendanceAbove75Count: 0 },
      }),
    });
  });
  await page.route('**/api/director/powerbi-metrics?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ source: { mode: 'fallback', storage: 'Azure Table Storage', table: 'SessionMetrics' }, daily: [], updatedAt: '2026-08-10T12:00:00.000Z', windowDays: 60 }),
    });
  });
  await page.route('**/api/safety-rate?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'green', safetyRatePercent: 99.2, totalRequests: 171, blockedBySafety: 1, errorCategorizedFailures: 2, updatedAt: '2026-08-10T12:00:00Z' }),
    });
  });
  await page.route('**/api/class-views?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // Compliance API (Story 6.4): the page the dead link is supposed to resolve to.
  await page.route('**/api/compliance/retention-policy*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RETENTION_POLICY) });
  });
}

test('director can navigate from the dashboard "Cumplimiento →" link to the compliance evidence page', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await mockDirectorSession(page);

  await page.goto('/#/director/dashboard');

  // Scope to the "Alertas Tempranas (Agregado)" card (Dashboard.js:203-238) so a
  // future global nav link with the same href can't satisfy the assertion for the
  // wrong reason.
  const complianceLink = page.locator('.card', { hasText: 'Alertas Tempranas (Agregado)' }).locator('a[href="#/director/compliance"]');
  await expect(complianceLink).toBeVisible();

  await complianceLink.click();

  // Route resolves to the registered compliance page instead of bouncing back.
  await expect(page).toHaveURL(/#\/director\/compliance/);
  await expect(page).toHaveURL(/(?!.*\/director\/dashboard)/);

  const heading = page.locator('h2', { hasText: 'Evidencia de Cumplimiento Normativo' });
  await expect(heading).toBeVisible();

  // Policy payload from the mocked API renders in the retention table.
  await expect(page.locator('table')).toContainText('Transcripciones');
  await expect(page.locator('table')).toContainText('Soft Delete Policy');

  // QA-004 was a silent routing failure; any uncaught JS error invalidates the fix.
  expect(pageErrors).toEqual([]);
});

test('director compliance page stays on route when loaded directly (hash deep-link)', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await mockDirectorSession(page);

  await page.goto('/#/director/compliance');

  await expect(page).toHaveURL(/#\/director\/compliance/);
  await expect(page.locator('h2', { hasText: 'Evidencia de Cumplimiento Normativo' })).toBeVisible();

  expect(pageErrors).toEqual([]);
});

// AC #2 (fallback path): only meaningful when the team decides the director role
// must NOT access compliance and removes the in-dashboard link. The recommended
// path (route registration) keeps the link, so this assertion stays skipped.
test.fixme('when the fallback is chosen, the "Cumplimiento" link is omitted (AC #2)', async ({ page }) => {
  await mockDirectorSession(page);

  await page.goto('/#/director/dashboard');

  const complianceLink = page.locator('.card', { hasText: 'Alertas Tempranas (Agregado)' }).locator('a[href="#/director/compliance"]');
  await expect(complianceLink).not.toBeVisible();
});
