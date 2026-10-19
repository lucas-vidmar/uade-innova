import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

// Regresión #436 (UJ-18): el editor de clase mantiene el estado de edición sólo
// en memoria (localState + dirty), así que un refresco (F5) descartaba el trabajo
// sin aviso. Mientras haya cambios sin guardar, el editor debe registrar una
// guarda de salida (beforeunload) que el navegador presente antes de descargar la
// pantalla; sin cambios, no debe molestar.
const CLASS_ID = 'class-01';
const MARCA = 'MARCA-QA-436-SIN-GUARDAR';

async function mockClassEditor(page) {
  await page.route('**/api/get-profile**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ role: 'teacher', name: 'Prof Uno', email: 'prof-001@uade.edu.ar', consentAccepted: true, scope: { subjects: ['arq-software-2026'] } }),
  }));
  await page.route('**/api/subjects**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]),
  }));
  await page.route('**/api/enrollments**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [{ subjectId: 'arq-software-2026', status: 'active', role: 'teacher' }] }),
  }));
  await page.route('**/api/classes?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      id: CLASS_ID, subjectId: 'arq-software-2026', title: 'Clase 1 — Arquitectura', date: '2026-03-05',
      topics: [], materials: [], summaryReady: true,
      sectionsEnabled: { summary: true, map: true, podcast: true },
    }]),
  }));
  await page.route('**/api/class-summary/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ summary: { content: 'Resumen original de la clase.' }, publicationState: 'borrador' }),
  }));
  await page.route('**/api/class-map/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ mapCode: 'graph TD\n  A --> B' }),
  }));
  await page.route('**/api/class-audio-script/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ script: 'Guion original del podcast.' }),
  }));
  await page.route('**/api/class-timeline/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ markers: [], sections: [] }),
  }));
  await page.route('**/api/class-views**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }),
  }));
  await page.route('**/api/notifications**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: '[]',
  }));
}

// Dispara un beforeunload sintético y devuelve si alguna guarda lo canceló.
function beforeUnloadPrevented(page) {
  return page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
}

test('el editor de clase protege los cambios sin guardar ante un refresco (#436)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_uid', 'prof-001');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_logged_in', 'true');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
  });
  await mockClassEditor(page);

  await page.goto(`/#/teacher/class/${CLASS_ID}`);
  await page.waitForSelector('#summary-editor');

  // Sin cambios pendientes no hay nada que proteger: la guarda no interviene.
  expect(await beforeUnloadPrevented(page)).toBe(false);

  // Se edita el resumen: el editor marca «Cambios no guardados».
  await page.evaluate((m) => {
    const ed = document.querySelector('#summary-editor');
    ed.innerHTML += `<p>${m}</p>`;
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  }, MARCA);
  await expect(page.locator('.badge')).toContainText('Cambios no guardados');
  await expect(page.locator('#summary-editor')).toContainText(MARCA);

  // Con cambios sin guardar, la guarda de salida cancela el descargue (F5): el
  // navegador pide confirmación en vez de perder el trabajo en silencio.
  expect(await beforeUnloadPrevented(page)).toBe(true);
});
