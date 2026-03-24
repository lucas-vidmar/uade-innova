import { test, expect } from '@playwright/test';

test('student can ask follow-up question and keep logical flow', async ({ page }) => {
  const capturedRequests = [];

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
    const requestBody = route.request().postDataJSON();
    capturedRequests.push(requestBody);
    const responseChunks = requestBody.question.toLowerCase().includes('why is that important')
      ? [
          'event: metadata\ndata: {"interactionId":"test-2","sources":[{"materialType":"transcript","sourceFilename":"clase1.txt"}]}\n\n',
          'event: delta\ndata: {"content":"It is important because it keeps business rules isolated from technology choices."}\n\n',
          'event: done\ndata: {"answer":"It is important because it keeps business rules isolated from technology choices."}\n\n',
        ]
      : [
          'event: metadata\ndata: {"interactionId":"test-1","sources":[{"materialType":"transcript","sourceFilename":"clase1.txt"}]}\n\n',
          'event: delta\ndata: {"content":"La arquitectura hexagonal desacopla el dominio de los adaptadores."}\n\n',
          'event: done\ndata: {"answer":"La arquitectura hexagonal desacopla el dominio de los adaptadores."}\n\n',
        ];

    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: responseChunks.join(''),
    });
  });

  await page.goto('/#/student/chat');

  const input = page.locator('#chat-input');
  const send = page.locator('#chat-send');

  await expect(input).toBeVisible();

  await input.fill('Que es la arquitectura hexagonal?');
  await send.click();

  await expect(page.locator('.chat-msg-user .chat-bubble-user').last()).toContainText('Que es la arquitectura hexagonal?');
  await expect(page.locator('.chat-msg-assistant .chat-bubble-assistant').last()).toBeVisible({ timeout: 20000 });

  await input.fill('Why is that important?');
  await send.click();

  await expect(page.locator('.chat-msg-user .chat-bubble-user').last()).toContainText('Why is that important?');
  await expect(page.locator('.chat-msg-assistant .chat-bubble-assistant').last()).toContainText('business rules', { timeout: 20000 });

  expect(capturedRequests.length).toBe(2);
  expect(Array.isArray(capturedRequests[1].conversationHistory)).toBe(true);
  expect(capturedRequests[1].conversationHistory.length).toBeGreaterThanOrEqual(2);
  expect(capturedRequests[1].historyWindowSize).toBe(4);
});
