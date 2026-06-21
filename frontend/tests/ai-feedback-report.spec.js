import { test, expect } from '@playwright/test';

test.use({
  launchOptions: {
    channel: 'chrome',
  },
});

test('student can report issue and teacher sees alert', async ({ page }) => {
  const teacherAlerts = [];

  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
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

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-03',
          subjectId: 'arq-software-2026',
          title: 'Clase 3 — Arquitectura Hexagonal y DDD',
          date: '2026-03-19',
          topics: ['Puertos y adaptadores'],
          materials: [],
          summaryReady: true,
        },
      ]),
    });
  });

  await page.route('**/api/sga/tasks?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/deadlines?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'ai-issue-001',
          question: '¿Qué es arquitectura hexagonal?',
          answer: 'La arquitectura hexagonal separa el dominio de la infraestructura.',
          sources: [],
        },
      ]),
    });
  });

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/chat-report-issue', async (route) => {
    const payload = route.request().postDataJSON() || {};
    teacherAlerts.unshift({
      id: `ai-issue-${payload.messageId}`,
      type: 'ai-feedback-issue',
      status: 'pending',
      subjectId: payload.subjectId,
      messageId: payload.messageId,
      question: '¿Qué es arquitectura hexagonal?',
      issueDetail: payload.issueDetail || 'Sin detalle',
      createdAt: '2026-04-10T12:00:00.000Z',
    });

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, alertId: `ai-issue-${payload.messageId}` }),
    });
  });

  await page.route('**/api/teacher/ai-feedback-alerts?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(teacherAlerts),
    });
  });

  await page.route('**/api/corrections-pending?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: teacherAlerts }),
    });
  });

  await page.goto('/#/student/dashboard');

  const reportBtn = page.locator('.report-issue-btn').first();
  await expect(reportBtn).toBeVisible();
  await reportBtn.click();

  await page.fill('#report-detail-input', 'La respuesta necesita más contexto de la clase.');
  await page.click('.dialog-confirm');

  await expect(page.locator('.report-issue-btn').first()).toHaveText('✅ Reportado');

  await page.evaluate(() => {
    sessionStorage.setItem('edu_role', 'teacher');
  });
  await page.goto('/#/teacher/dashboard');

  await expect(page.getByText('Alertas de Calidad IA')).toBeVisible();
  await expect(page.getByText('La respuesta necesita más contexto de la clase.')).toBeVisible();
});
