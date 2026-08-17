import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('student sees 429 guidance and cooldown countdown when API rate limit is hit', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
  });

  await page.route('**/api/subjects*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
  });

  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.route('**/api/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/deadlines?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-01',
          subjectId: 'arq-software-2026',
          title: 'Clase 1 — Arquitectura',
          date: '2026-03-05',
          topics: [],
          materials: [],
          summaryReady: true,
        },
      ]),
    });
  });

  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/rag-query*', async (route) => {
    await route.fulfill({
      status: 429,
      headers: {
        'Retry-After': '5',
        'Access-Control-Expose-Headers': 'Retry-After',
      },
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Too many requests', errorCategory: 'RATE_LIMIT' }),
    });
  });

  await page.goto('/#/student/dashboard');

  await expect(page.locator('#chat-input')).toBeVisible();
  await page.locator('.source-pill').first().click();
  await expect(page.locator('.source-pill.active')).toBeVisible();
  await page.locator('#chat-input').fill('¿Qué vimos en clase?');

  const sendBtn = page.locator('#chat-send');
  await sendBtn.click();

  await expect(page.locator('.chat-msg-assistant .chat-bubble-assistant').last()).toContainText(
    'Se alcanzó el límite de consultas',
    { timeout: 10000 }
  );

  await expect(sendBtn).toBeDisabled();
  await expect(sendBtn).toContainText('Esperá');
  await expect(sendBtn).toHaveClass(/cooldown/);

  await expect(sendBtn).toBeEnabled({ timeout: 10000 });
  await expect(sendBtn).not.toHaveClass(/cooldown/);
});
