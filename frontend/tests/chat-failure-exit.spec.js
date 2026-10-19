import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

// Regresión #406 / UJ-23: ante un fallo o una demora del asistente la pantalla
// tiene que ofrecer salida. Antes de esta corrección, el mensaje de error venía
// con los botones de calificación ("Respuesta incorrecta" / "Falta un concepto")
// como si fuera una respuesta a evaluar y sin ninguna acción de reintentar; y con
// el servicio que no responde el compositor quedaba deshabilitado para siempre
// (la única salida era recargar la página).

const CLASES = [
  { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
];
const PREGUNTA = 'que es un sistema de informacion?';

/**
 * @param {object} opciones
 *   modo: '503' (fallo del servicio) | 'colgado' (no responde nunca)
 *   firstByteMs: tope de demora de la prueba (en producción son 60 s)
 *   delayNoticeMs: cuándo se declara la demora en pantalla (en producción 15 s)
 */
async function abrirChat(page, opciones = {}) {
  const { modo = '503', firstByteMs = 4000, idleMs = 3000, delayNoticeMs = 1500 } = opciones;

  await page.addInitScript((cfg) => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    window.__uadeChatStreamTimeouts = { firstByteMs: cfg.firstByteMs, idleMs: cfg.idleMs, delayNoticeMs: cfg.delayNoticeMs };

    const originalFetch = window.fetch.bind(window);
    window.__pedidos = [];
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (!/\/api\/rag-query/.test(url)) return originalFetch(input, init);
      let body = null;
      try { body = JSON.parse(init?.body || 'null'); } catch { /* sin cuerpo */ }
      window.__pedidos.push(body?.question || null);

      if (cfg.modo === '503') {
        return Promise.resolve(new Response(JSON.stringify({ error: 'Fallo interno simulado' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      // Servicio que no responde: la promesa no se resuelve nunca. Respeta la
      // señal de cancelación, como el fetch real.
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        const abortar = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (signal.aborted) return abortar();
        signal.addEventListener('abort', abortar);
      });
    };
  }, { modo, firstByteMs, idleMs, delayNoticeMs });

  await page.route('**/api/classes?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(CLASES),
  }));
  await page.route('**/api/chat-history?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await page.goto('/#/student/dashboard');
  const input = page.locator('#chat-input');
  await expect(input).toBeVisible();
  await page.locator('.source-pill').first().click();
  await expect(page.locator('.source-pill.active')).toBeVisible();
  return input;
}

test('un fallo del asistente ofrece reintentar y no se ofrece para calificar (#406)', async ({ page }) => {
  const input = await abrirChat(page, { modo: '503' });
  await input.fill(PREGUNTA);
  await page.locator('#chat-send').click();

  const burbuja = page.locator('.chat-msg-assistant .chat-bubble-assistant').last();
  await expect(burbuja).toContainText('Ocurrió un error interno', { timeout: 10000 });

  // Salida: reintentar la misma pregunta, sin reescribirla.
  await expect(page.locator('.chat-retry-btn')).toHaveCount(1);
  await expect(page.locator('.chat-retry-btn')).toContainText('Reintentar');

  // Un error no es una respuesta: no hay nada que calificar ni que reportar.
  await expect(page.locator('.chat-msg-actions .feedback-btn')).toHaveCount(0);
  await expect(page.locator('.report-issue-btn')).toHaveCount(0);
  await expect(page.locator('.report-missing-keyword-btn')).toHaveCount(0);

  // Y el compositor queda libre: el recorrido puede continuar.
  await expect(input).toBeEnabled();

  // El reintento reenvía la misma pregunta.
  await page.locator('.chat-retry-btn').click();
  await expect.poll(() => page.evaluate(() => window.__pedidos.length)).toBe(2);
  expect(await page.evaluate(() => window.__pedidos[1])).toBe(PREGUNTA);
});

test('un asistente que no responde se declara, libera el compositor y se puede cancelar (#406)', async ({ page }) => {
  const input = await abrirChat(page, { modo: 'colgado', firstByteMs: 5000, idleMs: 5000 });

  await input.fill(PREGUNTA);
  await page.locator('#chat-send').click();

  // Mientras espera: estado visible y salida inmediata, no un campo trabado sin explicación.
  await expect(page.locator('#chat-delay-notice')).toBeVisible();
  await expect(page.locator('#chat-cancel')).toBeVisible();
  await expect(input).toBeDisabled();

  // Pasado el tope de demora el turno se declara: mensaje claro, reintento y
  // compositor liberado (antes quedaba deshabilitado para siempre).
  const burbuja = page.locator('.chat-msg-assistant .chat-bubble-assistant').last();
  await expect(burbuja).toContainText('tardando más de lo esperado', { timeout: 15000 });
  await expect(page.locator('.chat-retry-btn')).toHaveCount(1);
  await expect(input).toBeEnabled();
});

test('cancelar la consulta en curso libera el compositor y ofrece reintentar (#406)', async ({ page }) => {
  // Topes largos: acá la única salida es la cancelación.
  const input = await abrirChat(page, { modo: 'colgado', firstByteMs: 600000, idleMs: 600000, delayNoticeMs: 500 });

  await input.fill(PREGUNTA);
  await page.locator('#chat-send').click();

  // La demora se declara en pantalla mientras sigue esperando.
  await expect(page.locator('#chat-delay-notice')).toContainText('tardando más de lo esperado', { timeout: 10000 });

  await page.locator('#chat-cancel').click();

  const burbuja = page.locator('.chat-msg-assistant .chat-bubble-assistant').last();
  await expect(burbuja).toContainText('Cancelaste la consulta', { timeout: 10000 });
  await expect(page.locator('.chat-retry-btn')).toHaveCount(1);
  await expect(page.locator('.chat-msg-actions .feedback-btn')).toHaveCount(0);
  await expect(input).toBeEnabled();
});
