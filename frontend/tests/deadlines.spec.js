import { test, expect } from '@playwright/test';

test('teacher can create a deadline and student sees it on dashboard and calendar', async ({ page }) => {
  const requests = [];

  await page.addInitScript(() => {
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  const DEADLINE_DATA = [
    { id: 'deadline-001', title: 'Final Project', description: 'Entrega final del proyecto integrador.', subjectId: 'arq-software-2026', classId: 'class-14', dueDate: '2026-03-30', notifyOnDayBefore: true, notifyOnDayOf: true },
  ];

  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.route('**/api/sga/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/classes?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'class-14', subjectId: 'arq-software-2026', title: 'Clase 14 — Integración', date: '2026-03-30', topics: [], materials: [], summaryReady: true },
      ]),
    });
  });

  await page.route('**/api/deadlines', async route => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON();
      requests.push(payload);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...payload, id: 'deadline-001', createdAt: '2026-03-24T10:00:00Z', updatedAt: '2026-03-24T10:00:00Z' }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEADLINE_DATA) });
  });

  await page.route('**/api/deadline-reminders', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/#/teacher/dashboard');
  await page.locator('#deadline-title').fill('Final Project');
  await page.locator('#deadline-description').fill('Entrega final del proyecto integrador.');
  await page.locator('#deadline-class').selectOption('class-14');
  await page.locator('#deadline-date').fill('2026-03-30');
  await page.locator('#deadline-save').click();

  expect(requests.length).toBe(1);
  expect(requests[0].title).toBe('Final Project');
  expect(requests[0].classId).toBe('class-14');

  await page.evaluate(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });
  await page.goto('/#/student/calendar');

  await page.route('**/api/tasks?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/chat-history?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route(url => url.pathname === '/api/deadline-reminders', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'deadline-001', title: 'Final Project', reminderType: 'day-before' },
      ]),
    });
  });

  await page.goto('/#/student/calendar');
  await expect(page.locator('.cal-deadline-dot')).toHaveCount(1);

  await page.locator('.cal-cell[data-has-class="true"]').first().click();
  await expect(page.locator('.class-list-item')).toContainText('Final Project');
});
