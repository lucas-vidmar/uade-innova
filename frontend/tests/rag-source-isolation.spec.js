import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

/* ============================================================
   RAG source isolation canary — frontend scoping assertions
   (Story 3.7 / QA-002)

   NOTE: Story 3.7 (deployed backend source-isolation filter) is OPEN, so this
   spec is mock-only. It pins the CLIENT contract the canary depends on:
   the chat request carries the selected subjectId/classIds (so the backend can
   filter), and the frontend surfaces exactly the (already-filtered) sources the
   backend returns — an out-of-scope source that the backend filter drops never
   reaches the DOM. The backend filter itself is asserted by 3.7's own canary.
   ============================================================ */

test('chat request scopes subjectId/classIds and surfaces only in-scope sources', async ({ page }) => {
  const capturedRequests = [];

  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/subjects*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
  });
  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
      { id: 'class-99', subjectId: 'arq-software-2026', title: 'Clase 99 — Otra', date: '2026-05-20', topics: [], materials: [], summaryReady: true },
    ]) });
  });
  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
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

  await page.route('**/api/rag-query*', async (route) => {
    const requestBody = route.request().postDataJSON();
    capturedRequests.push(requestBody);

    // Backend filter (Story 3.7) has already dropped the out-of-scope source:
    // only class-01 / arq-software-2026 chunks remain in the SSE metadata.
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: [
        'event: metadata\ndata: {"interactionId":"iso-1","sources":[{"materialType":"transcript","subjectId":"arq-software-2026","classId":"class-01","sourceFilename":"clase1_transcript.txt","chunkIndex":3,"score":0.88}],"model":"deepseek-v4-flash"}\n\n',
        'event: delta\ndata: {"content":"La arquitectura hexagonal separa el dominio de la infraestructura."}\n\n',
        'event: done\ndata: {"answer":"La arquitectura hexagonal separa el dominio de la infraestructura."}\n\n',
      ].join(''),
    });
  });

  // Open the chat pre-scoped to class-01.
  await page.goto('/#/student/dashboard?classId=class-01');

  await expect(page.locator('#chat-input')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.source-pill[data-class-id="class-01"].active')).toBeVisible();

  await page.locator('#chat-input').fill('¿Qué vimos sobre arquitectura hexagonal?');
  await page.locator('#chat-send').click();

  // In-scope source surfaces as a citation chip.
  const inScopeChip = page.locator('.chat-msg-assistant .source-circle-item').filter({ hasText: 'clase1_transcript.txt' });
  await expect(inScopeChip).toBeVisible({ timeout: 15000 });

  // The out-of-scope class source is not surfaced (not present anywhere in the DOM).
  await expect(page.locator('.chat-msg-assistant .source-circle-item').filter({ hasText: 'clase99' })).toHaveCount(0);

  // Request carries the selected subjectId + classIds (the backend filter's input).
  expect(capturedRequests.length).toBe(1);
  expect(capturedRequests[0].subjectId).toBe('arq-software-2026');
  expect(capturedRequests[0].classIds).toEqual(['class-01']);
});