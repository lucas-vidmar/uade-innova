// #347 — Las rutas #/teacher/deadlines y #/teacher/interventions no existían
// como página propia: caían en el fallback de "ruta desconocida" y el tablero
// docente las reemplazaba sin aviso (hash reescrito a #/teacher/dashboard).
// Estas secciones sí viven dentro del tablero, así que la ruta tiene que
// resolverlas ahí, dejar el foco en la sección pedida y conservar la URL.
import { test, expect } from '@playwright/test';

function seedTeacherSession() {
  localStorage.setItem('uade_use_mock', 'false');
  localStorage.setItem('onboarding-student-completed', 'true');
  localStorage.setItem('onboarding-teacher-completed', 'true');
  localStorage.setItem('onboarding-director-completed', 'true');
  sessionStorage.setItem('edu_role', 'teacher');
  sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
  sessionStorage.setItem('edu_consent_accepted', 'true');
  sessionStorage.setItem('edu_logged_in', 'true');
}

async function mockTeacherDashboard(page) {
  await page.addInitScript(seedTeacherSession);

  await page.route('**/api/subjects*', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
  });
  await page.route('**/api/enrollments**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { userId: 'doc-001', subjectId: 'arq-software-2026', role: 'teacher', status: 'active' },
        { userId: 'alu-001', subjectId: 'arq-software-2026', role: 'student', status: 'active' },
      ]),
    });
  });
  await page.route('**/api/classes?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 01 — Introducción', date: '2026-08-05', topics: ['Arquitectura'], materials: [{ id: 'm-1', status: 'processed' }], summaryReady: true },
        { id: 'class-02', subjectId: 'arq-software-2026', title: 'Clase 02 — Capas', date: '2026-08-12', topics: ['Capas'], materials: [], summaryReady: false },
      ]),
    });
  });
  await page.route('**/api/deadlines**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'deadline-001', title: 'Final Project', description: 'Entrega final.', subjectId: 'arq-software-2026', classId: 'class-01', dueDate: '2026-11-20', notifyOnDayBefore: true, notifyOnDayOf: true },
      ]),
    });
  });
  await page.route('**/api/deadline-reminders*', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/corrections**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { correctionId: 'corr-1', question: '¿Qué es un adaptador?', message: 'La respuesta cita un material de otra unidad.', status: 'pending', createdAt: '2026-10-10T12:00:00Z' },
      ]),
    });
  });
  await page.route('**/api/grade-disputes**', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/notifications**', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/chat-history**', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/sga/tasks**', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/tasks**', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/class-views**', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/dashboard-admin/users**', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));
  await page.route('**/api/subject-weights**', async route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
}

test('#/teacher/deadlines abre el tablero en la sección de deadlines sin perder la URL', async ({ page }) => {
  await mockTeacherDashboard(page);

  await page.goto('/#/teacher/deadlines');

  const heading = page.locator('#deadlines-section');
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(/Tareas y deadlines/);
  // Es la misma página del tablero, no una pantalla vacía: el formulario de
  // deadlines y la lista siguen ahí.
  await expect(page.locator('#deadline-save')).toBeVisible();

  // La URL pedida se conserva (antes se reescribía a #/teacher/dashboard).
  await expect(page).toHaveURL(/#\/teacher\/deadlines$/);

  // Llegar a la ruta deja la sección a la vista y el foco en su título.
  await expect(heading).toBeInViewport();
  expect(await page.evaluate(() => document.activeElement?.id || '')).toBe('deadlines-section');
});

test('#/teacher/interventions abre el tablero en la sección de alertas', async ({ page }) => {
  await mockTeacherDashboard(page);

  await page.goto('/#/teacher/interventions');

  const heading = page.locator('#alerts-section');
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText(/Alertas de Calidad IA/);
  await expect(page.locator('#dashboard-alerts-list')).toBeVisible();

  await expect(page).toHaveURL(/#\/teacher\/interventions$/);
  await expect(heading).toBeInViewport();
  expect(await page.evaluate(() => document.activeElement?.id || '')).toBe('alerts-section');
});

test('un rol sin acceso a la ruta no llega a la sección del docente', async ({ page }) => {
  await mockTeacherDashboard(page);
  // Un alumno no puede aterrizar en la sección docente: el guard lo manda a login
  // o a su propio tablero, nunca a #deadlines-section.
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
  });

  await page.goto('/#/teacher/deadlines');

  await expect(page.locator('#deadlines-section')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#\/teacher\/deadlines$/);
});
