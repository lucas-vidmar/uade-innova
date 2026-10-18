import { test, expect } from '@playwright/test';

/**
 * #328 — El tablero del docente tiene que mostrar el aviso de integridad del
 * índice de la unidad: el backend descarta los fragmentos cuya metadata no cierra
 * contra el registro (material de otra unidad, clases inexistentes) y deja el
 * aviso por el canal de notificaciones. Acá se verifica que ese aviso llegue a
 * una superficie visible, no que quede sólo guardado.
 */

const AVISO = {
  id: 'integridad-indice-arq-software-2026',
  type: 'integrity',
  title: 'El índice de la unidad tiene material que no le pertenece',
  message: 'Se descartaron fragmentos al responder: 1 material/es que no figuran en la unidad (b619ef64) y 2 clase/s que no existen en la unidad (class-07, class-08). No se citan en las respuestas hasta regularizarlos.',
  createdAt: '2026-10-18T12:00:00.000Z',
  unread: true,
  subjectId: 'arq-software-2026',
};

async function prepararTableroDocente(page, notificaciones) {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/subjects*', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
  });
  await page.route('**/api/enrollments**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { userId: 'doc-001', subjectId: 'arq-software-2026', role: 'teacher', status: 'active' },
      { userId: 'alu-001', subjectId: 'arq-software-2026', role: 'student', status: 'active' },
    ]) });
  });
  await page.route('**/api/classes?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Introducción', topics: [], materials: [], summaryReady: true },
    ]) });
  });
  await page.route('**/api/deadlines**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/corrections**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/grade-disputes**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/notifications?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(notificaciones) });
  });

  await page.goto('/#/teacher/dashboard');
  await expect(page.locator('.kpi-card').first()).toBeVisible({ timeout: 15000 });
}

test('el tablero del docente muestra el aviso de integridad del índice', async ({ page }) => {
  await prepararTableroDocente(page, [AVISO]);

  const aviso = page.getByText('Índice de conocimiento — Arquitectura de Software 2026');
  await expect(aviso).toBeVisible();

  // El aviso dice qué se descartó y por qué señal, para que se pueda accionar.
  await expect(page.getByText('no figuran en la unidad', { exact: false })).toBeVisible();
  await expect(page.getByText('class-07, class-08', { exact: false })).toBeVisible();
  await expect(page.getByText('no se citan en las respuestas', { exact: false })).toBeVisible();
});

test('sin avisos de integridad el tablero no muestra el bloque', async ({ page }) => {
  await prepararTableroDocente(page, []);

  await expect(page.getByText('Índice de conocimiento', { exact: false })).toHaveCount(0);
  await expect(page.locator('.kpi-card').first()).toBeVisible();
});

