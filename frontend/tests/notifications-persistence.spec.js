import { test, expect } from '@playwright/test';

test.use({
  launchOptions: {
    channel: 'chrome',
  },
});

test('notification read state persists across reloads', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  const notifications = [
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
      unread: true,
      targetHash: '#/student/dashboard',
      subjectId: 'arq-software-2026',
    },
  ];

  let readIds = [];

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
    const body = notifications.map((item) => ({ ...item, unread: !readIds.includes(item.id) }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route('**/api/notifications/read', async (route) => {
    const payload = route.request().postDataJSON();
    readIds = Array.from(new Set([...(readIds || []), ...((payload?.notificationIds || []))]));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updated: readIds.length }) });
  });

  await page.route('**/api/notifications/*/read', async (route) => {
    const payload = route.request().postDataJSON();
    const match = route.request().url().match(/notifications\/(.+)\/read/);
    const id = match ? decodeURIComponent(match[1]) : null;
    if (id) readIds = Array.from(new Set([...(readIds || []), id]));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, unread: false, subjectId: payload?.subjectId }) });
  });

  await page.goto('/#/student/dashboard');
  await page.locator('#notification-bell-btn').click();
  await expect(page.locator('#notification-badge')).toHaveText('2');

  await page.locator('#notification-mark-read').click();
  await expect(page.locator('#notification-badge')).toBeHidden();

  await page.reload();
  await page.locator('#notification-bell-btn').click();
  await expect(page.locator('#notification-badge')).toBeHidden();
  await expect(page.locator('.notification-item.unread')).toHaveCount(0);
});
