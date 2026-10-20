import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

/**
 * #467 — Decisión (c): las lecturas de desempeño del sistema académico que hoy
 * no tienen fuente salen de la pantalla. Los endpoints `sga/attendance`,
 * `sga/teacher-alerts` y `sga/early-alerts` contestan valores fijos; una tarjeta
 * que los dibuje presenta un "no hay riesgo" que nadie midió.
 *
 * Estas pruebas son de AUSENCIA, así que no alcanza con que un selector no
 * exista: un render fallido también deja el selector vacío. Cada caso comprueba
 * además que (1) la pantalla sí renderizó sus tarjetas reales y (2) la petición
 * al endpoint sin fuente no se hace, o que el dato inyectado no se dibuja.
 */

const DIRECTOR_STUBS = async (page) => {
  await page.route('**/api/enrollments**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));
  await page.route('**/api/subjects*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software' }]) }));
  await page.route('**/api/notifications?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/class-views?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/vector-health*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'Pinecone', stats: { totalVectorCount: 10 } }) }));
  await page.route('**/api/safety-rate?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'green', safetyRatePercent: 99.2, totalRequests: 10, blockedBySafety: 0, errorCategorizedFailures: 0 }) }));
  await page.route('**/api/director/powerbi-metrics?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ daily: [{ date: '2026-04-10', dau: 10, ragInteractions: 4 }], summary: {}, source: {} }),
    }));
};

test('el tablero de dirección no muestra cortes de asistencia ni promedio sin fuente', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'director');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await DIRECTOR_STUBS(page);

  // El backend todavía puede mandar los cortes heredados: la pantalla NO debe
  // dibujarlos aunque lleguen con números (antes los pintaba tal cual).
  await page.route('**/api/director/stats*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dau: 12,
        classesProcessed: 2,
        ragInteractions: 40,
        adoptionRate: 55,
        earlyAlertSummary: {
          totalStudentsAtRisk: 3,
          highRiskCount: 1,
          mediumRiskCount: 2,
          lowAttendanceCount: 7,
          lowGradeCount: 9,
          attendanceBelow60Count: 11,
          attendance60To75Count: 13,
          attendanceAbove75Count: 17,
        },
      }),
    }));

  await page.goto('/#/director/dashboard');

  // La pantalla renderizó (no es un fallo de carga lo que hace desaparecer las filas).
  await expect(page.locator('#safety-rate-card')).toContainText('Tasa Fallo Seguro');
  const card = page.locator('.card', { hasText: 'Alertas Tempranas (Agregado)' });
  await expect(card).toBeVisible();

  const table = page.locator('#director-alerts-aggregate-table');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(table).toContainText('Riesgo alto');
  await expect(table).toContainText('Riesgo medio');

  // Ni etiquetas de asistencia/promedio ni los valores inyectados (11/13/17/7/9).
  await expect(table).not.toContainText('Asistencia');
  await expect(table).not.toContainText('promedio');
  for (const leaked of ['11', '13', '17']) {
    await expect(table).not.toContainText(leaked);
  }

  // La ausencia se declara explícitamente en vez de dejar un hueco mudo.
  const note = page.locator('#director-alerts-unsourced');
  await expect(note).toBeVisible();
  await expect(note).toContainText('sin fuente');
});

test('la analítica docente no muestra alertas docentes ni pide su endpoint sin fuente', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  let alertRequests = 0;
  await page.route('**/api/sga/teacher-alerts?**', (route) => {
    alertRequests += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/analytics?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        topQuestions: [
          { text: 'arquitectura', count: 12 },
          { text: 'hexagonal', count: 9 },
        ],
        frictionTopics: [{ topic: 'SAGA', queries: 10, unresolved: 4 }],
      }),
    }));
  await page.route('**/api/classes?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/class-views?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/enrollments?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));
  await page.route('**/api/safety-rate?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subjectId: 'arq-software-2026', totalRequests: 88, blockedBySafety: 0, errorCategorizedFailures: 1, safetyRatePercent: 98.9, status: 'yellow' }),
    }));

  await page.goto('/#/teacher/analytics');

  // La analítica cargó de verdad: sus tarjetas con fuente siguen ahí.
  await expect(page.locator('#teacher-safety-rate-card')).toContainText('Tasa Fallo Seguro');
  await expect(page.locator('.card', { hasText: 'Consultas más frecuentes' })).toBeVisible();
  await expect(page.locator('#teacher-gaps-card')).toBeVisible();

  // Y no hay lectura de alertas docentes: ni tarjeta, ni tabla, ni petición.
  await expect(page.locator('#teacher-alerts-card')).toHaveCount(0);
  await expect(page.locator('#teacher-alerts-table')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Alertas docentes');
  await expect(page.locator('body')).not.toContainText('No hay alertas críticas para esta materia');
  expect(alertRequests).toBe(0);
});
