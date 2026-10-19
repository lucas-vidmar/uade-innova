import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

// Regresión #401 (UJ-23, UJ-24): el hilo de conversación tiene que registrar y
// restaurar el alcance de cada tramo.
//   UJ-23: "el cambio de alcance queda registrado en el hilo sin borrar lo ya
//   dicho", "cada parte de la respuesta queda atribuida a su alcance", "el hilo
//   queda guardado con su alcance explícito y trazable".
//   UJ-24: al retomar, "el alcance y la evidencia previos siguen visibles en el
//   hilo" (las fuentes de consulta no vuelven vacías).
//
// Antes del arreglo: ninguna respuesta llevaba marca de alcance
// (`alcancePorMensaje: 0`), el auto-guardado descartaba el alcance
// (`messages.map(m => ({ role, content }))`) y al reabrir el hilo las fuentes
// arrancaban vacías con el input deshabilitado.

const SUBJECT = 'arq-software-2026';
const SID = 'chat-scope-session';
const CLASES = [
  { id: 'class-01', subjectId: SUBJECT, title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
  { id: 'class-02', subjectId: SUBJECT, title: 'Clase 2 — Patrones', date: '2026-03-12', topics: [], materials: [], summaryReady: true },
  { id: 'class-03', subjectId: SUBJECT, title: 'Clase 3 — Calidad', date: '2026-03-19', topics: [], materials: [], summaryReady: true },
];

const PREGUNTA_1 = 'que se vio en el primer encuentro?';
const PREGUNTA_2 = 'y que bibliografia corresponde a esa comparacion?';

const seedSesion = async (page) => {
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
};

const mockClases = (page) => page.route('**/api/classes?**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(CLASES),
}));

// SSE mínimo: metadata (id + fuentes) → delta → done.
const mockRag = (page, captured) => page.route('**/api/rag-query*', async route => {
  const body = route.request().postDataJSON();
  captured.push(body);
  const n = captured.length;
  const answer = n === 1 ? 'En el primer encuentro se presento la arquitectura.' : 'La bibliografia es Bass, Cap. 1.';
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    body: [
      `event: metadata\ndata: ${JSON.stringify({ interactionId: `ai-${n}`, sources: [{ materialType: 'transcript', sourceFilename: 'clase1.txt', sourceIndex: 1 }] })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ content: answer })}\n\n`,
      `event: done\ndata: ${JSON.stringify({ answer })}\n\n`,
    ].join(''),
  });
});

// Selectores del issue: la marca de alcance por respuesta en el hilo.
const marcasDeAlcance = (page) => page.locator('#chat-messages [data-scope], #chat-messages .chat-scope, #chat-messages [class*=scope-]');

