import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

// #390 — El lote de material de apoyo tiene que repartirse por encuentro: cada pieza
// apunta a un solo encuentro, el reparto se ve antes de confirmar y ninguna pieza se
// sube asociada a todos los encuentros seleccionados.
test('el lote se reparte por encuentro antes de subir y cada pieza lleva sólo el suyo', async ({ page }) => {
  const posts = [];

  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    localStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
    sessionStorage.setItem('edu_token', 'e2e-token');
  });

  await page.route('**/api/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ role: 'teacher', consentAccepted: true, subjects: [{ id: 'arq-software-2026', name: 'Arquitectura' }] }),
  }));

  await page.route('**/api/classes**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { id: 'class-05', subjectId: 'arq-software-2026', title: 'Clase 5 — API Design & REST', date: '2026-04-10', topics: [], materials: [], summaryReady: false },
      { id: 'class-06', subjectId: 'arq-software-2026', title: 'Clase 6 — Seguridad en Arquitecturas', date: '2026-04-17', topics: [], materials: [], summaryReady: false },
    ]),
  }));

  await page.route('**/api/ingest-material**', async route => {
    posts.push(route.request().postData() || '');
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ materialId: `mat-lote-${posts.length}`, status: 'processing' }),
    });
  });

  await page.goto('/#/teacher/upload');

  // Dos encuentros destino.
  await page.locator('.class-checkbox[value="class-05"]').check();
  await page.locator('.class-checkbox[value="class-06"]').check();
  await page.locator('.tab-btn[data-tab="notes"]').click();

  // Dos piezas del lote, una de cada encuentro.
  await page.locator('#file-input-notes').setInputFiles([
    { name: 'apunte-clase5.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('apunte del encuentro 5') },
    { name: 'apunte-clase6.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('apunte del encuentro 6') },
  ]);

  // Nada se subió todavía: primero hay que repartir.
  const reparto = page.locator('#lote-reparto');
  await expect(reparto).toBeVisible({ timeout: 15000 });
  await expect(reparto.getByText('Ninguna pieza se subió todavía')).toBeVisible();
  expect(posts.length).toBe(0);

  // Confirmar sin repartir no sube nada y dice qué falta.
  await page.locator('#lote-confirmar').click();
  await expect(page.locator('.lote-error').first()).toBeVisible();
  expect(posts.length).toBe(0);

  // Reparto: cada pieza a su encuentro.
  await page.locator('.lote-destino').nth(0).selectOption('class-05');
  await page.locator('.lote-destino').nth(1).selectOption('class-06');
  await expect(page.locator('#lote-confirmar')).toContainText('Confirmar y subir el lote (2)');

  await page.locator('#lote-confirmar').click();
  await expect(page.locator('#lote-reparto')).toHaveCount(0, { timeout: 15000 });

  // Cada POST lleva un único classIds, el de su pieza.
  expect(posts.length).toBe(2);
  const porArchivo = posts.map(body => ({
    filename: /filename="([^"]+)"/.exec(body)?.[1],
    classIds: [...body.matchAll(/name="classIds"\r?\n\r?\n([^\r\n]*)/g)].map(m => m[1]),
  }));
  expect(porArchivo[0]).toEqual({ filename: 'apunte-clase5.docx', classIds: ['class-05'] });
  expect(porArchivo[1]).toEqual({ filename: 'apunte-clase6.docx', classIds: ['class-06'] });
});

// La carga con un solo encuentro no cambia: no hay nada que repartir, no hay paso extra.
test('con un solo encuentro la carga sigue siendo directa', async ({ page }) => {
  const posts = [];

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

  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/get-profile**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ role: 'teacher', consentAccepted: true }),
  }));
  await page.route('**/api/classes**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { id: 'class-05', subjectId: 'arq-software-2026', title: 'Clase 5 — API Design & REST', date: '2026-04-10', topics: [], materials: [], summaryReady: false },
      { id: 'class-06', subjectId: 'arq-software-2026', title: 'Clase 6 — Seguridad en Arquitecturas', date: '2026-04-17', topics: [], materials: [], summaryReady: false },
    ]),
  }));
  await page.route('**/api/ingest-material**', async route => {
    posts.push(route.request().postData() || '');
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ materialId: 'mat-uno', status: 'processing' }) });
  });

  await page.goto('/#/teacher/upload');
  // Un solo encuentro destino: se deja sólo Clase 6.
  await page.locator('.class-checkbox[value="class-05"]').uncheck();
  await page.locator('.class-checkbox[value="class-06"]').check();
  await page.locator('.tab-btn[data-tab="transcript"]').click();

  await page.locator('#file-input-transcript').setInputFiles({
    name: 'clase6.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('transcripcion del encuentro 6'),
  });

  await expect(page.locator('.file-item-name').filter({ hasText: 'clase6.txt' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#lote-reparto')).toHaveCount(0);
  expect(posts.length).toBe(1);
  expect(posts[0]).toContain('name="classIds"');
  expect(posts[0]).toContain('class-06');
});
