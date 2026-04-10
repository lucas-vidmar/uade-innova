import { test, expect } from '@playwright/test';

test.use({
  launchOptions: {
    channel: 'chrome',
  },
});

test('student notification center shows badge/dropdown and increments on trigger', async ({ page }) => {
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

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'notif-1',
          type: 'grade',
          title: 'Nueva nota publicada',
          message: 'Quiz 1: 8.5',
          createdAt: '2026-04-09T11:10:00Z',
          unread: true,
          targetHash: '#/student/tasks',
          subjectId: 'arq-software-2026',
        },
        {
          id: 'notif-2',
          type: 'summary',
          title: 'Resumen validado',
          message: 'Clase 2 tiene resumen validado',
          createdAt: '2026-04-08T10:00:00Z',
          unread: false,
          targetHash: '#/student/dashboard',
          subjectId: 'arq-software-2026',
        },
      ]),
    });
  });

  await page.goto('/#/student/dashboard');

  const bell = page.locator('#notification-bell-btn');
  const badge = page.locator('#notification-badge');

  await expect(bell).toBeVisible();
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('1');

  await bell.click();
  await expect(page.locator('#notification-dropdown')).toBeVisible();
  await expect(page.locator('.notification-item')).toHaveCount(2);

  await page.locator('#notification-simulate').click();
  await expect(badge).toHaveText('2');

  await page.locator('.notification-item').first().click();
  await expect(page).toHaveURL(/#\/student\/dashboard$/);
});
