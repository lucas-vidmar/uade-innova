import { test, expect } from '@playwright/test';

test('student chat request sends x-correlation-id header', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chrome/Chromium-only verification required');

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  await page.route('**/api/classes?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
      ]),
    });
  });

  await page.route('**/api/chat-history?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  let seenCorrelation = null;
  await page.route('**/api/rag-query', async route => {
    seenCorrelation = route.request().headers()['x-correlation-id'] || null;
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: [
        'event: metadata\ndata: {"interactionId":"trace-1","sources":[]}\n\n',
        'event: delta\ndata: {"content":"La arquitectura hexagonal desacopla el dominio."}\n\n',
        'event: done\ndata: {"answer":"La arquitectura hexagonal desacopla el dominio."}\n\n',
      ].join(''),
    });
  });

  await page.goto('/#/student/dashboard');
  await page.locator('#chat-input').fill('Que es arquitectura hexagonal?');
  await page.locator('#chat-send').click();

  await expect(page.locator('.chat-msg-assistant .chat-bubble-assistant').last()).toContainText('desacopla', { timeout: 20000 });
  expect(seenCorrelation).toBeTruthy();
  expect(seenCorrelation.length).toBeGreaterThan(8);
});
