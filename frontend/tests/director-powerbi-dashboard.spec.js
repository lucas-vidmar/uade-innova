import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('director can review DAU, token and cost metrics for Power BI', async ({ page }) => {

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

  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/director/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dau: 52,
        dauDelta: '+8%',
        classesProcessed: 14,
        ragInteractions: 171,
        ragDelta: '+5%',
        adoptionRate: 68,
        subjectAdoption: [
          { name: 'Arq. de Software', rate: 82 },
        ],
        earlyAlertSummary: {
          totalStudentsAtRisk: 3,
          highRiskCount: 1,
          mediumRiskCount: 2,
          lowAttendanceCount: 2,
          lowGradeCount: 2,
          attendanceBelow60Count: 1,
          attendance60To75Count: 2,
          attendanceAbove75Count: 0,
        },
      }),
    });
  });

  await page.route('**/api/director/powerbi-metrics?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source: {
          mode: 'continuous-export-db',
          storage: 'Azure Table Storage',
          table: 'SessionMetrics',
        },
        pricing: {
          inputPerMillionTokensUsd: 0.15,
          outputPerMillionTokensUsd: 0.60,
          inputPerTokenUsd: 0.00000015,
          outputPerTokenUsd: 0.0000006,
        },
        summary: {
          totalPromptTokens: 145000,
          totalCompletionTokens: 51000,
          totalTokens: 196000,
          totalInteractions: 334,
          totalCostUsd: 0.05265,
          avgCostPerInteractionUsd: 0.00015763,
        },
        updatedAt: '2026-04-10T12:00:00.000Z',
        windowDays: 14,
        daily: [
          { date: '2026-04-09', dau: 49, promptTokens: 72000, completionTokens: 29000, totalTokens: 101000, totalCost: 0.0282, avgCostPerInteraction: 0.000173, ragInteractions: 163 },
          { date: '2026-04-10', dau: 52, promptTokens: 73000, completionTokens: 22000, totalTokens: 95000, totalCost: 0.02445, avgCostPerInteraction: 0.000143, ragInteractions: 171 },
        ],
      }),
    });
  });

  await page.route('**/api/vector-health**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: 'Pinecone', indexName: 'dashboard-edu-pilot', stats: { totalVectorCount: 4200, indexFullness: 0.12 }, timestamp: '2026-04-10T12:00:00Z' }),
    });
  });

  await page.goto('/#/director/dashboard');

  await expect(page.locator('#cost-per-subject-card')).toContainText('Costo por Materia');
  await expect(page.locator('#cost-per-subject-card')).toContainText('SessionMetrics');
  await expect(page.locator('#cost-per-subject-card')).toContainText('$0.15/1M');
  await expect(page.locator('#cost-per-subject-card')).toContainText('$0.60/1M');
  await expect(page.locator('#cost-per-subject-card')).toContainText('$0.0527');
  await expect(page.locator('#cost-per-subject-card')).toContainText('$0.000158');

  await expect(page.locator('#director-alerts-aggregate-table')).toBeVisible();
  await expect(page.locator('#director-alerts-aggregate-table')).toContainText('Riesgo alto');
  await expect(page.locator('#director-alerts-aggregate-table')).toContainText('Asistencia < 60%');
  await expect(page.locator('#director-alerts-aggregate-table')).toContainText('Baja asistencia (total)');

});
