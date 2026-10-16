import { test, expect } from '@playwright/test';

// #355 (UJ-33): la prioridad de las entregas no puede ser un orden oculto.
// La pantalla tiene que declarar el criterio aplicado, el puesto de cada
// entrega y el motivo de ese puesto.
test('student sees the ranking criterion, each puesto and the motive per entrega', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This usability check must run on Chrome/Chromium.');

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_uid', 'alu-001');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Introducción', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
      ]),
    });
  });

  await page.route('**/api/sga/tasks?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'task-1', studentId: 'alu-001', title: 'TP1: Diagrama de Arquitectura C4', dueDate: inDays(3), weight: 40, status: 'pending', classIds: ['class-01'], grade: null, subjectId: 'arq-software-2026' },
        // Sin fecha de vencimiento: el criterio de cercanía no se puede aplicar.
        { id: 'task-2', studentId: 'alu-001', title: 'Entrega sin fecha cargada', dueDate: null, weight: 10, status: 'pending', classIds: [], grade: null, subjectId: 'arq-software-2026' },
      ]),
    });
  });

  await page.route('**/api/deadlines?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'dl-1', title: 'Entrega con fecha cercana', subjectId: 'arq-software-2026', dueDate: inDays(1), weight: 30, status: 'pending', classIds: ['class-01'] },
      ]),
    });
  });

  await page.goto('/#/student/tasks');

  await expect(page.locator('body')).toContainText('Pendientes');

  // 1. El criterio aplicado, declarado en pantalla.
  const criteria = page.locator('#priority-criteria');
  await expect(criteria).toBeVisible();
  await expect(criteria).toContainText('Criterio de orden');
  await expect(criteria).toContainText('peso de la entrega');
  await expect(criteria).toContainText('El puesto 1 es la entrega más prioritaria');
  // El criterio cambia según el caso y la pantalla lo dice (una entrega sin fecha).
  await expect(criteria).toContainText('fecha de vencimiento: se ordena sólo por peso');

  // 2. El puesto de cada entrega, en orden.
  await expect(page.locator('thead th').first()).toHaveText('Puesto');
  await expect(page.locator('.priority-rank-cell')).toHaveText(['1', '2', '3']);

  // 3. El puesto respeta el puntaje: la más cercana y pesada primero.
  const titles = page.locator('tbody tr td:nth-child(2)');
  await expect(titles.nth(0)).toContainText('Entrega con fecha cercana');
  await expect(titles.nth(1)).toContainText('TP1: Diagrama de Arquitectura C4');
  await expect(titles.nth(2)).toContainText('Entrega sin fecha cargada');

  // 4. El motivo de cada puesto, compuesto con peso y fecha.
  const motives = page.locator('.priority-motive-cell');
  await expect(motives.nth(0)).toContainText(/pesa 30% y vence (en \d+ días?|hoy)/);
  await expect(motives.nth(1)).toContainText(/pesa 40% y vence en \d+ días?/);
  await expect(motives.nth(2)).toContainText('pesa 10% y no tiene fecha de vencimiento');
});
