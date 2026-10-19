import { test, expect } from '@playwright/test';

// Issue #346 — lote de detalles menores.
// Regresiones cubiertas acá:
//  1. La barra de materia activa mostraba "Sin materias asignadas" cuando el
//     cache de inscripciones estaba frío, aunque la sesión ya tuviera materia.
//  2. El KPI "Clases por alumno (promedio)" del panel directivo mostraba un
//     guion suelto cuando el período no tenía visualizaciones.
//  3. (guarda) El selector de materia abre con una sola materia disponible.

const SUBJECT = { id: 'arq-software-2026', name: 'Arquitectura de Software 2026' };

async function mockApi(page, { role = 'student' } = {}) {
  // Catch-all primero: las rutas específicas registradas después tienen prioridad.
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/get-profile', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Sin `scope.subjects` a propósito: así el cache de alcance también queda
      // frío y se ejercita el camino de la barra de materia.
      body: JSON.stringify({ role, name: 'QA 346', email: 'qa346@uade.edu.ar', consentAccepted: true }),
    });
  });
  await page.route('**/api/subjects', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([SUBJECT]) });
  });
  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/reminder-preferences', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, cadence: 'both', timeWindow: 'any', datePrefs: {} }) });
  });
  await page.route('**/api/consent', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true }) });
  });
  await page.route('**/api/class-views**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/notifications/stream**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
  });
}

async function seedSession(page, { role = 'student' } = {}) {
  await page.addInitScript((r) => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_token', 'qa-346-token');
    sessionStorage.setItem('edu_role', r);
    sessionStorage.setItem('edu_uid', r === 'director' ? 'dir-001' : 'alu-004');
    sessionStorage.setItem('edu_name', 'QA 346');
    sessionStorage.setItem('edu_email', 'qa346@uade.edu.ar');
    sessionStorage.setItem('edu_logged_in', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    // Sin cache de inscripciones ni de alcance: el caso que rompía la barra.
    for (const k of Object.keys(sessionStorage)) {
      if (/^uade\.enrollments\./.test(k) || k === 'edu_scope_subjects') sessionStorage.removeItem(k);
    }
  }, role);
}

test.describe('Issue #346 — lote de detalles menores', () => {
  test('la barra de materia muestra la materia activa con el cache de inscripciones frío', async ({ page }) => {
    await seedSession(page, { role: 'student' });
    await mockApi(page, { role: 'student' });

    await page.goto('/#/student/settings', { waitUntil: 'commit' });
    const bar = page.locator('#global-course-btn span');
    await expect(bar).toBeVisible({ timeout: 15000 });

    await expect(bar).toContainText('Arquitectura de Software');
    await expect(page.locator('#global-course-btn')).not.toContainText('Sin materias asignadas');
    await expect(page.locator('body')).not.toContainText('Sin materias asignadas');
  });

  test('el KPI de promedio del panel directivo dice s/d, no un guion suelto', async ({ page }) => {
    await seedSession(page, { role: 'director' });
    await mockApi(page, { role: 'director' });

    await page.goto('/#/director/dashboard', { waitUntil: 'commit' });
    const kpi = page.locator('#kpi-avg-per-student');
    await expect(kpi).toBeVisible({ timeout: 15000 });

    await expect(kpi).toHaveText('s/d');
    await expect(kpi).toHaveAttribute('title', /Sin datos de visualización/);
  });

  test('el selector de materia abre con una sola materia disponible', async ({ page }) => {
    await seedSession(page, { role: 'student' });
    await mockApi(page, { role: 'student' });

    await page.goto('/#/student/dashboard', { waitUntil: 'commit' });
    const trigger = page.locator('#global-course-btn');
    await expect(trigger).toBeVisible({ timeout: 15000 });

    await trigger.click();
    const dropdown = page.locator('#global-course-dropdown');
    await expect(dropdown).toHaveClass(/active/);
    const option = dropdown.locator('.custom-dropdown-option').first();
    await expect(option).toBeVisible();
    await expect(option).toContainText('Arquitectura de Software');
  });
});
