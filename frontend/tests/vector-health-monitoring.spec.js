import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('director can review vector index health in dashboard', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'admin');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/subjects*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software' }]) });
  });

  await page.route('**/api/director/stats*', async (route) => {
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
        costBySubject: [],
        costSource: { method: 'token-based' },
        budget: { percentUsed: 10, monthlyLimit: 100, projectedEndOfMonth: 12, warningLevel: 'none' },
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
        updatedAt: '2026-04-10T16:00:00.000Z',
        windowDays: 14,
        daily: [],
      }),
    });
  });

  await page.route('**/api/vector-health*', async (route) => {
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
        latencyMs: { p50: 95, p95: 280 },
        failureRatio: 0.02,
        metricsWindow: 5,
        metricsSampleCount: 85,
        timestamp: '2026-04-10T16:05:00.000Z',
      }),
    });
  });

  await page.goto('/#/admin/dashboard');

  await expect(page.locator('text=Vector Index Health')).toBeVisible();
  await expect(page.locator('text=pinecone')).toBeVisible();
  await expect(page.locator('text=dashboard-edu-pilot')).toBeVisible();
  await expect(page.locator('text=1.250')).toBeVisible();
  await expect(page.locator('text=8%')).toBeVisible();
  await expect(page.locator('text=95 ms')).toBeVisible();
  await expect(page.locator('text=280 ms')).toBeVisible();
  await expect(page.locator('text=2.0%')).toBeVisible();
});
