import { test, expect } from '@playwright/test';

test.use({
  launchOptions: {
    channel: 'chrome',
  },
});

test('student notification center shows badge/dropdown and increments on trigger', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
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

  await page.route('**/api/sga/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/tasks**', async (route) => {
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

  await page.route('**/api/notifications/*/read', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'notif-1', unread: false }),
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

  // Test marking as read
  await page.locator('[data-notification-action="mark-read"]').first().click();
  await expect(badge).toBeHidden();

  // Test simulation trigger
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('student:trigger-notification', {
      detail: {
        id: 'notif-ext-test',
        type: 'material',
        title: 'Nuevo material disponible',
        message: 'Se agregó un recurso nuevo.',
        createdAt: new Date().toISOString(),
        targetHash: '#/student/dashboard',
      },
    }));
  });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('1');

  await page.evaluate(() => {
    const dropdown = document.getElementById('notification-dropdown');
    if (dropdown) dropdown.hidden = false;
    const bellBtn = document.getElementById('notification-bell-btn');
    if (bellBtn) bellBtn.setAttribute('aria-expanded', 'true');
  });
  await expect(page.locator('#notification-dropdown')).toBeVisible();
  await page.locator('.notification-item').first().click();
  await expect(page).toHaveURL(/#\/student\/dashboard$/);
});
