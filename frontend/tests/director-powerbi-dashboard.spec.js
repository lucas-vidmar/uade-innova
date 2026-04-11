import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('director can review DAU, token and cost metrics for Power BI', async ({ page }) => {

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'director');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
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

  await page.goto('/#/director/dashboard');

  await expect(page.locator('#powerbi-card')).toContainText('Power BI — DAU, Tokens y Costo por Interacción');
  await expect(page.locator('#powerbi-metrics-table')).toBeVisible();
  await expect(page.locator('#powerbi-card')).toContainText('SessionMetrics');
  await expect(page.locator('#powerbi-card')).toContainText('$0.15/1M');
  await expect(page.locator('#powerbi-card')).toContainText('$0.60/1M');
  await expect(page.locator('#cost-total-kpi')).toContainText('$0.0527');
  await expect(page.locator('#cost-avg-kpi')).toContainText('$0.000158');
  await expect(page.locator('#powerbi-metrics-table')).toContainText('73.000');
  await expect(page.locator('#powerbi-metrics-table')).toContainText('22.000');
  await expect(page.locator('#powerbi-metrics-table')).toContainText('$0.0244');
  await expect(page.locator('#powerbi-metrics-table')).toContainText('$0.000143');
  await expect(page.locator('#powerbi-metrics-table tbody tr')).toHaveCount(2);
  await expect(page.locator('#director-alerts-aggregate-table')).toBeVisible();
  await expect(page.locator('#director-alerts-aggregate-table')).toContainText('Riesgo alto');
  await expect(page.locator('#director-alerts-aggregate-table')).toContainText('Asistencia < 60%');
  await expect(page.locator('#director-alerts-aggregate-table')).toContainText('Baja asistencia (total)');
  await expect(page.locator('#director-alerts-aggregate-table')).not.toContainText('Tomás García');
  await expect(page.locator('#director-alerts-aggregate-table')).not.toContainText('Lucía Martínez');

});
