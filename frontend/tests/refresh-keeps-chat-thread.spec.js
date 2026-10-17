import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

// Regresión #402 (UJ-23, UJ-24): un refresco (F5) a mitad del hilo de chat no
// debe sacar la conversación de la vista. El hilo abierto queda identificado en
// la URL (`#/student/dashboard?sessionId=<sid>`), y eso es lo que permite que el
// refresco vuelva a montar la misma conversación en vez del panel de bienvenida.
const SID = 'rv2-refresh-session';
const PREGUNTA = 'que bibliografia se recomienda?';

test('un refresco a mitad del hilo no pierde la conversación (#402)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
  });

  await page.route('**/api/classes?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
    ]),
  }));

  await page.route('**/api/chat-history?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { sessionId: SID, id: 'm1', question: PREGUNTA, answer: 'LAUDON & LAUDON, Capítulo 1.', sources: [], timestamp: '2026-10-17T10:00:00Z' },
    ]),
  }));

  await page.goto(`/#/student/dashboard?sessionId=${SID}`);

  // El hilo abierto por enlace se monta y la URL lo sigue identificando.
  await expect(page.locator('#chat-messages .chat-msg')).toHaveCount(2);
  await expect(page.locator('#chat-messages')).toContainText(PREGUNTA);
  expect(new URL(page.url()).hash).toContain(`sessionId=${SID}`);

  // F5 a mitad del hilo: la conversación sigue en la vista.
  await page.reload();

  await expect(page.locator('#chat-messages .chat-msg')).toHaveCount(2);
  await expect(page.locator('#chat-messages')).toContainText(PREGUNTA);
  await expect(page.locator('.chat-welcome-container')).toHaveCount(0);
  expect(new URL(page.url()).hash).toContain(`sessionId=${SID}`);
});
