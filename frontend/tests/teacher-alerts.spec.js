import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

test('teacher sees engagement and material alerts in analytics view', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
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

test('teacher sees thematic gaps card with severity colors and expandable details', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/analytics?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        topQuestions: [
          { text: 'SAGA', count: 14 },
          { text: 'arquitectura hexagonal', count: 9 },
          { text: 'event sourcing', count: 5 },
        ],
        frictionTopics: [
          { topic: 'SAGA', queries: 10, unresolved: 8 },
          { topic: 'arquitectura hexagonal', queries: 8, unresolved: 2 },
        ],
      }),
    });
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-01',
          subjectId: 'arq-software-2026',
          title: 'Clase 1 — Arquitectura',
          date: '2026-03-05',
          topics: ['Definición de arquitectura', 'Patrones arquitectónicos'],
          materials: [],
          summaryReady: true,
        },
        {
          id: 'class-02',
          subjectId: 'arq-software-2026',
          title: 'Clase 2 — SAGA y CQRS',
          date: '2026-03-12',
          topics: ['SAGA pattern', 'CQRS'],
          materials: [],
          summaryReady: true,
        },
      ]),
    });
  });

  await page.route('**/api/class-views?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { subjectId: 'arq-software-2026', studentId: 'alu-012', classId: 'class-01', viewCount: 2 },
      ]),
    });
  });

  await page.route('**/api/sga/teacher-alerts?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
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
      }),
    });
  });

  await page.route('**/api/enrollments?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.goto('/#/teacher/analytics');

  await expect(page.locator('#teacher-gaps-card')).toBeVisible();
  await expect(page.locator('#teacher-gaps-card')).toContainText('Vacíos Temáticos');
  await expect(page.locator('#teacher-gaps-list .gap-item')).toHaveCount(2);

  const sagaGap = page.locator('#teacher-gaps-list .gap-item[data-topic="SAGA"]');
  await expect(sagaGap).toHaveAttribute('data-severity', 'red');
  await expect(sagaGap).toContainText('80% sin resolver');
  await expect(sagaGap).toContainText('Crítico');

  const hexagonalGap = page.locator('#teacher-gaps-list .gap-item[data-topic="arquitectura hexagonal"]');
  await expect(hexagonalGap).toHaveAttribute('data-severity', 'green');
  await expect(hexagonalGap).toContainText('Leve');

  await sagaGap.locator('.gap-expand-toggle').click();
  await expect(sagaGap.locator('[data-gap-panel]')).toBeVisible();
  await expect(sagaGap.locator('[data-gap-panel]')).toContainText('Consultas de alumnos relacionadas');
  await expect(sagaGap.locator('[data-gap-panel]')).toContainText('SAGA');
});
