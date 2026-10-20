import { test, expect } from '@playwright/test';

// UJ-49 (#472) — decisión (a): el banco de pruebas enfrenta el comportamiento
// vigente contra uno propuesto SIN ACTIVARLO, caso por caso, y deja constancia de
// que ningún hilo real recibió la versión en prueba. La comparación está acotada a
// 20 casos y el artefacto declara de qué casos parte y qué no alcanza a cubrir.

const MATERIA = 'arq-software-2026';

const INVENTARIO = {
  type: 'rag-master',
  activeVersion: 'v1-baseline',
  versions: [
    { versionId: 'v1-baseline', isActive: true, description: 'baseline', createdAt: '2026-06-29T20:06:15.282Z', model: null },
    { versionId: 'v2-propuesta', isActive: false, description: 'propuesta en prueba', createdAt: '2026-10-18T00:00:00.000Z', model: null },
  ],
};

const CLASES = [
  { id: 'class-01', subjectId: MATERIA, title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
];

const HILOS_REALES = [
  { id: 'interaccion-real-1', question: 'consulta previa del alumno', answer: 'respuesta previa' },
  { id: 'interaccion-real-2', question: 'otra consulta previa', answer: 'otra respuesta previa' },
];

function sse(events) {
  return events.map(([tipo, dato]) => `event: ${tipo}\ndata: ${JSON.stringify(dato)}\n\n`).join('');
}

async function abrirBanco(page, { comparacionPrevia = null } = {}) {
  await page.addInitScript(({ materia, previa }) => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_uid', 'prof-002');
    sessionStorage.setItem('edu_active_subject', materia);
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
    if (previa) localStorage.setItem(`uade.rag-sandbox.comparison.${materia}`, JSON.stringify(previa));
  }, { materia: MATERIA, previa: comparacionPrevia });
}

test('la comparación enfrenta la vigente contra la propuesta y deja constancia medida por caso', async ({ page }) => {
  const pedidos = [];

  await abrirBanco(page);

  await page.route(/\/api\/prompts\/rag-master\/available/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INVENTARIO) });
  });

  await page.route(/\/api\/classes\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLASES) });
  });

  // Hilos reales de la materia: dos turnos ya existentes, antes y después.
  await page.route(/\/api\/chat-history/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HILOS_REALES) });
  });

  await page.route(/\/api\/rag-query/, async (route) => {
    const cuerpo = route.request().postDataJSON();
    pedidos.push(cuerpo);
    const version = cuerpo.promptVersion || 'v1-baseline';
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        ['metadata', { interactionId: `banco-${pedidos.length}`, sources: [], model: 'deepseek-v4-flash', promptVersion: version, sandbox: true }],
        ['delta', { content: `respuesta de ${version}` }],
        ['done', { answer: `respuesta de ${version}` }],
      ]),
    });
  });

  await page.goto('/#/teacher/rag-sandbox');

  // Paso 2: la línea de comparación es enumerable y se muestra cuál rige.
  const selector = page.locator('#sandbox-version');
  await expect(selector).toBeVisible();
  await expect(selector.locator('option').first()).toContainText('Vigente');
  await expect(selector.locator('option').first()).toContainText('v1-baseline');

  // Paso 3: un caso real sobre las clases marcadas.
  await page.locator('#sandbox-chips .source-pill').first().click();
  await selector.selectOption('v2-propuesta');
  await page.locator('#sandbox-compare').check();
  await page.locator('#sandbox-input').fill('¿Qué responsabilidades tiene la capa de aplicación?');
  await page.locator('#sandbox-send').click();

  await expect(page.locator('#sandbox-preview .chat-bubble-assistant')).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator('#sandbox-preview')).toContainText('respuesta de v1-baseline');
  await expect(page.locator('#sandbox-preview')).toContainText('respuesta de v2-propuesta');

  // Paso 4: el MISMO caso se somete a las dos versiones, y la propuesta viaja como
  // pedido de esa consulta — nunca se activa nada.
  expect(pedidos.length).toBe(2);
  expect(pedidos[0].sandbox).toBe(true);
  expect(pedidos[0].promptVersion == null || pedidos[0].promptVersion === '').toBe(true);
  expect(pedidos[1].sandbox).toBe(true);
  expect(pedidos[1].promptVersion).toBe('v2-propuesta');
  expect(pedidos[1].question).toBe(pedidos[0].question);

  // Paso 6: las dos respuestas quedan enfrentadas por caso.
  const caso = page.locator('#sandbox-comparison-list [data-comparison-index="0"]');
  await expect(caso).toBeVisible();
  await expect(caso).toContainText('respuesta de v1-baseline');
  await expect(caso).toContainText('respuesta de v2-propuesta');
  await expect(caso).toContainText('Vigente (v1-baseline)');
  await expect(caso).toContainText('Propuesta (v2-propuesta) — no activada');

  // Constancia medida (no declarada): vigente sin cambios, propuesta inactiva,
  // hilos reales sin turnos nuevos.
  await expect(caso.locator('[data-role="constancia"]')).toContainText('constancia:');
  await expect(caso.locator('[data-role="constancia"]')).toContainText('vigente sin cambios (v1-baseline)');
  await expect(caso.locator('[data-role="constancia"]')).toContainText('propuesta inactiva');
  await expect(caso.locator('[data-role="constancia"]')).toContainText('hilos reales sin turnos nuevos (2)');

  // Paso 7: el veredicto lo marca quien enseña.
  await caso.locator('[data-verdict="mejora"]').click();
  await expect(caso).toContainText('marcado: mejora');

  // Tope declarado: 20 casos.
  await expect(page.locator('#sandbox-comparison-cap')).toContainText('1 de 20');

  // Pasos 9-10: el artefacto es legible por alguien que no participó y declara sus límites.
  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#sandbox-comparison-export').click(),
  ]);
  const stream = await descarga.createReadStream();
  const trozos = [];
  for await (const trozo of stream) trozos.push(trozo);
  const markdown = Buffer.concat(trozos).toString('utf8');

  expect(markdown).toContain('## De qué casos parte');
  expect(markdown).toContain('Clases marcadas: class-01');
  expect(markdown).toContain('Modo: banco de pruebas (sandbox), sin «Simular alumno»');
  expect(markdown).toContain('Comportamiento vigente (línea de comparación): v1-baseline');
  expect(markdown).toContain('Casos comparados: 1 de un tope de 20');
  expect(markdown).toContain('## Veredicto por caso');
  expect(markdown).toContain('- Mejora: 1');
  expect(markdown).toContain('## Constancia de que la propuesta no rigió');
  expect(markdown).toContain('vigente sin cambios (v1-baseline)');
  expect(markdown).toContain('propuesta inactiva');
  expect(markdown).toContain('hilos reales sin turnos nuevos (2)');
  expect(markdown).toContain('### Propuesta (v2-propuesta) — no activada');
  expect(markdown).toContain('## Qué no alcanza a cubrir');
});

