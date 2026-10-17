import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

// #495 / UJ-21: el backend numera los fragmentos recuperados 1..N (`<chunk indice="n">`) y el
// modelo cita ese número en el texto (`[n]`). La lista de fuentes que se muestra deduplica por
// material, así que resolver la cita por la POSICIÓN en la lista visible abre otro fragmento.
// Estos tests fijan que la cita abra el fragmento que el modelo citó.

const bootstrap = async (page) => {
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
};

const ask = async (page, sources, answer, esperado = 'calidad') => {
  await page.route('**/api/rag-query*', async route => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: [
        `event: metadata\ndata: ${JSON.stringify({ interactionId: 'cit-1', sources })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ content: answer })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ answer })}\n\n`,
      ].join(''),
    });
  });
  await page.goto('/#/student/dashboard');
  await expect(page.locator('#chat-input')).toBeVisible();
  await page.locator('.source-pill').first().click();
  await expect(page.locator('.source-pill.active')).toBeVisible();
  await page.locator('#chat-input').fill('¿En qué unidad se ven los atributos de calidad?');
  await page.locator('#chat-send').click();
  await expect(page.locator('.chat-msg-assistant .chat-bubble-assistant').last()).toContainText(esperado, { timeout: 20000 });
};

test('the citation number opens the fragment the model cited even when the source list deduplicates', async ({ page }) => {
  await bootstrap(page);

  // Lista cruda (la que ve el modelo): los fragmentos 1 y 2 son del mismo material, el 3 es la
  // respuesta verificada y el 4 otra presentación. Al deduplicar, la lista visible queda 1..3.
  const sources = [
    { materialId: 'mat-dasi', materialType: 'bibliography', sourceFilename: 'DASI Cronograma.docx', chunkIndex: 0, text: 'Cronograma de la asignatura, parte 1.' },
    { materialId: 'mat-dasi', materialType: 'bibliography', sourceFilename: 'DASI Cronograma.docx', chunkIndex: 5, text: 'Cronograma de la asignatura, parte 2.' },
    { materialId: 'corr-abc', materialType: 'verified-answer', sourceFilename: 'correction-abc', slideTitle: 'Respuesta verificada por el docente', chunkIndex: 0, text: 'Los atributos de calidad corresponden a la Unidad III del programa.' },
    { materialId: 'mat-clase1', materialType: 'presentation', sourceFilename: 'Clase 01 Introduccion.pptx', chunkIndex: 0, text: 'Diapositivas de introducción.' },
  ];
  await ask(page, sources, 'Los atributos de calidad de un sistema corresponden a la Unidad III del programa [3].');

  const circles = page.locator('.chat-msg-assistant .source-circle-item');
  await expect(circles).toHaveCount(3); // 4 fragmentos crudos, 2 del mismo material

  // El número del círculo es el índice del fragmento en el contexto del modelo, no la posición.
  const verifiedCircle = circles.filter({ hasText: 'Respuesta verificada por el docente' });
  await expect(verifiedCircle).toHaveAttribute('data-source-index', '3');
  await expect(verifiedCircle.locator('.source-circle-num')).toHaveText('3');

  // La cita [3] del texto abre el fragmento 3 (la respuesta verificada), no la presentación.
  await page.locator('.chat-msg-assistant .citation-ref[data-source-index="3"]').last().click();
  const modal = page.locator('.modal-content');
  await expect(modal).toBeVisible();
  await expect(modal.locator('h3')).toContainText('Respuesta verificada por el docente');
  await expect(modal.locator('.citation-download-btn')).toHaveAttribute('data-material-id', 'corr-abc');
  await expect(modal.locator('.modal-body')).toContainText('Unidad III');
});

test('without duplicates the citation numbering still runs 1..N', async ({ page }) => {
  await bootstrap(page);

  const sources = [
    { materialId: 'mat-a', materialType: 'notes', sourceFilename: 'notas-docente.docx', chunkIndex: 0, text: 'Notas de la clase.' },
    { materialId: 'mat-b', materialType: 'bibliography', sourceFilename: 'bibliografia-cap1.pdf', chunkIndex: 0, text: 'Bibliografía del capítulo 1.' },
    { materialId: 'mat-c', materialType: 'presentation', sourceFilename: 'Clase 02.pptx', chunkIndex: 0, text: 'Diapositivas de la clase 2.' },
  ];
  await ask(page, sources, 'La arquitectura hexagonal desacopla el dominio [3].', 'arquitectura hexagonal');

  const circles = page.locator('.chat-msg-assistant .source-circle-item');
  await expect(circles).toHaveCount(3);
  await expect(circles.nth(0)).toHaveAttribute('data-source-index', '1');
  await expect(circles.nth(1)).toHaveAttribute('data-source-index', '2');
  await expect(circles.nth(2)).toHaveAttribute('data-source-index', '3');

  await page.locator('.chat-msg-assistant .citation-ref[data-source-index="3"]').last().click();
  const modal = page.locator('.modal-content');
  await expect(modal).toBeVisible();
  await expect(modal.locator('h3')).toContainText('Clase 02.pptx');
  await expect(modal.locator('.citation-download-btn')).toHaveAttribute('data-material-id', 'mat-c');
});
