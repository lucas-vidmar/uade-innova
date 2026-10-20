import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

// Regresión #408 / UJ-27: dos personas del mismo grupo, con la misma pregunta y
// la misma evidencia, recibían respuestas distintas (o una respuesta y una
// abstención) y no había forma de saber que la diferencia era del muestreo del
// modelo. La decisión (c) deja declarado, en cada respuesta, el modelo y la
// configuración con la que se generó — y distingue la abstención del modelo de
// la falta de material.

const CLASES = [
  { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
];
const PREGUNTA = 'que responsabilidades tiene la capa de aplicacion?';

const GENERATION = {
  model: 'deepseek-v4-flash',
  modelLabel: 'DeepSeek-V4.1-Flash',
  label: 'DeepSeek-V4.1-Flash · temperatura 0 · máx. 1500 tokens · prompt v1-baseline',
  temperature: 0,
  topP: null,
  topPSource: 'proveedor',
  maxTokens: 1500,
  promptVersion: 'v1-baseline',
  determinism: 'temperature-0',
};

const FUENTES = [
  { materialType: 'presentation', materialPriority: 'primary', sourceFilename: 'Clase 01 Introduccion.pptx', slideTitle: 'Capa de aplicación', score: 0.82, text: 'La capa de aplicación coordina casos de uso.' },
];

function sse(events) {
  // Formato SSE: `event: <tipo>` + `data: <json>` + línea en blanco.
  return events.map(([tipo, dato]) => `event: ${tipo}\ndata: ${JSON.stringify(dato)}\n\n`).join('');
}

/**
 * Abre el chat del alumno con el stream del asistente simulado.
 * @param {object} opciones
 *   historial: turnos que devuelve /api/chat-history
 *   respuesta: texto que el modelo "genera"
 *   abstained: si la respuesta es una abstención
 */
async function abrirChat(page, { historial = [], respuesta = 'La capa de aplicación coordina casos de uso.', abstained = false } = {}) {
  await page.addInitScript((cfg) => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (!/\/api\/rag-query/.test(url)) return originalFetch(input, init);
      const body = cfg.abstained
        ? 'No encontré información sobre eso en los materiales seleccionados.'
        : cfg.respuesta;
      const texto = [
        `event: metadata\ndata: ${JSON.stringify({ interactionId: 'i-408', sources: cfg.fuentes, model: cfg.generation.model, promptVersion: cfg.generation.promptVersion, evidenceCount: cfg.fuentes.length, generation: cfg.generation })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ content: body })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ usage: null, answer: body, abstained: cfg.abstained, evidenceCount: cfg.fuentes.length, abstainedWithEvidence: cfg.abstained && cfg.fuentes.length > 0, generation: cfg.generation })}\n\n`,
      ].join('');
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(texto));
          controller.close();
        },
      });
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    };
  }, { ...{ generation: GENERATION, fuentes: FUENTES, respuesta }, abstained });

  await page.route('**/api/classes?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLASES) }));
  await page.route('**/api/chat-history?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(historial) }));

  await page.goto('/#/student/dashboard');
  const input = page.locator('#chat-input');
  await expect(input).toBeVisible();
  await page.locator('.source-pill').first().click();
  await expect(page.locator('.source-pill.active')).toBeVisible();
  return input;
}

test('la respuesta declara modelo y configuración, y la abstención con evidencia se distingue (#408)', async ({ page }) => {
  const input = await abrirChat(page, { abstained: true });
  await input.fill(PREGUNTA);
  await page.locator('#chat-send').click();

  const indicador = page.locator('#chat-messages .model-name-indicator').last();
  await expect(indicador).toBeVisible({ timeout: 15000 });
  await expect(indicador).toContainText('Powered by DeepSeek-V4.1-Flash');
  await expect(indicador).toContainText('temperatura 0');
  await expect(indicador).toContainText('máx. 1500 tokens');
  await expect(indicador).toContainText('prompt v1-baseline');
  // La declaración es legible por máquina para poder comparar dos respuestas.
  await expect(indicador).toHaveAttribute('data-generation-temperature', '0');
  await expect(indicador).toHaveAttribute('data-generation-model', 'deepseek-v4-flash');

  const abstencion = page.locator('#chat-messages .abstention-indicator').last();
  await expect(abstencion).toBeVisible();
  await expect(abstencion).toContainText('no es del material, es del motor');
  await expect(abstencion).toHaveAttribute('data-abstained-with-evidence', 'true');
  await expect(abstencion).toHaveAttribute('data-evidence-count', '1');
});

test('el hilo recuperado conserva la declaración de generación (#408)', async ({ page }) => {
  const historial = [{
    sessionId: 's-408',
    id: 'turno-1',
    question: PREGUNTA,
    answer: 'La capa de aplicación coordina casos de uso.',
    sources: FUENTES,
    generation: GENERATION,
    abstained: false,
    evidenceCount: 1,
    timestamp: '2026-10-20T10:00:00Z',
  }];

  await abrirChat(page, { historial });
  await page.goto('/#/student/dashboard?sessionId=s-408');

  const indicador = page.locator('#chat-messages .model-name-indicator').first();
  await expect(indicador).toBeVisible({ timeout: 15000 });
  await expect(indicador).toContainText('temperatura 0');
  await expect(indicador).toHaveAttribute('data-generation-determinism', 'temperature-0');
});
