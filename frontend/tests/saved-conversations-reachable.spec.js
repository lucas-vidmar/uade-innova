import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

// Regresión #404 (UJ-24, UJ-25): SUP-05 ("Mis Conversaciones Guardadas") tiene
// que ser alcanzable desde la interfaz. El componente existía pero ningún
// control lo abría: el punto de entrada es la acción "Hilos guardados" en la
// barra del chat, y desde ahí se listan, se abren y se borran los hilos.
const SID_A = 'sc-hilo-a';
const SID_B = 'sc-hilo-b';

test('"Mis Conversaciones Guardadas" es alcanzable y gestiona los hilos (#404)', async ({ page }) => {
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

  await page.route('**/api/chat-history?**', route => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, count: 1, conversationsDeleted: 1 }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { sessionId: SID_A, id: 'm1', question: '¿Qué es un SAGA?', answer: 'Un patrón de transacciones distribuidas.', sources: [], timestamp: '2026-10-17T10:00:00Z' },
      ]),
    });
  });

  // El listado de hilos guardados trae una fila por guardado, no por hilo: dos
  // filas del mismo conversationId. La superficie lista hilos, así que debe
  // mostrar un solo ítem por conversationId.
  await page.route('**/api/conversations?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { conversationId: SID_A, subjectId: 'arq-software-2026', firstQuestion: '¿Qué es un SAGA?', messageCount: 4, lastMessageAt: '2026-10-18T12:47:48Z', createdAt: '2026-10-17T10:00:00Z' },
      { conversationId: SID_A, subjectId: 'arq-software-2026', firstQuestion: '¿Qué es un SAGA?', messageCount: 2, lastMessageAt: '2026-10-17T10:05:00Z', createdAt: '2026-10-17T10:00:00Z' },
      { conversationId: SID_B, subjectId: 'arq-software-2026', firstQuestion: '¿Qué es el patrón repositorio?', messageCount: 2, lastMessageAt: '2026-10-16T09:00:00Z', createdAt: '2026-10-16T09:00:00Z' },
    ]),
  }));

  await page.route('**/api/conversations/*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      conversationId: SID_A,
      subjectId: 'arq-software-2026',
      messages: [
        { role: 'user', content: '¿Qué es un SAGA?' },
        { role: 'assistant', content: 'Un patrón de transacciones distribuidas.' },
      ],
    }),
  }));

  const deletes = [];
  page.on('dialog', dialog => dialog.accept());
  page.on('request', request => {
    if (request.method() === 'DELETE' && request.url().includes('/api/chat-history')) deletes.push(request.url());
  });

  await page.goto('/#/student/dashboard');

  // 1. El punto de entrada existe (regresión #404: antes no había ninguno).
  const entry = page.locator('#chat-saved');
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('aria-label', 'Mis Conversaciones Guardadas');

  // 2. Abre la superficie SUP-05.
  await entry.click();
  const modal = page.locator('#saved-conversations-modal-overlay');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Mis Conversaciones Guardadas');

  // 3. Lista los hilos guardados: uno por hilo, sin repetir el conversationId.
  const items = modal.locator('.saved-conversation-item');
  await expect(items).toHaveCount(2);
  await expect(modal).toContainText('¿Qué es un SAGA?');
  await expect(modal).toContainText('¿Qué es el patrón repositorio?');

  // 4. Abrir un hilo desde la superficie lo monta en el chat.
  await items.first().locator('.saved-load-btn').click();
  await expect(page.locator('#saved-conversations-modal-overlay')).toHaveCount(0);
  await expect(page.locator('#chat-messages')).toContainText('¿Qué es un SAGA?');
  expect(new URL(page.url()).hash).toContain(`sessionId=${SID_A}`);

  // 5. Borrar desde la superficie confirma y borra el hilo completo (por
  //    sessionId, no sólo la fila de la conversación guardada).
  await page.locator('#chat-saved').click();
  const modal2 = page.locator('#saved-conversations-modal-overlay');
  await expect(modal2).toBeVisible();
  await modal2.locator('.saved-conversation-item').first().locator('.saved-delete-btn').click();
  await expect.poll(() => deletes.length).toBeGreaterThan(0);
  expect(deletes[0]).toContain(`sessionId=${SID_A}`);
});
