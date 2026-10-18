import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('teacher opens RAG sandbox, selects class, sends query and sees response with sources', async ({ page }) => {
  const capturedRequests = [];

  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-01',
          subjectId: 'arq-software-2026',
          title: 'Clase 1 — Arquitectura',
          date: '2026-03-05',
          topics: [],
          materials: [],
          summaryReady: true,
        },
      ]),
    });
  });

  await page.route('**/api/rag-query?**', async (route) => {
    const requestBody = route.request().postDataJSON();
    capturedRequests.push(requestBody);
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: metadata\ndata: {"interactionId":"sandbox-1","sources":[{"materialType":"transcript","sourceFilename":"clase1.txt","chunkIndex":0,"score":0.91}],"model":"deepseek-v4-flash"}\n\n',
        'event: delta\ndata: {"content":"La arquitectura hexagonal desacopla el dominio de los adaptadores."}\n\n',
        'event: done\ndata: {"answer":"La arquitectura hexagonal desacopla el dominio de los adaptadores."}\n\n',
      ].join(''),
    });
  });

  await page.goto('/#/teacher/rag-sandbox');

  // Warning banner visible
  await expect(page.getByText('Esta consulta consume tokens del presupuesto de IA.')).toBeVisible();

  // Sidebar link present
  await expect(page.locator('#nav-teacher-rag-sandbox-desktop')).toBeVisible();

  // Simular alumno toggle present
  await expect(page.locator('#sandbox-simulate-student')).toBeVisible();

  // Select a class
  await page.locator('#sandbox-chips .source-pill').first().click();
  await expect(page.locator('#sandbox-chips .source-pill.active')).toBeVisible();

  // Type query and send
  await page.locator('#sandbox-input').fill('Que es la arquitectura hexagonal?');
  await page.locator('#sandbox-send').click();

  // Response preview with sources
  await expect(page.locator('#sandbox-preview .chat-bubble-assistant')).toContainText('arquitectura hexagonal', { timeout: 10000 });
  await expect(page.locator('#sandbox-preview .source-circle-item')).toBeVisible({ timeout: 10000 });

  // Source citation expand: click circle opens modal, close works
  await page.locator('#sandbox-preview .source-circle-item').first().click();
  await expect(page.locator('#source-modal-close')).toBeVisible();
  await page.locator('#source-modal-close').click();
  await expect(page.locator('#source-modal-close')).toHaveCount(0);

  // History persisted to localStorage and rendered in the sidebar panel
  const historyRaw = await page.evaluate(() => localStorage.getItem('uade.rag-sandbox.history.arq-software-2026'));
  expect(historyRaw).toBeTruthy();
  const history = JSON.parse(historyRaw || '[]');
  expect(history.length).toBe(1);
  await expect(page.locator('#sandbox-history-list .history-entry')).toHaveCount(1);

  // Request carries sandbox + simulateStudent flags
  expect(capturedRequests.length).toBe(1);
  expect(capturedRequests[0].sandbox).toBe(true);
  expect(capturedRequests[0].simulateStudent).toBe(false);
  expect(capturedRequests[0].question).toContain('arquitectura hexagonal');
});

test('teacher can toggle Simular alumno and send a sandbox query with simulateStudent=true', async ({ page }) => {
  const capturedRequests = [];

  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-01',
          subjectId: 'arq-software-2026',
          title: 'Clase 1 — Arquitectura',
          date: '2026-03-05',
          topics: [],
          materials: [],
          summaryReady: true,
        },
      ]),
    });
  });

  await page.route('**/api/rag-query?**', async (route) => {
    const requestBody = route.request().postDataJSON();
    capturedRequests.push(requestBody);
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: metadata\ndata: {"interactionId":"sandbox-2","sources":[{"materialType":"transcript","sourceFilename":"clase1.txt","chunkIndex":0,"score":0.9}],"model":"deepseek-v4-flash"}\n\n',
        'event: delta\ndata: {"content":"Vista de alumno simulada."}\n\n',
        'event: done\ndata: {"answer":"Vista de alumno simulada."}\n\n',
      ].join(''),
    });
  });

  await page.goto('/#/teacher/rag-sandbox');

  await page.locator('#sandbox-chips .source-pill').first().click();
  await page.locator('#sandbox-simulate-student').check();
  await expect(page.locator('#sandbox-simulate-student')).toBeChecked();

  await page.locator('#sandbox-input').fill('Que ve un alumno?');
  await page.locator('#sandbox-send').click();

  await expect(page.locator('#sandbox-preview .chat-bubble-assistant')).toContainText('Vista de alumno simulada', { timeout: 10000 });

  expect(capturedRequests.length).toBe(1);
  expect(capturedRequests[0].simulateStudent).toBe(true);
});

test.describe('RAG sandbox — hora del historial (#553)', () => {
  // El historial debe mostrar la hora sin ambigüedad (a. m./p. m. o 24 h). Con el
  // formateo anterior (`toLocaleTimeString('es-AR')`) el motor del navegador devuelve
  // 12 h SIN indicador: 00:00:04 se leía «12:00:04», igual que el mediodía.
  test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

  test('muestra la hora de cada consulta con a. m./p. m. (no 12 h sin indicador)', async ({ page }) => {
    // Reloj fijo: 2026-10-18T03:00:04Z == 2026-10-18 00:00:04 en Buenos Aires (UTC-3).
    // En 12 h sin indicador ese instante sale «12:00:04», indistinguible del mediodía.
    await page.clock.setFixedTime(new Date('2026-10-18T03:00:04.000Z'));

    await page.addInitScript(() => {
      localStorage.setItem('uade_use_mock', 'false');
      localStorage.setItem('onboarding-teacher-completed', 'true');
      sessionStorage.setItem('edu_role', 'teacher');
      sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
      sessionStorage.setItem('edu_consent_accepted', 'true');
      sessionStorage.setItem('edu_logged_in', 'true');
    });

    await page.route('**/api/classes?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'class-01',
            subjectId: 'arq-software-2026',
            title: 'Clase 1 — Arquitectura',
            date: '2026-03-05',
            topics: [],
            materials: [],
            summaryReady: true,
          },
        ]),
      });
    });

    await page.route('**/api/rag-query?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          'event: metadata\ndata: {"interactionId":"sandbox-hora","sources":[],"model":"deepseek-v4-flash"}\n\n',
          'event: delta\ndata: {"content":"Respuesta de prueba."}\n\n',
          'event: done\ndata: {"answer":"Respuesta de prueba."}\n\n',
        ].join(''),
      });
    });

    await page.goto('/#/teacher/rag-sandbox');

    await page.locator('#sandbox-chips .source-pill').first().click();
    await page.locator('#sandbox-input').fill('¿Qué es una arquitectura hexagonal?');
    await page.locator('#sandbox-send').click();

    const entry = page.locator('#sandbox-history-list .history-entry').first();
    await expect(entry).toHaveCount(1, { timeout: 10000 });

    // 00:00:04 hora local, sin ambigüedad. El defecto (#553) renderizaba «12:00:04».
    await expect(entry.locator('div').first()).toHaveText('18 oct, 12:00 a. m.');
  });
});
