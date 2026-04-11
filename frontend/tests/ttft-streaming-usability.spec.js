import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

test('student sees incremental streaming response in chat', async ({ page }) => {
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
        { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
      ]),
    });
  });

  await page.route('**/api/chat-history?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/rag-query', async route => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: [
        'event: metadata\ndata: {"interactionId":"ttft-1","sources":[{"materialType":"transcript","sourceFilename":"clase1.txt"}]}\n\n',
        'event: delta\ndata: {"content":"Primera parte"}\n\n',
        'event: delta\ndata: {"content":" y segunda parte."}\n\n',
        'event: done\ndata: {"answer":"Primera parte y segunda parte."}\n\n',
      ].join(''),
    });
  });

  await page.goto('/#/student/dashboard');

  await page.locator('#chat-input').fill('Explicame arquitectura hexagonal');
  await page.locator('#chat-send').click();

  const assistantBubble = page.locator('.chat-msg-assistant .chat-bubble-assistant').last();
  await expect(assistantBubble).toContainText('Primera parte', { timeout: 20000 });
  await expect(assistantBubble).toContainText('segunda parte.', { timeout: 20000 });
});
