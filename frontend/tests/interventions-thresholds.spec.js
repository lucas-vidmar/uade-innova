import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

const THRESHOLDS = {
  noLoginDaysLow: 7,
  noLoginDaysMedium: 14,
  noLoginDaysHigh: 21,
  minQueriesMedium: 2,
  minQueriesHigh: 5,
  attendanceWarning: 60,
  attendanceCritical: 50,
  engagementWarning: 60,
  engagementCritical: 40,
  gradeWarning: 6,
  queryWindowDays: 7,
  queryWindowHighDays: 14,
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

  await page.route('**/api/interventions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
          { id: 'int-1', subjectId: 'arq-software-2026', studentId: 'stu-1', risk: 'high', score: 8, reason: 'Sin login en 25 días', state: 'assigned', notes: [], createdAt: '2026-08-01T00:00:00Z' },
          { id: 'int-2', subjectId: 'arq-software-2026', studentId: 'stu-2', risk: 'medium', score: 5, reason: 'Sin login en 16 días', state: 'assigned', notes: [], createdAt: '2026-08-01T00:00:00Z' },
        ],
        meta: { timestamp: '2026-08-17T00:00:00Z' },
      }),
    });
  });

  await page.route('**/api/risk-thresholds**', async (route) => {
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      route.requests = route.requests || [];
      route.requests.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { subjectId: body.subjectId, thresholds: body.thresholds } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { subjectId: 'arq-software-2026', thresholds: THRESHOLDS, source: 'default' } }),
    });
  });

  // The interventions page also fetches enrollments on load (app shell).
  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test('director can configure risk thresholds from the interventions page', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await mockDirectorSession(page);

  await page.goto('/#/director/interventions');

  const configButton = page.locator('button#btn-thresholds-config');
  await expect(configButton).toBeVisible();
  await expect(configButton).toHaveText(/Configurar umbrales/);

  await configButton.click();

  const modal = page.locator('#thresholds-modal');
  await expect(modal).toBeVisible();

  const labels = [
    'Días de inactividad para riesgo bajo',
    'Días de inactividad para riesgo medio',
    'Días de inactividad para riesgo alto',
    'Mínimo de consultas semanales',
    '% asistencia mínima',
  ];
  for (const label of labels) {
    await expect(modal.locator('label', { hasText: label })).toBeVisible();
  }

  await expect(modal.locator('#th-noLoginDaysLow')).toHaveValue('7');
  await expect(modal.locator('#th-noLoginDaysMedium')).toHaveValue('14');
  await expect(modal.locator('#th-noLoginDaysHigh')).toHaveValue('21');
  await expect(modal.locator('#th-minQueriesMedium')).toHaveValue('2');
  await expect(modal.locator('#th-attendanceWarning')).toHaveValue('60');

  const postPromise = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().includes('/api/risk-thresholds')
  );

  await modal.locator('#th-noLoginDaysHigh').fill('30');
  await modal.locator('#th-attendanceWarning').fill('75');
  await modal.locator('#thresholds-save').click();

  const postRequest = await postPromise;
  const payload = JSON.parse(postRequest.postData());
  expect(payload.subjectId).toBe('arq-software-2026');
  expect(payload.thresholds.noLoginDaysHigh).toBe(30);
  expect(payload.thresholds.attendanceWarning).toBe(75);
  expect(payload.thresholds.noLoginDaysLow).toBe(7);
  expect(payload.thresholds.minQueriesMedium).toBe(2);

  await expect(modal).not.toBeVisible();
  await expect(page.locator('.toast.success')).toContainText('Umbrales guardados');

  expect(pageErrors).toEqual([]);
});