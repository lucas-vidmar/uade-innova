import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('director sees Tasa Fallo Seguro card with aggregated metrics', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'director');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
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
  await page.route('**/api/subjects', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software' }]) });
  });
  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/vector-health**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'Pinecone', indexName: 'dashboard-edu-pilot', stats: { totalVectorCount: 4200, indexFullness: 0.12 }, timestamp: '2026-04-10T12:00:00Z' }) });
  });
  await page.route('**/api/director/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dau: 52,
        dauDelta: '+8%',
        ragInteractions: 171,
        adoptionRate: 68,
        subjectAdoption: [{ name: 'Arq. de Software', rate: 82 }],
        earlyAlertSummary: { totalStudentsAtRisk: 3, highRiskCount: 1, mediumRiskCount: 2, lowAttendanceCount: 2, lowGradeCount: 2, attendanceBelow60Count: 1, attendance60To75Count: 2, attendanceAbove75Count: 0 },
      }),
    });
  });
  await page.route('**/api/director/powerbi-metrics?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source: { mode: 'continuous-export-db', storage: 'Azure Table Storage', table: 'SessionMetrics' },
        daily: [],
        updatedAt: '2026-04-10T12:00:00.000Z',
        windowDays: 60,
      }),
    });
  });
  await page.route('**/api/safety-rate**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subjectId: null,
        totalRequests: 171,
        safeCompletions: 169,
        blockedBySafety: 1,
        errorCategorizedFailures: 2,
        safetyRatePercent: 98.8,
        status: 'yellow',
        windowDays: 30,
        trend: { '7d': 99.4, '30d': 98.8 },
        updatedAt: '2026-04-10T12:00:00.000Z',
      }),
    });
  });

  await page.goto('/#/director/dashboard');

  const card = page.locator('#safety-rate-card');
  await expect(card).toContainText('Tasa Fallo Seguro');
  await expect(card).toContainText('98.8%');
  await expect(card).toContainText('En observación');
  await expect(card).toContainText('171');
  await expect(card).toContainText('1');
  await expect(card).toContainText('2');
  await expect(card).toContainText('SessionMetrics');
});

test('teacher sees simplified Tasa Fallo Seguro card scoped to subject', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  await page.route('**/api/analytics?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        topQuestions: [{ text: 'arquitectura', count: 12 }],
        frictionTopics: [{ topic: 'SAGA', queries: 10, unresolved: 4 }],
      }),
    });
  });
  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/class-views?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/enrollments?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route('**/api/safety-rate?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subjectId: 'arq-software-2026',
        totalRequests: 88,
        safeCompletions: 87,
        blockedBySafety: 0,
        errorCategorizedFailures: 1,
        safetyRatePercent: 98.9,
        status: 'yellow',
        windowDays: 30,
        trend: { '7d': 100, '30d': 98.9 },
        updatedAt: '2026-04-10T12:00:00.000Z',
      }),
    });
  });

  await page.goto('/#/teacher/analytics');

  const card = page.locator('#teacher-safety-rate-card');
  await expect(card).toContainText('Tasa Fallo Seguro');
  await expect(card).toContainText('98.9%');
  await expect(card).toContainText('88 consultas');
});
