import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('student sees 429 guidance when API rate limit is hit', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
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

  await page.route('**/api/rag-query', async (route) => {
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Too many requests' }),
    });
  });

  await page.goto('/#/student/dashboard');

  await expect(page.locator('#chat-input')).toBeVisible();
  await page.locator('.source-pill').first().click();
  await expect(page.locator('.source-pill.active')).toBeVisible();
  await page.locator('#chat-input').fill('¿Qué vimos en clase?');
  await page.locator('#chat-send').click();

  await expect(page.locator('.chat-msg-assistant .chat-bubble-assistant').last()).toContainText(
    'The AI tutor is resting, please try again in a few minutes',
    { timeout: 10000 }
  );
  await expect(page.locator('.chat-msg-assistant .chat-bubble-assistant').last()).toContainText('Categoria: LLM');
});
