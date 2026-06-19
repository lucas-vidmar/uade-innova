import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('director can review vector index health in dashboard', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'director');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
  });

  await page.route('**/api/director/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dau: 45,
        dauDelta: '+3%',
        classesProcessed: 12,
        ragInteractions: 420,
        ragDelta: '+9%',
        adoptionRate: 61,
        subjectAdoption: [{ name: 'Arq. de Software', rate: 79 }],
        earlyAlertSummary: {
          totalStudentsAtRisk: 2,
          highRiskCount: 1,
          mediumRiskCount: 1,
          lowAttendanceCount: 1,
          lowGradeCount: 1,
          attendanceBelow60Count: 1,
          attendance60To75Count: 1,
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
        updatedAt: '2026-04-10T16:00:00.000Z',
        windowDays: 14,
        daily: [],
      }),
    });
  });

  await page.route('**/api/vector-health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'pinecone',
        indexName: 'dashboard-edu-pilot',
        stats: {
          totalVectorCount: 1250,
          indexFullness: 0.08,
          namespaces: {},
        },
        timestamp: '2026-04-10T16:05:00.000Z',
      }),
    });
  });

  await page.goto('/#/director/dashboard');

  await expect(page.locator('#vector-health-card')).toContainText('Vector Index Health');
  await expect(page.locator('#vector-health-table')).toBeVisible();
  await expect(page.locator('#vector-health-table')).toContainText('pinecone');
  await expect(page.locator('#vector-health-table')).toContainText('dashboard-edu-pilot');
  await expect(page.locator('#vector-health-table')).toContainText('1.250');
  await expect(page.locator('#vector-health-table')).toContainText('8%');
});
