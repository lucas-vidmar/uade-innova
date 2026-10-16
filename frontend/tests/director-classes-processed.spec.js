import { test, expect } from '@playwright/test';

// #419 (UJ-43): "Clases procesadas" no puede repetir "Clases cargadas".
// El número sale del criterio acordado (al menos un derivado avalado por el
// docente) y la pantalla declara ese criterio junto al número.

const DIRECTOR_SESSION = () => {
  localStorage.setItem('uade_use_mock', 'false');
  localStorage.setItem('onboarding-director-completed', 'true');
  sessionStorage.setItem('edu_role', 'director');
  sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
  sessionStorage.setItem('edu_consent_accepted', 'true');
  sessionStorage.setItem('edu_logged_in', 'true');
};

async function mockDirectorPage(page) {
  await page.route('**/api/enrollments**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));
  await page.route('**/api/subjects*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software' }]) }));
  await page.route('**/api/notifications?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/class-views?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/director/powerbi-metrics?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: [] }) }));
  await page.route('**/api/safety-rate?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'green', safetyRatePercent: 99.2, totalRequests: 10, blockedBySafety: 0, errorCategorizedFailures: 0, updatedAt: '2026-10-16T12:00:00Z' }) }));
  await page.route('**/api/interventions**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
}

function kpiCard(page, label) {
  return page.locator('.kpi-card').filter({ has: page.locator('.kpi-label', { hasText: label }) }).first();
}

test('director sees a different number for clases procesadas and the criterion next to it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This check must run on Chrome/Chromium.');

  await page.addInitScript(DIRECTOR_SESSION);
  await mockDirectorPage(page);

  await page.route('**/api/director/stats*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      dau: 4,
      totalClasses: 56,
      processedClasses: 31,
      processedClassesNotComputable: 2,
      processedClassesCriteria: 'Clase procesada: tiene al menos una síntesis o un mapa avalado por el docente.',
      adoptionRate: 67,
    }),
  }));

  await page.goto('/#/director/dashboard');

  await expect(kpiCard(page, 'Clases cargadas').locator('.kpi-value')).toHaveText('56');
  // El número de procesadas sale del criterio, no del total.
  await expect(kpiCard(page, 'Clases procesadas').locator('.kpi-value')).toHaveText('31');
  // El criterio se declara junto al número.
  const criteria = page.locator('#kpi-classes-processed-criteria');
  await expect(criteria).toBeVisible();
  await expect(criteria).toContainText('síntesis o un mapa avalado por el docente');
  // Y las clases sin dato suficiente se informan como no calculables.
  await expect(kpiCard(page, 'Clases procesadas')).toContainText('2 clase(s) sin dato suficiente: no se cuentan.');
});

test('the exported CSV and the printable report carry each number and the declared criterion', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This check must run on Chrome/Chromium.');

  await page.addInitScript(DIRECTOR_SESSION);
  await mockDirectorPage(page);

  await page.route('**/api/director/stats*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      dau: 4,
      totalClasses: 56,
      processedClasses: 31,
      processedClassesNotComputable: 2,
      processedClassesCriteria: 'Clase procesada: tiene al menos una síntesis o un mapa avalado por el docente.',
      adoptionRate: 67,
    }),
  }));

  // Sin servidor de exportación: se ejerce el armado local del archivo.
  await page.route('**/api/director/kpi-export**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"n/a"}' }));

  await page.goto('/#/director/dashboard');
  await expect(kpiCard(page, 'Clases procesadas').locator('.kpi-value')).toHaveText('31');

  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-export-csv').click(),
  ]);
  const csvPath = await csvDownload.path();
  const csv = (await import('node:fs')).readFileSync(csvPath, 'utf8');
  expect(csv).toContain('General,Clases cargadas,56');
  expect(csv).toContain('General,Clases procesadas,31');
  expect(csv).toContain('Clases procesadas no calculables');
  expect(csv).toContain('síntesis o un mapa avalado por el docente');

  const [htmlDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-export-pdf').click(),
  ]);
  const htmlPath = await htmlDownload.path();
  const html = (await import('node:fs')).readFileSync(htmlPath, 'utf8');
  expect(html).toContain('Clases cargadas');
  expect(html).toContain('>56<');
  expect(html).toContain('>31<');
  expect(html).toContain('síntesis o un mapa avalado por el docente');
});

test('when the server does not report the count, the metric says "no calculable" instead of repeating the total', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This check must run on Chrome/Chromium.');

  await page.addInitScript(DIRECTOR_SESSION);
  await mockDirectorPage(page);

  // Backend sin el criterio: no hay processedClasses.
  await page.route('**/api/director/stats*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ dau: 4, totalClasses: 56, adoptionRate: 67 }),
  }));

  await page.goto('/#/director/dashboard');

  await expect(kpiCard(page, 'Clases cargadas').locator('.kpi-value')).toHaveText('56');
  const processed = kpiCard(page, 'Clases procesadas');
  await expect(processed.locator('.kpi-value')).toHaveText('—');
  await expect(processed).toContainText('no calculable');
  await expect(processed.locator('.kpi-value')).not.toHaveText('56');
});
