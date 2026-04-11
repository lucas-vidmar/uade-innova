import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('student sees primary and secondary material tags in chat sources', async ({ page }) => {
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
        'event: metadata\ndata: {"interactionId":"prio-chat-1","sources":[{"materialType":"notes","materialPriority":"primary","sourceFilename":"apuntes-docente.md"},{"materialType":"bibliography","materialPriority":"secondary","sourceFilename":"clean-architecture.pdf"}]}\n\n',
        'event: delta\ndata: {"content":"Los apuntes del docente priorizan el dominio; la bibliografia lo respalda."}\n\n',
        'event: done\ndata: {"answer":"Los apuntes del docente priorizan el dominio; la bibliografia lo respalda."}\n\n',
      ].join(''),
    });
  });

  await page.goto('/#/student/dashboard');

  await expect(page.locator('#chat-input')).toBeVisible();
  await page.locator('#chat-input').fill('Explicame hexagonal con fuentes');
  await page.locator('#chat-send').click();

  const lastAssistant = page.locator('.chat-msg-assistant').last();
  await expect(lastAssistant.locator('.source-chip').filter({ hasText: 'apuntes-docente.md' }).locator('.source-priority')).toContainText('Primario');
  await expect(lastAssistant.locator('.source-chip').filter({ hasText: 'clean-architecture.pdf' }).locator('.source-priority')).toContainText('Secundario');
});
