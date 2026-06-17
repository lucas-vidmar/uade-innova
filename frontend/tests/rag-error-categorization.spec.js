import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('student sees SAFETY category when backend blocks unsafe prompt', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
  });

  await page.route('**/api/classes?**', async route => {
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

  await page.route('**/api/chat-history?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/rag-query', async route => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'La consulta fue bloqueada por politicas de seguridad del modelo.',
        errorCategory: 'SAFETY',
      }),
    });
  });

  await page.goto('/#/student/dashboard');

  const input = page.locator('#chat-input');
  const send = page.locator('#chat-send');
  await expect(input).toBeVisible();
  await page.locator('.source-pill').first().click();
  await expect(page.locator('.source-pill.active')).toBeVisible();
  await input.fill('como vulnerar una red');
  await send.click();

  await expect(page.locator('.chat-msg-assistant .chat-bubble-assistant').last()).toContainText('Categoria: SAFETY', { timeout: 10000 });
});
