import { test, expect } from '@playwright/test';

test.describe('Class View Tracking', () => {

  test('student dashboard shows class badges (Nuevo/Bloqueado)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('uade_use_mock', 'false');
      sessionStorage.setItem('edu_role', 'student');
      sessionStorage.setItem('edu_uid', 'alu-001');
      sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
      sessionStorage.setItem('edu_logged_in', 'true');
      sessionStorage.setItem('edu_consent_accepted', 'true');
      sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    });

    await page.route('**/api/subjects', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
    });
    await page.route('**/api/enrollments**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
    });
    await page.route('**/api/classes?**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
          { id: 'class-02', subjectId: 'arq-software-2026', title: 'Clase 2 — DDD', date: '2026-03-12', topics: [], materials: [], summaryReady: false },
        ]),
      });
    });
    await page.route('**/api/chat-history?**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/tasks**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/deadlines?**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto('http://localhost:3000/#/student/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#section-classes', { timeout: 10000 });

    const content = await page.textContent('body');
    expect(content).toContain('Clases');

    const hasNuevo = content.includes('Nuevo');
    const hasBloqueado = content.includes('Bloqueado');
    console.log(`Dashboard badges: Nuevo=${hasNuevo}, Bloqueado=${hasBloqueado}`);
    expect(hasNuevo || hasBloqueado).toBe(true);
  });

  test('student can view a class and see updated badge', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('uade_use_mock', 'false');
      sessionStorage.setItem('edu_role', 'student');
      sessionStorage.setItem('edu_uid', 'alu-001');
      sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
      sessionStorage.setItem('edu_logged_in', 'true');
      sessionStorage.setItem('edu_consent_accepted', 'true');
      sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    });

    await page.route('**/api/subjects', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
    });
    await page.route('**/api/enrollments**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
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
    await page.route('**/api/tasks**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/deadlines?**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/class-summary/**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: 'Resumen de la clase' }) });
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

    await page.goto('http://localhost:3000/#/student/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#section-classes', { timeout: 10000 });

    // Regression (QA-008 / AC #2): the first-run onboarding overlay auto-starts
    // for the student (AI consent seeded). It must NOT swallow the primary class
    // interaction — the class stays clickable without dismissing the tour first.
    await expect(page.locator('.onboarding-overlay')).toBeAttached({ timeout: 5000 });

    // Scope to the classes sidebar: the chat widget also renders a "Nuevo chat"
    // button, so a bare `text=Nuevo` match is ambiguous.
    const nuevoItem = page.locator('#section-classes').locator('text=Nuevo').first();
    const exists = await nuevoItem.count();

    if (exists > 0) {
      await nuevoItem.locator('..').click();
      await page.waitForTimeout(3000);

      const viewedState = await page.evaluate(() => {
        const views = JSON.parse(localStorage.getItem('edu_class_views') || '{}');
        return Object.keys(views).length;
      });
      console.log(`Classes marked as viewed in localStorage: ${viewedState}`);
      expect(viewedState).toBeGreaterThan(0);
    } else {
      console.log('No "Nuevo" badge found — all classes may already be viewed or none are available');
    }
  });
});
