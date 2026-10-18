import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

// #392 — El estado del alta no puede vivir sólo en la memoria de la pestaña:
// (1) "Procesando" tiene que traer un plazo visible, (2) un refresco a mitad de
// la carga no puede perder la operación en silencio, y (3) la misma pieza no se
// puede cargar dos veces sin aviso.

const CLASES = [
  {
    id: 'class-06',
    subjectId: 'arq-software-2026',
    title: 'Clase 6 — Seguridad en Arquitecturas',
    date: '2026-04-17',
    topics: [],
    summaryReady: false,
    materials: [],
  },
];

async function seedTeacher(page) {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
    sessionStorage.setItem('edu_token', 'e2e-token');
  });
}

async function stubApi(page, posts, { ingestDelayMs = 0 } = {}) {
  // El catch-all va PRIMERO: en Playwright la ruta registrada al final gana, así
  // que las rutas específicas tienen que quedar por encima de ésta.
  await page.route('**/api/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ role: 'teacher', consentAccepted: true, subjects: [{ id: 'arq-software-2026', name: 'Arquitectura' }] }),
  }));
  await page.route('**/api/get-profile**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ role: 'teacher', consentAccepted: true, subjects: [{ id: 'arq-software-2026', name: 'Arquitectura' }] }),
  }));
  await page.route('**/api/classes**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(CLASES),
  }));
  // El material queda en "processing": es el estado que hay que saber leer.
  await page.route('**/api/material-status**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'processing' }),
  }));
  await page.route('**/api/ingest-material**', async route => {
    posts.push(route.request().postData() || '');
    // Con demora, la carga queda a mitad de camino y se puede cortar con un F5.
    if (ingestDelayMs) await new Promise(resolve => setTimeout(resolve, ingestDelayMs));
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ materialId: `mat-392-${posts.length}`, status: 'processing' }),
    }).catch(() => {});
  });
}

test('el "Procesando" trae un plazo visible en vez de un cartel mudo', async ({ page }) => {
  const posts = [];
  await seedTeacher(page);
  await stubApi(page, posts);

  await page.goto('/#/teacher/upload');
  await page.locator('.tab-btn[data-tab="transcript"]').click();
  await page.locator('#file-input-transcript').setInputFiles({
    name: 'uj06-plazo.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('transcripcion de prueba para el plazo'),
  });

  await expect(page.locator('.file-item-name').filter({ hasText: 'uj06-plazo.txt' }).first()).toBeVisible({ timeout: 15000 });
  // Mientras el servidor procesa, la fila dice cuánto puede tardar.
  await expect(page.locator('#file-list-transcript .file-item-hint').first()).toContainText('puede tardar unos minutos');
  await expect(page.locator('#file-list-transcript .file-item-hint').first()).toContainText('Procesando hace');
});

test('la misma pieza no se carga dos veces sin aviso', async ({ page }) => {
  const posts = [];
  await seedTeacher(page);
  await stubApi(page, posts);

  await page.goto('/#/teacher/upload');
  await page.locator('.tab-btn[data-tab="transcript"]').click();

  const archivo = { name: 'uj06-duplicado.txt', mimeType: 'text/plain', buffer: Buffer.from('misma pieza, dos veces') };

  await page.locator('#file-input-transcript').setInputFiles(archivo);
  await expect(page.locator('.file-item-name').filter({ hasText: 'uj06-duplicado.txt' }).first()).toBeVisible({ timeout: 15000 });
  expect(posts.length).toBe(1);

  // Segunda vez: avisa antes de subir nada.
  await page.locator('#file-input-transcript').setInputFiles(archivo);
  const dialogo = page.locator('.modal-overlay');
  await expect(dialogo).toBeVisible({ timeout: 10000 });
  await expect(dialogo).toContainText('Material duplicado');
  await expect(dialogo).toContainText('uj06-duplicado.txt');
  expect(posts.length).toBe(1);

  // Cancelar no sube nada.
  await dialogo.locator('.dialog-cancel').click();
  await expect(dialogo).toHaveCount(0);
  expect(posts.length).toBe(1);

  // Elegir "Cargar igual" sí sube la segunda copia (la decisión es explícita).
  await page.locator('#file-input-transcript').setInputFiles(archivo);
  await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 10000 });
  await page.locator('.modal-overlay .dialog-confirm').click();
  await expect.poll(() => posts.length, { timeout: 10000 }).toBe(2);

  // Y las copias homónimas quedan distinguibles en la lista.
  await expect(page.locator('#file-list-transcript .file-item-tag').first()).toBeVisible({ timeout: 10000 });
});

test('un refresco a mitad de la carga deja un aviso explícito, no un silencio', async ({ page }) => {
  const posts = [];

  // Un refresco con una carga en vuelo: el navegador puede pedir confirmación;
  // se acepta para poder simular el F5 (el diálogo nativo no es el objeto del test).
  page.on('dialog', async dialog => {
    if (dialog.type() === 'beforeunload') await dialog.accept();
    else await dialog.dismiss();
  });

  await seedTeacher(page);
  await stubApi(page, posts, { ingestDelayMs: 4000 });

  await page.goto('/#/teacher/upload');
  await page.locator('.tab-btn[data-tab="transcript"]').click();

  await page.locator('#file-input-transcript').setInputFiles({
    name: 'uj06-refresco.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('carga que se corta con un F5'),
  });

  await page.waitForTimeout(700);
  expect(posts.length).toBe(1);
  await expect(page.locator('#upload-interrumpida')).toHaveCount(0);

  // F5 a mitad de camino.
  await page.reload({ waitUntil: 'domcontentloaded' });

  const aviso = page.locator('#upload-interrumpida');
  await expect(aviso).toBeVisible({ timeout: 15000 });
  await expect(aviso).toContainText('Carga interrumpida');
  await expect(aviso).toContainText('uj06-refresco.txt');
  await expect(aviso).toContainText('no llegó al servidor');

  // Descartar el aviso lo saca de la vista y del almacenamiento.
  await page.locator('#descartar-interrumpida').click();
  await expect(page.locator('#upload-interrumpida')).toHaveCount(0);
  const drafts = await page.evaluate(() => localStorage.getItem('uade.upload.drafts'));
  expect(drafts === null || JSON.parse(drafts).length === 0).toBeTruthy();
});
