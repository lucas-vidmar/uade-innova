import { test, expect } from '@playwright/test';

test('student can run global search for Architecture across classes', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
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

  await page.route('**/api/global-search', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: 'Architecture',
        subjectId: 'arq-software-2026',
        total: 2,
        results: [
          {
            materialId: 'm-01',
            classIds: ['class-01'],
            materialType: 'transcript',
            materialPriority: 'primary',
            sourceFilename: 'clase1_transcripcion.txt',
            chunkIndex: 0,
            snippet: 'Architecture decisions define constraints and quality attributes.',
            score: 0.92,
          },
          {
            materialId: 'm-08',
            classIds: ['class-03'],
            materialType: 'bibliography',
            materialPriority: 'secondary',
            sourceFilename: 'clean-architecture.pdf',
            chunkIndex: 2,
            snippet: 'Architecture should preserve business rules from technical details.',
            score: 0.88,
          },
        ],
      }),
    });
  });

  await page.goto('/#/student/dashboard');

  await page.locator('#global-search-input').fill('Architecture');
  await page.locator('#global-search-button').click();

  await expect(page.locator('.global-search-results-header')).toContainText('2');
  await expect(page.locator('.global-search-result-item')).toHaveCount(2);
  await expect(page.locator('.global-search-result-item').first()).toContainText('clase1_transcripcion.txt');
  await expect(page.locator('.global-search-result-item').nth(1)).toContainText('clean-architecture.pdf');
});
