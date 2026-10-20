import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

// Regresión #479 (UJ-02, paso 6): «puede pedir más detalle para esa consulta
// puntual SIN cambiar el ajuste general».
//
// Antes del arreglo la preferencia de longitud era un ajuste único por identidad
// y el chat no tenía ninguna acción por consulta: la única acción de la zona de
// entrada era `#chat-send`, y el servidor aplicaba el techo de «Concisa» a todo
// turno (`maxTokens = botLength === 'concise' ? min(chat, 400) : …`). La única
// salida era cambiar «Longitud de respuesta» en Ajustes.
//
// Lo que este spec mide: el pedido viaja en la petición de ESE turno
// (`lengthOverride`), la preferencia guardada (`edu_bot_length`) no cambia, no
// se llama a `save-profile`, y la consulta siguiente vuelve a ser concisa.

const SUBJECT = 'arq-software-2026';
const CLASES = [
  { id: 'class-01', subjectId: SUBJECT, title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
];

const PREGUNTA = '¿Qué es el acoplamiento entre módulos?';
const RESPUESTA_CONCISA = 'Es la dependencia entre módulos.';
const RESPUESTA_DETALLADA = 'El acoplamiento entre módulos es el grado en que un módulo depende de los detalles internos de otro. Cuanto mayor es el acoplamiento, más difícil resulta cambiar un módulo sin tocar el resto: por eso se busca bajo acoplamiento y alta cohesión.';

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

// El perfil del servidor ES la preferencia guardada: el widget toma de ahí el
// tono y la longitud con los que consulta (y `save-profile` es la única vía que
// la cambia).
const mockPerfil = (page, { botLength = 'concise', botTone = 'formal' } = {}) => page.route('**/api/get-profile*', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    id: 'alu-005',
    role: 'student',
    name: 'Lucas',
    email: 'alu-005@uade.edu.ar',
    theme: 'light',
    consentAccepted: true,
    includeSources: true,
    botTone,
    botLength,
  }),
}));

const mockClases = (page) => page.route('**/api/classes?**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(CLASES),
}));

// SSE mínimo: metadata (id + fuentes) → delta → done. La respuesta con el pedido
// puntual es más larga, que es exactamente lo que el paso 6 pide observar.
const mockRag = (page, capturado) => page.route('**/api/rag-query*', async route => {
  const body = route.request().postDataJSON();
  capturado.push(body);
  const ampliada = body.lengthOverride === 'detailed';
  const answer = ampliada ? RESPUESTA_DETALLADA : RESPUESTA_CONCISA;
  const evento = (nombre, payload) => `event: ${nombre}\ndata: ${JSON.stringify(payload)}\n\n`;
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    body: [
      evento('metadata', { interactionId: `ai-${capturado.length}`, sources: [{ materialType: 'transcript', sourceFilename: 'clase1.txt', sourceIndex: 1 }] }),
      evento('delta', { content: answer }),
      evento('done', { answer }),
    ].join(''),
  });
});

