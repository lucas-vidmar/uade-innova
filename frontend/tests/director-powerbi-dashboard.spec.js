import { test, expect } from '@playwright/test';

test('director can review DAU and token metrics for Power BI', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This usability check must run on Chrome/Chromium.');

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
        updatedAt: '2026-04-10T12:00:00.000Z',
        windowDays: 14,
        daily: [
          { date: '2026-04-09', dau: 49, totalTokens: 73300, ragInteractions: 163 },
          { date: '2026-04-10', dau: 52, totalTokens: 78100, ragInteractions: 171 },
        ],
      }),
    });
  });

  await page.goto('/#/director/dashboard');

  await expect(page.locator('#powerbi-card')).toContainText('Power BI — DAU y Consumo de Tokens');
  await expect(page.locator('#powerbi-metrics-table')).toBeVisible();
  await expect(page.locator('#powerbi-card')).toContainText('SessionMetrics');
  await expect(page.locator('#powerbi-metrics-table')).toContainText('78.100');
  await expect(page.locator('#powerbi-metrics-table tbody tr')).toHaveCount(2);
  await expect(page.locator('#director-alerts-aggregate-table')).toBeVisible();
  await expect(page.locator('#director-alerts-aggregate-table')).toContainText('Riesgo alto');
  await expect(page.locator('#director-alerts-aggregate-table')).toContainText('Asistencia < 60%');
  await expect(page.locator('#director-alerts-aggregate-table')).toContainText('Baja asistencia (total)');
  await expect(page.locator('#director-alerts-aggregate-table')).not.toContainText('Tomás García');
  await expect(page.locator('#director-alerts-aggregate-table')).not.toContainText('Lucía Martínez');

});
