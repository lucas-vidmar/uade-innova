import { test, expect } from '@playwright/test';

// Story 10.24 / AC #2 — the notification stream must not loop on HTTP 403:
//   - an authorized stream receives a snapshot without 403s,
//   - a hard 403 is terminal (no reconnect churn) and dispatches an actionable
//     error, while transient/5xx failures keep the backoff reconnect.
//
// These run in the real browser against the dev server by driving the
// notification-stream module directly, which keeps the assertions deterministic
// regardless of how many times the SPA shell re-renders during boot.

test.use({
  launchOptions: {
    channel: 'chrome',
  },
});

// Real SWA auth so the app boots to the student dashboard instead of
// redirecting to the Microsoft sign-in page (which would abort in-flight fetches).
async function seedDashboard(page) {
  await page.route('**/.auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        clientPrincipal: {
          userId: '00000000-0000-0000-0000-000000000001',
          userDetails: 'lvidmar@uade.edu.ar',
          identityProvider: 'aad',
          userRoles: ['authenticated'],
          claims: [],
        },
      }),
    });
  });
  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/subjects', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
  });
  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.goto('/#/student/dashboard');
}

test('authorized stream receives a snapshot without 403s', async ({ page }) => {
  await page.route('**/api/notifications/stream?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'event: snapshot\ndata: {"notifications":[{"id":"n-live","type":"material","title":"Nueva clase","message":"Material disponible","createdAt":"2026-08-16T12:00:00Z","unread":true,"targetHash":"#/student/dashboard","subjectId":"arq-software-2026"}],"userId":"alu-001"}\n\n',
    });
  });

  await seedDashboard(page);
  const snapshot = await page.evaluate(async () => {
    const { createNotificationStream } = await import('/src/services/notification-stream.js');
    const { api } = await import('/src/services/api.js');
    const stream = createNotificationStream();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stream.stop(); reject(new Error('snapshot timeout')); }, 8000);
      stream.onSnapshot = (data) => {
        clearTimeout(timer);
        stream.stop();
        resolve(data);
      };
      stream.start({ userId: 'alu-001', subjectId: 'arq-software-2026' });
    });
  });

  expect(snapshot).toBeTruthy();
  expect(snapshot.notifications).toHaveLength(1);
  expect(snapshot.notifications[0].id).toBe('n-live');
});

test('hard 403 is terminal: no reconnect churn and an actionable error is dispatched', async ({ page }) => {
  await seedDashboard(page);
  const result = await page.evaluate(async () => {
    const { createNotificationStream } = await import('/src/services/notification-stream.js');
    const { api } = await import('/src/services/api.js');

    const original = api.subscribeNotificationStream;
    let calls = 0;
    api.subscribeNotificationStream = async () => {
      calls += 1;
      const err = new Error('Forbidden - Notification scope does not match authenticated user');
      err.status = 403;
      err.code = 'NOTIFICATION_SCOPE';
      throw err;
    };

    try {
      const stream = createNotificationStream();
      let errorDetail = null;
      stream.onError = (d) => { errorDetail = d; };
      await stream.start({ userId: 'u-lvidmar_uade_edu_ar', subjectId: 'arq-software-2026' });

      // Longer than the initial 1s backoff: a buggy reconnect loop would leave
      // the stream `isRunning` and keep issuing attempts within this window.
      await new Promise((r) => setTimeout(r, 2500));

      const stillRunning = stream.isRunning;
      stream.stop();
      return { errorDetail, stillRunning };
    } finally {
      api.subscribeNotificationStream = original;
    }
  });

  // The hard 403 must terminate: no reconnect, actionable error dispatched.
  expect(result.stillRunning).toBe(false);
  expect(result.errorDetail).toBeTruthy();
  expect(result.errorDetail.status).toBe(403);
  expect(result.errorDetail.code).toBe('NOTIFICATION_SCOPE');
});

test('transient 5xx keeps the backoff reconnect (only hard 403 is terminal)', async ({ page }) => {
  await seedDashboard(page);
  const result = await page.evaluate(async () => {
    const { createNotificationStream } = await import('/src/services/notification-stream.js');
    const { api } = await import('/src/services/api.js');

    const original = api.subscribeNotificationStream;
    let calls = 0;
    api.subscribeNotificationStream = async () => {
      calls += 1;
      const err = new Error('Stream connection failed (500)');
      err.status = 500;
      err.retryable = true;
      throw err;
    };

    try {
      const stream = createNotificationStream();
      let errorDetail = null;
      stream.onError = (d) => { errorDetail = d; };
      await stream.start({ userId: 'alu-001', subjectId: 'arq-software-2026' });

      // Transient failures schedule a backoff reconnect instead of terminating.
      await new Promise((r) => setTimeout(r, 2500));

      const stillRunning = stream.isRunning;
      stream.stop();
      return { calls, errorDetail, stillRunning };
    } finally {
      api.subscribeNotificationStream = original;
    }
  });

  expect(result.calls).toBeGreaterThanOrEqual(2);
  expect(result.stillRunning).toBe(true);
  expect(result.errorDetail).toBeNull();
});