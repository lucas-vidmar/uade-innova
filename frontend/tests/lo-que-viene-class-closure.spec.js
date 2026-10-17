import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

function dateIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Regresión #423 (UJ-37): el cierre de un encuentro debe mostrar "lo que viene"
// — las entregas con fecha comprometida y el próximo encuentro —, y no sólo el
// contenido del encuentro ya pasado. La vista de la clase no componía ninguna
// sección con los deadlines de la unidad ni con el encuentro siguiente.
test('el cierre de la clase muestra "lo que viene" (#423)', async ({ page }) => {
  const proximo = dateIn(6);
  const vencimiento = dateIn(12);

  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_uid', 'alu-003');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_logged_in', 'true');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
  });

  await page.route('**/api/subjects', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
  });
  await page.route('**/api/enrollments**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [{ subjectId: 'arq-software-2026', status: 'active', role: 'student' }] }) });
  });
  await page.route('**/api/classes?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'class-02', subjectId: 'arq-software-2026', title: 'Clase 2 — Estilos', date: dateIn(-5), topics: [], materials: [], publicationState: 'publicado', summaryReady: true },
        { id: 'class-03', subjectId: 'arq-software-2026', title: 'Clase 3 — Hexagonal', date: proximo, topics: [], materials: [], publicationState: 'publicado', summaryReady: true },
      ]),
    });
  });
  await page.route('**/api/class-summary/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: null }) });
  });
  await page.route('**/api/class-map/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mapCode: null }) });
  });
  await page.route('**/api/class-timeline/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ markers: [], sections: [] }) });
  });
  await page.route('**/api/class-audio-script/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ script: null }) });
  });
  await page.route('**/api/class-views', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.route('**/api/deadlines?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'deadline-1', title: 'TP Integrador', subjectId: 'arq-software-2026', classId: 'class-03', dueDate: vencimiento },
        { id: 'deadline-old', title: 'Entrega vieja', subjectId: 'arq-software-2026', classId: 'class-01', dueDate: dateIn(-20) },
      ]),
    });
  });
  await page.route('**/api/chat-history?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/tasks**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/notifications?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/#/student/class/class-02', { waitUntil: 'domcontentloaded' });

  await expect(page.getByText('Lo que viene')).toBeVisible({ timeout: 10000 });
  const section = page.locator('[data-testid="lo-que-viene"]');
  await expect(section).toBeVisible();
  await expect(section).toContainText('Entregas con fecha comprometida');
  await expect(section).toContainText('Próximo encuentro');
  // La entrega con fecha por delante se muestra; la vencida queda fuera.
  await expect(section).toContainText('TP Integrador');
  await expect(section).not.toContainText('Entrega vieja');
  // El próximo encuentro es la clase siguiente a la abierta.
  await expect(section).toContainText('Clase 3 — Hexagonal');
  await expect(section).not.toContainText('Clase 2 — Estilos');
});
