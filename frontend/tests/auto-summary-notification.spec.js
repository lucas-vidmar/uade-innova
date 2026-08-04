import { test, expect } from '@playwright/test';

test.use({
  launchOptions: {
    channel: 'chrome',
  },
});

test('student sees auto post-class summary notification and can open class', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-03',
          subjectId: 'arq-software-2026',
          title: 'Clase 3 — Arquitectura Hexagonal',
          date: '2026-04-09',
          topics: ['Hexagonal', 'Ports & Adapters'],
          materials: [],
          summaryReady: true,
        },
      ]),
    });
  });

  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/sga/tasks?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'notif-auto-summary-arq-software-2026-class-03',
          type: 'summary',
          title: 'Resumen validado por docente',
          message: 'Clase 3 — Arquitectura Hexagonal ya tiene resumen validado.',
          createdAt: '2026-04-10T10:30:00Z',
          unread: true,
          targetHash: '#/student/class/class-03',
          subjectId: 'arq-software-2026',
          origin: 'post-class-summary-timer',
        },
      ]),
    });
  });

  await page.goto('/#/student/dashboard');

  await expect(page.locator('#notification-bell-btn')).toBeVisible();
  await expect(page.locator('#notification-badge')).toHaveText('1');

  await page.locator('#notification-bell-btn').click();
  await expect(page.locator('#notification-dropdown')).toBeVisible();
  await expect(page.locator('.notification-item')).toHaveCount(1);
  await expect(page.locator('.notification-title')).toContainText('Resumen validado por docente');

  await page.locator('.notification-item').first().click();
  await expect(page).toHaveURL(/#\/student\/class\/class-03$/);
});

test('teacher publish triggers immediate notification dispatch and student sees it', async ({ page }) => {
  let dispatchRequest = null;

  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  const classesFixture = [
    {
      id: 'class-03',
      subjectId: 'arq-software-2026',
      title: 'Clase 3 — Arquitectura Hexagonal',
      date: '2026-04-09',
      topics: ['Hexagonal', 'Ports & Adapters'],
      materials: [],
      summaryReady: true,
      studentIds: ['alu-001'],
    },
  ];

  const publishedNotification = {
    id: 'notif-auto-summary-arq-software-2026-class-03',
    type: 'summary',
    title: 'Resumen validado por docente',
    message: 'Clase 3 — Arquitectura Hexagonal ya tiene resumen validado.',
    createdAt: new Date().toISOString(),
    unread: true,
    targetHash: '#/student/class/class-03',
    subjectId: 'arq-software-2026',
    origin: 'class-publish',
  };

  await page.route('**/api/classes?**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(classesFixture),
    });
  });

  await page.route('**/api/class-summary/class-03', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ summary: { content: '# Resumen\nalgo de contenido' } }),
    });
  });

  await page.route('**/api/class-map/class-03', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mapCode: 'graph TD' }) });
  });

  await page.route('**/api/class-audio-script/class-03', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ script: 'Guión de podcast' }) });
  });

  await page.route('**/api/notifications', async (route) => {
    if (route.request().method() === 'POST') {
      dispatchRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, notificationId: publishedNotification.id }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/sga/tasks?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/#/teacher/class/class-03');

  await expect(page.locator('#btn-approve')).toBeVisible();
  await page.locator('#btn-approve').click();

  await page.waitForTimeout(800);

  expect(dispatchRequest).not.toBeNull();
  expect(dispatchRequest.subjectId).toBe('arq-software-2026');
  expect(dispatchRequest.classId).toBe('class-03');

  // Switch to student and verify the notification appears in the notification center
  await page.evaluate(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_uid', 'alu-001');
    window.location.hash = '#/student/dashboard';
  });

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([publishedNotification]),
    });
  });

  await page.waitForTimeout(1500);
  await expect(page.locator('#notification-bell-btn')).toBeVisible();
  await page.locator('#notification-bell-btn').click();
  await expect(page.locator('#notification-dropdown')).toBeVisible();
  await expect(page.locator('.notification-item')).toHaveCount(1);
  await expect(page.locator('.notification-title')).toContainText('Resumen validado por docente');
  await expect(page.locator('.notification-message')).toContainText('Arquitectura Hexagonal');
});
