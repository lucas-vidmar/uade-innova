import { test, expect } from '@playwright/test';

const MOCK_RESULTS = {
  query: 'Architecture',
  subjectId: 'arq-software-2026',
  total: 2,
  results: [
    {
      category: 'material',
      materialType: 'transcript',
      title: 'class-01-transcript.txt',
      snippet: 'Architecture decisions are tied to quality attributes.',
      url: '#/student/class/class-01',
      score: 0.85,
      sourceFilename: 'class-01-transcript.txt',
    },
    {
      category: 'class',
      title: 'Clase 3 — Arquitectura Hexagonal',
      snippet: 'patrones · puertos · adaptadores',
      url: '#/student/class/class-03',
      score: 0.72,
    },
    {
      category: 'task',
      title: 'TP1 - Arquitectura Hexagonal',
      snippet: 'Implementar un hexágono',
      url: '#/student/tasks',
      score: 0.65,
    },
    {
      category: 'chat',
      title: '¿Qué es arquitectura hexagonal?',
      snippet: 'Es un patrón que separa...',
      url: '#/student/dashboard?sessionId=abc-123',
      score: 0.58,
    },
  ],
};

test('student can search and see categorized results', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    localStorage.setItem('onboarding-student-completed', 'true');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.route('**/api/sga/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/classes?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Introducción', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
        { id: 'class-03', subjectId: 'arq-software-2026', title: 'Clase 3 — Arquitectura Hexagonal', date: '2026-03-19', topics: [], materials: [], summaryReady: true },
      ]),
    });
  });

  await page.route('**/api/chat-history?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/sga/tasks?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/deadlines?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/notifications?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/global-search*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_RESULTS) });
  });

  // ── Test 1: Dashboard search bar navigates to results page ──
  await page.goto('/#/student/dashboard');

  const searchInput = page.locator('#global-search-header');
  await expect(searchInput).toBeVisible();
  await searchInput.fill('Architecture');
  await searchInput.press('Enter');

  await expect(page).toHaveURL(/#\/student\/search/);

  // ── Test 2: Results page shows categorized results ──
  await page.waitForSelector('.search-page-results', { timeout: 10000 });
  await expect(page.locator('.sr-summary')).toContainText('4 resultados');

  // Verify all 4 category sections exist
  await expect(page.locator('.sr-section')).toHaveCount(4);

  // Verify material result section
  const materialSection = page.locator('.sr-section').first();
  await expect(materialSection.locator('.sr-section-title')).toContainText('Materiales de clase');

  // Verify class result card
  const classSection = page.locator('.sr-section').nth(1);
  await expect(classSection.locator('.sr-section-title')).toContainText('Clases');
  await expect(classSection.locator('.sr-card-title')).toContainText('Arquitectura Hexagonal');

  // ── Test 3: Empty state ──
  await page.unroute('**/api/global-search*');
  await page.route('**/api/global-search*', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.query === 'zzz') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ query: 'zzz', subjectId: 'arq-software-2026', total: 0, results: [] }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_RESULTS) });
    }
  });

  await page.goto('/#/student/search?q=zzz');
  await page.waitForSelector('.sr-empty', { timeout: 10000 });
  await expect(page.locator('.sr-empty h3')).toContainText('zzz');

  // ── Test 4: Re-search from results page ──
  await page.goto('/#/student/search?q=Architecture');
  await page.waitForSelector('.search-page-results', { timeout: 10000 });
  const pageInput = page.locator('#search-page-input');
  await expect(pageInput).toHaveValue('Architecture');
});

test('search bar on dashboard navigates on Enter', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    localStorage.setItem('onboarding-student-completed', 'true');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/sga/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/classes?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
  await page.route('**/api/chat-history?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/deadlines?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/notifications?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/#/student/dashboard');

  const searchInput = page.locator('#global-search-header');
  await searchInput.fill('Arquitectura');
  await searchInput.press('Enter');
  await expect(page).toHaveURL(/search\?q=Arquitectura/);
});
