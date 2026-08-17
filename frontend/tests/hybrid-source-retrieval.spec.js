import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

test('student sees mixed notes and bibliography sources in chat response', async ({ page }) => {
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

  await page.route('**/api/rag-query*', async route => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: [
        'event: metadata\ndata: {"interactionId":"hybrid-1","sources":[{"materialType":"notes","sourceFilename":"notas-docente.docx"},{"materialType":"bibliography","sourceFilename":"bibliografia-cap1.pdf"}]}\n\n',
        'event: delta\ndata: {"content":"Segun las notas del docente y la bibliografia, la arquitectura hexagonal desacopla el dominio."}\n\n',
        'event: done\ndata: {"answer":"Segun las notas del docente y la bibliografia, la arquitectura hexagonal desacopla el dominio."}\n\n',
      ].join(''),
    });
  });

  await page.goto('/#/student/dashboard');

  await expect(page.locator('#chat-input')).toBeVisible();
  await page.locator('.source-pill').first().click();
  await expect(page.locator('.source-pill.active')).toBeVisible();
  await page.locator('#chat-input').fill('Explicame arquitectura hexagonal');
  await page.locator('#chat-send').click();

  await expect(page.locator('.chat-msg-assistant .chat-bubble-assistant').last()).toContainText('arquitectura hexagonal', { timeout: 20000 });
  await expect(page.locator('.chat-msg-assistant .source-circle-item').filter({ hasText: 'notas-docente.docx' })).toBeVisible();
  await expect(page.locator('.chat-msg-assistant .source-circle-item').filter({ hasText: 'bibliografia-cap1.pdf' })).toBeVisible();
});
