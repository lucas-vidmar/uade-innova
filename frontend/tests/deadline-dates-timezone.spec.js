import { test, expect } from '@playwright/test';

// #335: las fechas de entrega y de clase se guardan sin hora ("2026-12-15").
// `new Date("2026-12-15")` la lee como medianoche UTC, así que en Argentina
// (UTC-3) la alumna veía el día anterior ("14 dic" / "14/12"). Este test fija
// la zona del navegador en Buenos Aires —donde el corrimiento se ve— y exige
// que el día mostrado sea el guardado, tanto en el dashboard como en Tareas.
test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

const DEADLINE_DATE = '2026-12-15'; // fecha sin hora, como la guarda el backend
const CLASS_DATE = '2026-04-09';

test('student sees the stored calendar day for a date-only deadline and class', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('uade.local.subjects', JSON.stringify([
      { id: 'arq-software-2026', name: 'Arquitectura de Software 2026' },
    ]));
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_uid', 'alu-001');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/subjects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]),
    });
  });

  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{ subjectId: 'arq-software-2026', userId: 'alu-001', role: 'student', status: 'active' }],
      }),
    });
  });

  await page.route('**/api/deadlines**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'deadline-335', title: 'TP final integrador', description: 'Entrega del proyecto', subjectId: 'arq-software-2026', classId: 'class-01', dueDate: DEADLINE_DATE, status: 'pending' },
      ]),
    });
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Introducción a Arquitecturas de Software', date: CLASS_DATE, topics: [], summaryReady: true, materials: [] },
      ]),
    });
  });

  await page.route('**/api/chat-history**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/sga/tasks**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/tasks**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/notifications?**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  // ── Dashboard: "Tareas próximas" y "Clases de la materia" ──
  await page.goto('/#/student/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#section-tasks', { timeout: 10000 });

  const tasksSection = page.locator('#section-tasks');
  await expect(tasksSection).toContainText('TP final integrador');
  await expect(tasksSection).toContainText('15/12');
  await expect(tasksSection).not.toContainText('14/12');

  const classesSection = page.locator('#section-classes');
  await expect(classesSection).toContainText('9/4');
  await expect(classesSection).not.toContainText('8/4');

  // ── Tareas: la fecha del vencimiento en la lista ──
  await page.goto('/#/student/tasks', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toContainText('TP final integrador', { timeout: 10000 });
  await expect(page.locator('body')).toContainText('15 dic');
  await expect(page.locator('body')).not.toContainText('14 dic');
});