const mockHilo = async (page) => {
  await page.route('**/api/consent*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { accepted: true, acceptedAt: '2026-10-01T00:00:00Z', version: '1' } }) }));
  await page.route('**/api/chat-history?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/conversations/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }));
};

test('UJ-02 paso 6: «Más detalle» amplía una sola consulta sin tocar la preferencia (#479)', async ({ page }) => {
  const ragPayloads = [];
  const guardadosPerfil = [];

  await seedSesion(page);
  await mockPerfil(page);
  await mockClases(page);
  await mockRag(page, ragPayloads);
  await mockHilo(page);
  // Cualquier intento de guardar preferencias queda registrado: no debe ocurrir.
  await page.route('**/api/save-profile*', async route => {
    guardadosPerfil.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });

  await page.goto(`/#/student/dashboard?classId=class-01`);

  const input = page.locator('#chat-input');
  const send = page.locator('#chat-send');
  await expect(input).toBeVisible();

  // La preferencia guardada que llega desde el perfil es «Concisa».
  await expect.poll(() => page.evaluate(() => localStorage.getItem('edu_bot_length'))).toBe('concise');

  // 1. Consulta con la preferencia guardada «Concisa».
  await input.fill(PREGUNTA);
  await send.click();
  await expect(page.locator('#chat-messages')).toContainText(RESPUESTA_CONCISA);

  const respuesta = page.locator('#chat-messages .chat-msg-assistant').last();
  const masDetalle = respuesta.locator('.chat-more-detail-btn');

  // 2. La superficie que el issue declara ausente: una acción por respuesta.
  await expect(masDetalle).toHaveCount(1);
  await expect(masDetalle).toBeVisible();
  await expect(masDetalle).toContainText('Más detalle');

  expect(ragPayloads).toHaveLength(1);
  expect(ragPayloads[0].botLength).toBe('concise');
  expect(ragPayloads[0].lengthOverride).toBeUndefined();

  // 3. Pedir más detalle para ESA consulta.
  await masDetalle.click();
  await expect(page.locator('#chat-messages')).toContainText('grado en que un módulo depende');

  // La segunda petición es la misma consulta, con el alcance del turno y el
  // pedido puntual — la preferencia guardada sigue viajando como «concise».
  expect(ragPayloads).toHaveLength(2);
  expect(ragPayloads[1].question).toBe(PREGUNTA);
  expect(ragPayloads[1].classIds).toEqual(['class-01']);
  expect(ragPayloads[1].lengthOverride).toBe('detailed');
  expect(ragPayloads[1].botLength).toBe('concise');

  // El pedido no reabre el turno: se regenera la misma respuesta, no se agrega
  // otra consulta al hilo (2 mensajes: pregunta + respuesta).
  await expect(page.locator('#chat-messages .chat-msg')).toHaveCount(2);
  // Ya ampliada, la respuesta no vuelve a ofrecer el mismo pedido.
  await expect(page.locator('#chat-messages .chat-more-detail-btn')).toHaveCount(0);

  // 4. La preferencia guardada es la misma después del pedido.
  expect(await page.evaluate(() => localStorage.getItem('edu_bot_length'))).toBe('concise');
  expect(await page.evaluate(() => localStorage.getItem('edu_bot_tone'))).toBe('formal');
  expect(guardadosPerfil).toHaveLength(0);

  // 5. Y la consulta siguiente vuelve a regirse por la preferencia: sin
  //    `lengthOverride` en la petición y con la respuesta breve del mock.
  await input.fill('¿Y la cohesión?');
  await send.click();
  await expect(page.locator('#chat-messages .chat-msg')).toHaveCount(4);
  expect(ragPayloads).toHaveLength(3);
  expect(ragPayloads[2].lengthOverride).toBeUndefined();
  expect(ragPayloads[2].botLength).toBe('concise');
  await expect(page.locator('#chat-messages')).toContainText(RESPUESTA_CONCISA);
});

test('UJ-02 paso 6: con la preferencia «Detallada» no se ofrece «Más detalle» (#479)', async ({ page }) => {
  const ragPayloads = [];

  await seedSesion(page);
  await mockPerfil(page, { botLength: 'detailed' });
  await mockClases(page);
  await mockRag(page, ragPayloads);
  await mockHilo(page);

  await page.goto(`/#/student/dashboard?classId=class-01`);
  await expect(page.locator('#chat-input')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('edu_bot_length'))).toBe('detailed');

  await page.locator('#chat-input').fill(PREGUNTA);
  await page.locator('#chat-send').click();
  await expect(page.locator('#chat-messages')).toContainText(RESPUESTA_CONCISA);

  // Ya está en el máximo desarrollo: no hay nada que ampliar.
  await expect(page.locator('#chat-messages .chat-more-detail-btn')).toHaveCount(0);
});
