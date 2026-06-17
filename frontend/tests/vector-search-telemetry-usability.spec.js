import { test, expect } from '@playwright/test';

test.use({
  launchOptions: {
    channel: 'chrome',
  },
});

test('student chat remains usable while vector retrieval telemetry is active', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
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
          title: 'Clase 3 — Arquitectura Hexagonal',
          date: '2026-03-19',
          topics: ['Puertos y adaptadores'],
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
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: [
        'event: metadata\ndata: {"interactionId":"vec-telemetry-01","sources":[{"materialType":"transcript","sourceFilename":"clase3_transcript.txt"}]}\n\n',
        'event: delta\ndata: {"content":"La arquitectura hexagonal separa dominio e infraestructura."}\n\n',
        'event: done\ndata: {"answer":"La arquitectura hexagonal separa dominio e infraestructura."}\n\n',
      ].join(''),
    });
  });

  await page.goto('/#/student/dashboard');

  await expect(page.locator('#chat-input')).toBeVisible();
  await page.locator('.source-pill').first().click();
  await expect(page.locator('.source-pill.active')).toBeVisible();
  await page.locator('#chat-input').fill('Explicame arquitectura hexagonal');
  await page.locator('#chat-send').click();

  await expect(page.locator('.chat-msg-assistant .chat-bubble-assistant').last()).toContainText('separa dominio e infraestructura', { timeout: 20_000 });
  await expect(page.locator('.chat-msg-assistant .source-chip').filter({ hasText: 'clase3_transcript.txt' })).toBeVisible();
});
