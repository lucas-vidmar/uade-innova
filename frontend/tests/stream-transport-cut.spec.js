import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

// Regresión #378 / UJ-29: cuando la conexión se pierde a mitad de la respuesta, el
// corte no siempre llega como cierre del stream sin evento terminal: llega como
// error de transporte (`TypeError: Failed to fetch`). El chat tiene que conservar el
// tramo ya recibido, avisar que la respuesta se interrumpió y ofrecer reintentar la
// misma pregunta, en vez de descartar lo recibido y dejar a la persona sin salida.
const PREGUNTA = 'que atributos de calidad tiene un sistema?';

test('un corte de red a mitad del stream conserva el tramo y ofrece reintentar (#378, UJ-29)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');

    // Corte determinista: el stream de /api/rag-query emite metadata y un tramo de
    // respuesta y después falla, como al perder la conexión a mitad de la respuesta.
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (!/\/api\/rag-query/.test(url)) return originalFetch(input, init);
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: metadata\ndata: {"interactionId":"cut-1","sources":[],"model":"qa-stub"}\n\n'));
          controller.enqueue(encoder.encode('event: delta\ndata: {"content":"Los atributos de calidad son "}\n\n'));
          setTimeout(() => { try { controller.error(new TypeError('Failed to fetch')); } catch (e) {} }, 150);
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    };
  });

  await page.route('**/api/classes?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
    ]),
  }));

  await page.route('**/api/chat-history?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await page.goto('/#/student/dashboard');

  const input = page.locator('#chat-input');
  await expect(input).toBeVisible();
  await page.locator('.source-pill').first().click();
  await expect(page.locator('.source-pill.active')).toBeVisible();

  await input.fill(PREGUNTA);
  await page.locator('#chat-send').click();

  const respuesta = page.locator('.chat-msg-assistant .chat-bubble-assistant').last();
  // Lo recibido antes del corte no se descarta.
  await expect(respuesta).toContainText('Los atributos de calidad son', { timeout: 15000 });
  // La interrupción se declara en vez de mostrarse como respuesta terminada.
  await expect(respuesta).toContainText('se interrumpió antes de completarse');
  // Y queda una salida: reintentar la misma pregunta sin reescribirla.
  await expect(page.locator('.chat-retry-btn')).toHaveCount(1);
  await expect(page.locator('.chat-retry-btn')).toContainText('Reintentar');
  await expect(input).toBeEnabled();
});