test('UJ-23: el cambio de alcance a mitad del hilo queda registrado y atribuido (#401)', async ({ page }) => {
  const ragPayloads = [];
  const guardados = [];

  await seedSesion(page);
  await mockClases(page);
  await mockRag(page, ragPayloads);
  await page.route('**/api/chat-history?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/conversations/**', async route => {
    if (route.request().method() === 'PUT') guardados.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.goto('/#/student/dashboard?classId=class-01');

  const input = page.locator('#chat-input');
  const send = page.locator('#chat-send');

  // Tramo 1: acotado a Clase 1.
  await expect(page.locator('[data-class-id="class-01"]')).toHaveClass(/active/);
  await input.fill(PREGUNTA_1);
  await send.click();
  await expect(page.locator('#chat-messages .chat-msg')).toHaveCount(2);
  await expect(page.locator('#chat-messages')).toContainText('se presento la arquitectura');

  // El primer tramo ya declara su alcance.
  await expect(marcasDeAlcance(page)).toHaveCount(1);
  await expect(page.locator('#chat-messages .chat-scope').first()).toHaveAttribute('data-scope', 'Clase 1');
  await expect(page.locator('#chat-messages .chat-scope').first()).toHaveAttribute('data-scope-ids', 'class-01');

  // Tramo 2: se amplía el alcance a Clase 1 + Clase 2 y se pregunta una comparación.
  await page.locator('[data-class-id="class-02"]').click();
  await expect(page.locator('[data-class-id="class-02"]')).toHaveClass(/active/);
  await input.fill(PREGUNTA_2);
  await send.click();
  await expect(page.locator('#chat-messages .chat-msg')).toHaveCount(4);
  await expect(page.locator('#chat-messages')).toContainText('La bibliografia es Bass');

  // Los dos tramos son distinguibles: cada respuesta queda atribuida a su alcance
  // y lo ya dicho sigue visible (no se borra el tramo anterior).
  await expect(marcasDeAlcance(page)).toHaveCount(2);
  const etiquetas = await page.locator('#chat-messages .chat-scope').allTextContents();
  expect(etiquetas[0]).toContain('Clase 1');
  expect(etiquetas[1]).toContain('Clase 1, Clase 2');
  expect(etiquetas[0]).not.toBe(etiquetas[1]);
  await expect(page.locator('#chat-messages')).toContainText(PREGUNTA_1);

  // El payload de cada turno llevó su alcance (contraste medido del issue).
  expect(ragPayloads[0].classIds).toEqual(['class-01']);
  expect(ragPayloads[1].classIds).toEqual(['class-01', 'class-02']);

  // Y el hilo guardado conserva el alcance de cada tramo: antes se guardaba
  // sólo { role, content } y el alcance se perdía.
  await expect.poll(() => guardados.length).toBeGreaterThan(0);
  const mensajesGuardados = guardados[guardados.length - 1].messages;
  expect(mensajesGuardados.map(m => m.classIds)).toEqual([
    ['class-01'],
    ['class-01'],
    ['class-01', 'class-02'],
    ['class-01', 'class-02'],
  ]);
});

test('UJ-24: al reabrir el hilo se restauran el alcance y la evidencia de cada tramo (#401)', async ({ page }) => {
  await seedSesion(page);
  await mockClases(page);
  await page.route('**/api/chat-history?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { sessionId: SID, id: 'ai-1', question: PREGUNTA_1, answer: 'En el primer encuentro se presento la arquitectura.', classIds: ['class-01'], sources: [{ materialType: 'transcript', sourceFilename: 'clase1.txt', sourceIndex: 1 }], timestamp: '2026-10-16T10:00:00Z' },
      { sessionId: SID, id: 'ai-2', question: PREGUNTA_2, answer: 'La bibliografia es Bass, Cap. 1.', classIds: ['class-01', 'class-02'], sources: [{ materialType: 'bibliography', sourceFilename: 'bass.txt', sourceIndex: 2 }], timestamp: '2026-10-16T10:05:00Z' },
    ]),
  }));
  await page.route('**/api/rag-query*', route => route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: '' }));

  await page.goto(`/#/student/dashboard?sessionId=${SID}`);

  // El hilo vuelve con sus dos tramos y la evidencia sigue visible.
  await expect(page.locator('#chat-messages .chat-msg')).toHaveCount(4);
  await expect(page.locator('#chat-messages')).toContainText('se presento la arquitectura');
  await expect(page.locator('#chat-messages .source-circle-item')).toHaveCount(2);

  // El alcance de cada tramo sigue declarado en el hilo.
  await expect(marcasDeAlcance(page)).toHaveCount(2);
  const etiquetas = await page.locator('#chat-messages .chat-scope').allTextContents();
  expect(etiquetas[0]).toContain('Clase 1');
  expect(etiquetas[1]).toContain('Clase 1, Clase 2');

  // Y las fuentes de consulta se restauran con el alcance del último tramo, en
  // vez de arrancar vacías con el input deshabilitado.
  await expect(page.locator('[data-class-id="class-01"]')).toHaveClass(/active/);
  await expect(page.locator('[data-class-id="class-02"]')).toHaveClass(/active/);
  await expect(page.locator('[data-class-id="class-03"]')).not.toHaveClass(/active/);
  await expect(page.locator('#chat-input')).toBeEnabled();
  await expect(page.locator('.chat-empty-hint')).toHaveCount(0);
});

test('UJ-24: un hilo viejo sin alcance declarado no queda deshabilitado (#401)', async ({ page }) => {
  await seedSesion(page);
  await mockClases(page);
  await page.route('**/api/chat-history?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { sessionId: SID, id: 'ai-1', question: PREGUNTA_1, answer: 'Respuesta vieja sin alcance.', sources: [], timestamp: '2026-10-10T10:00:00Z' },
    ]),
  }));
  await page.route('**/api/rag-query*', route => route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: '' }));

  await page.goto(`/#/student/dashboard?sessionId=${SID}&classId=class-03`);

  await expect(page.locator('#chat-messages .chat-msg')).toHaveCount(2);
  // Sin alcance declarado no se inventa una etiqueta…
  await expect(marcasDeAlcance(page)).toHaveCount(0);
  // …y el hilo sigue siendo continuable con la clase del enlace.
  await expect(page.locator('[data-class-id="class-03"]')).toHaveClass(/active/);
  await expect(page.locator('#chat-input')).toBeEnabled();
});
