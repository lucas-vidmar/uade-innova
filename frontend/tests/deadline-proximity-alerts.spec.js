import { test, expect } from '@playwright/test';

test.use({
  launchOptions: {
    channel: 'chrome',
  },
});

test('student sees 24h deadline alert in notification center', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-03',
          subjectId: 'arq-software-2026',
          title: 'Clase 3 — Arquitectura Hexagonal y DDD',
          date: '2026-03-19',
          topics: ['Puertos y adaptadores'],
          materials: [],
          summaryReady: true,
        },
      ]),
    });
  });

  await page.route('**/api/sga/tasks?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/deadlines?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'notif-deadline-arq-software-2026-deadline-24h-24h',
          type: 'deadline',
          title: 'Deadline en 24 horas',
          message: 'TP Arquitectura Hexagonal vence el 2026-04-12 · class-03.',
          createdAt: '2026-04-11T12:00:00.000Z',
          unread: true,
          targetHash: '#/student/calendar',
          subjectId: 'arq-software-2026',
        },
      ]),
    });
  });

  await page.goto('/#/student/dashboard');

  const bellButton = page.locator('#notification-bell-btn');
  await expect(bellButton).toBeVisible();
  await bellButton.click();

  await expect(page.getByText('Deadline en 24 horas')).toBeVisible();
  await expect(page.getByText('TP Arquitectura Hexagonal vence el 2026-04-12 · class-03.')).toBeVisible();
  await expect(page.getByText('⏰ Deadline')).toBeVisible();
});
