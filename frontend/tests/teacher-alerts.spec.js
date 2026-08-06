import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('teacher sees engagement and material alerts in analytics view', async ({ page }) => {
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
        topQuestions: [
          { text: 'arquitectura', count: 12 },
          { text: 'hexagonal', count: 9 },
        ],
        frictionTopics: [
          { topic: 'SAGA', queries: 10, unresolved: 4 },
        ],
      }),
    });
  });

  await page.route('**/api/sga/teacher-alerts?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'teacher-alert-engagement-alu-012',
          type: 'low_engagement',
          severity: 'high',
          subjectId: 'arq-software-2026',
          classId: 'class-03',
          studentId: 'alu-012',
          studentName: 'Tomás García',
          title: 'Baja participación sostenida',
          description: 'Asistencia menor al 50% y baja interacción.',
          attendance: '45%',
          avgGrade: 4.2,
          createdAt: '2026-04-10T12:00:00Z',
          recommendedAction: 'Contactar al alumno y reforzar contenidos.',
        },
        {
          id: 'teacher-alert-material-class-03',
          type: 'material_report',
          severity: 'medium',
          subjectId: 'arq-software-2026',
          classId: 'class-03',
          materialId: 'm-06',
          materialType: 'transcript',
          title: 'Reporte de material: calidad de transcripción',
          description: '3 estudiantes reportaron problemas de claridad.',
          reportCount: 3,
          createdAt: '2026-04-09T12:00:00Z',
          recommendedAction: 'Reprocesar transcripción y validar.',
        },
      ]),
    });
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
        trend: { '7d': 100, '30d': 98.9 },
      }),
    });
  });

  await page.goto('/#/teacher/analytics');

  await expect(page.locator('#teacher-alerts-card')).toContainText('Alertas docentes');
  await expect(page.locator('#teacher-alerts-table')).toBeVisible();
  await expect(page.locator('#teacher-alerts-table')).toContainText('Bajo engagement');
  await expect(page.locator('#teacher-alerts-table')).toContainText('Material reportado');
  await expect(page.locator('#teacher-alerts-table')).toContainText('45% asistencia');
  await expect(page.locator('#teacher-alerts-table')).toContainText('3 reportes');
  await expect(page.locator('#teacher-alerts-table tbody tr')).toHaveCount(2);
});
