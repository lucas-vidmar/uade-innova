import { test, expect } from '@playwright/test';

test('student can review SGA-backed tasks usability flow', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This usability check must run on Chrome/Chromium.');

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  // Entorno de arranque: sin una materia activa la página no llega a pedir las
  // tareas, y desde #363 una lectura que falla se muestra como error en lugar de
  // pintar la lista vacía. La prueba necesita el contexto completo, no sólo las
  // tareas, para ejercitar el camino real.
  await page.route('**/api/get-profile**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        role: 'student', theme: 'light', language: 'es', consentAccepted: true,
        botTone: 'formal', botLength: 'detailed', includeSources: true,
      }),
    });
  });

  await page.route('**/api/subjects**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026', track: 'sistemas' }]),
    });
  });

  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'enr-1', userId: 'alu-001', subjectId: 'arq-software-2026', status: 'active', enrolledCount: 5 }]),
    });
  });

  await page.route('**/api/consent**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ consentAccepted: true }) });
  });

  await page.route('**/api/reminder-preferences**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/deadlines?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Introducción', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
      ]),
    });
  });

  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/sga/tasks?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'task-1', studentId: 'alu-001', title: 'TP1: Diagrama de Arquitectura C4', dueDate: '2026-04-20', weight: 25, status: 'pending', classIds: ['class-01'], grade: null, subjectId: 'arq-software-2026' },
        { id: 'task-2', studentId: 'alu-001', title: 'Quiz Online — Estilos Arquitectónicos', dueDate: '2026-04-10', weight: 10, status: 'completed', classIds: ['class-01'], grade: 8.5, subjectId: 'arq-software-2026' },
      ]),
    });
  });

  await page.goto('/#/student/tasks');

  await expect(page.locator('body')).toContainText('Pendientes');
  await expect(page.locator('body')).toContainText('TP1: Diagrama de Arquitectura C4');
  await expect(page.locator('body')).toContainText('Quiz Online — Estilos Arquitectónicos');
  // El indicador se rotula en mayúsculas por estilo (text-transform), así que la
  // aserción tolera la caja sin dejar de verificar el concepto.
  await expect(page.locator('body')).toContainText(/promedio ponderado/i);
});
