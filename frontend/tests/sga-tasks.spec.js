import { test, expect } from '@playwright/test';

test('student can review SGA-backed tasks usability flow', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This usability check must run on Chrome/Chromium.');

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
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
  await expect(page.locator('body')).toContainText('Promedio ponderado');
});