test('la comparación y su constancia sobreviven a recargar la pantalla', async ({ page }) => {
  const pedidos = [];

  await abrirBanco(page);
  await page.route(/\/api\/prompts\/rag-master\/available/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INVENTARIO) });
  });
  await page.route(/\/api\/classes\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLASES) });
  });
  await page.route(/\/api\/chat-history/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HILOS_REALES) });
  });
  await page.route(/\/api\/rag-query/, async (route) => {
    pedidos.push(route.request().postDataJSON());
    const version = route.request().postDataJSON().promptVersion || 'v1-baseline';
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        ['metadata', { interactionId: `banco-${pedidos.length}`, sources: [], promptVersion: version, sandbox: true }],
        ['done', { answer: `respuesta de ${version}` }],
      ]),
    });
  });

  await page.goto('/#/teacher/rag-sandbox');
  await page.locator('#sandbox-chips .source-pill').first().click();
  await page.locator('#sandbox-version').selectOption('v2-propuesta');
  await page.locator('#sandbox-compare').check();
  await page.locator('#sandbox-input').fill('caso que tiene que sobrevivir al recargar');
  await page.locator('#sandbox-send').click();
  await expect(page.locator('#sandbox-comparison-list [data-comparison-index="0"]')).toContainText('respuesta de v2-propuesta', { timeout: 15000 });
  await page.locator('#sandbox-comparison-list [data-verdict="empate"]').click();

  await page.reload();

  const caso = page.locator('#sandbox-comparison-list [data-comparison-index="0"]');
  await expect(caso).toBeVisible();
  await expect(caso).toContainText('caso que tiene que sobrevivir al recargar');
  await expect(caso).toContainText('marcado: empate');
  await expect(caso.locator('[data-role="constancia"]')).toContainText('propuesta inactiva');
  await expect(page.locator('#sandbox-comparison-cap')).toContainText('1 de 20');
});

test('al llegar a 20 casos el banco no corre el caso y lo dice, sin gastar una llamada', async ({ page }) => {
  const pedidos = [];
  const previa = Array.from({ length: 20 }, (_, i) => ({
    question: `caso previo ${i + 1}`,
    timestamp: new Date().toISOString(),
    simulateStudent: false,
    classIds: ['class-01'],
    vigente: { versionId: 'v1-baseline', answer: 'a' },
    propuesta: { versionId: 'v2-propuesta', answer: 'b' },
    constancia: null,
    verdict: 'empate',
  }));

  await abrirBanco(page, { comparacionPrevia: previa });

  await page.route(/\/api\/prompts\/rag-master\/available/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INVENTARIO) });
  });
  await page.route(/\/api\/classes\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLASES) });
  });
  await page.route(/\/api\/chat-history/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HILOS_REALES) });
  });
  await page.route(/\/api\/rag-query/, async (route) => {
    pedidos.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([['done', { answer: 'no debería llegar' }]]) });
  });

  await page.goto('/#/teacher/rag-sandbox');

  await expect(page.locator('#sandbox-comparison-cap')).toContainText('20 de 20');
  await page.locator('#sandbox-chips .source-pill').first().click();
  await page.locator('#sandbox-version').selectOption('v2-propuesta');
  await page.locator('#sandbox-compare').check();
  await page.locator('#sandbox-input').fill('caso veintiuno');
  await page.locator('#sandbox-send').click();

  await expect(page.locator('#sandbox-comparison-aviso')).toBeVisible();
  await expect(page.locator('#sandbox-comparison-aviso')).toContainText('Tope de 20 casos alcanzado');
  // El caso no se corrió: no hubo llamada al modelo ni caso 21 en la comparación.
  expect(pedidos.length).toBe(0);
  await expect(page.locator('#sandbox-comparison-list [data-comparison-index]')).toHaveCount(20);
  await expect(page.locator('#sandbox-comparison-cap')).toContainText('20 de 20');
});
