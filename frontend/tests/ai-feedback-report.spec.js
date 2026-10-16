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

  await page.route('**/api/subjects*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
  });

  await page.route('**/api/get-profile*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ consentAccepted: true }) });
  });

  await page.route('**/api/reminder-preferences*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, cadence: 'both' }) });
  });

  await page.route('**/api/consent*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true }) });
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
          sources: [{ classId: 'class-03', sourceFilename: 'clase3.pdf', text: '…' }],
        },
      ]),
    });
  });

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/chat-report-issue*', async (route) => {
    const payload = route.request().postDataJSON() || {};
    teacherAlerts.unshift({
      id: `ai-issue-${payload.messageId}`,
      type: 'ai-feedback-issue',
      status: 'pending',
      subjectId: payload.subjectId,
      messageId: payload.messageId,
      question: '¿Qué es arquitectura hexagonal?',
      issueDetail: payload.issueDetail || 'Sin detalle',
      // #429: el reporte debe viajar con su clase para poder ubicarlo
      // aunque el asistente no haya dejado log de chat.
      classId: payload.classId || '',
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

  await page.goto('/#/student/dashboard?sessionId=ai-issue-001');

  const reportBtn = page.locator('.report-issue-btn').first();
  await expect(reportBtn).toBeVisible();
  await reportBtn.click();

  await page.fill('#report-detail-input', 'La respuesta necesita más contexto de la clase.');
  await page.click('.dialog-confirm');

  await expect(page.locator('.report-issue-btn').first()).toHaveText('✅ Reportado');

  // #429: el reporte viaja con la clase activa, no queda "unknown".
  expect(teacherAlerts.length).toBeGreaterThan(0);
  expect(teacherAlerts[0].classId).toBe('class-03');

  await page.evaluate(() => {
    sessionStorage.setItem('edu_role', 'teacher');
    localStorage.setItem('uade.dynamic.enrollments', JSON.stringify({
      'doc-001': [{ subjectId: 'arq-software-2026', role: 'teacher', status: 'active' }],
    }));
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    localStorage.setItem('uade.dynamic.enrollments', JSON.stringify({
      'doc-001': [{ subjectId: 'arq-software-2026', role: 'teacher', status: 'active' }],
    }));
  });
  await page.goto('/#/teacher/dashboard');
  await page.reload();
  await page.goto('/#/teacher/dashboard');

  await expect(page.getByText('Alertas de Calidad IA')).toBeVisible();
  await expect(page.getByText('La respuesta necesita más contexto de la clase.')).toBeVisible();
});

test('student can report a missing keyword and teacher sees the notification', async ({ page }) => {
  const keywordAlerts = [];

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

  await page.route('**/api/subjects*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
  });

  await page.route('**/api/get-profile*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ consentAccepted: true }) });
  });

  await page.route('**/api/reminder-preferences*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, cadence: 'both' }) });
  });

  await page.route('**/api/consent*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true }) });
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

  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'kw-msg-001',
          question: '¿Qué es el patrón Observer?',
          answer: 'No encontré información suficiente sobre ese patrón en los materiales.',
          sources: [],
        },
      ]),
    });
  });

  await page.route('**/api/notifications?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/chat-report-issue*', async (route) => {
    const payload = route.request().postDataJSON() || {};
    keywordAlerts.unshift({
      id: `ai-issue-${payload.messageId}`,
      type: payload.type || 'ai-feedback-issue',
      status: 'pending',
      subjectId: payload.subjectId,
      messageId: payload.messageId,
      question: payload.question || '',
      issueDetail: payload.issueDetail || '',
      keyword: payload.type === 'missing-keyword' ? payload.issueDetail : undefined,
      message: payload.type === 'missing-keyword'
        ? `Un alumno reportó que el concepto '${payload.issueDetail}' no aparece en los materiales de Clase 3 — Arquitectura Hexagonal y DDD`
        : '',
      classId: payload.classId || '',
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
      body: JSON.stringify(keywordAlerts),
    });
  });

  await page.route('**/api/corrections-pending?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: keywordAlerts }),
    });
  });

  await page.goto('/#/student/dashboard?sessionId=kw-msg-001');

  const keywordBtn = page.locator('.report-missing-keyword-btn').first();
  await expect(keywordBtn).toBeVisible();
  await keywordBtn.click();

  await expect(page.getByText('¿Qué concepto no encontraste?')).toBeVisible();
  await expect(page.getByText('¿En qué clase esperabas encontrarlo? (opcional)')).toBeVisible();
  await expect(page.locator('#missing-keyword-submit-btn')).toBeVisible();

  const submitBtn = page.locator('#missing-keyword-submit-btn');
  await expect(submitBtn).toBeDisabled();
  await page.fill('#missing-keyword-input', 'Patrón Observer');
  await expect(submitBtn).toBeEnabled();
  await page.selectOption('#missing-keyword-class', 'class-03');
  await submitBtn.click();

  await expect(page.locator('.report-missing-keyword-btn').first()).toHaveText('✅ Concepto reportado');

  assertKeywordPayload(page, keywordAlerts);

  await page.evaluate(() => {
    sessionStorage.setItem('edu_role', 'teacher');
    localStorage.setItem('uade.dynamic.enrollments', JSON.stringify({
      'doc-001': [{ subjectId: 'arq-software-2026', role: 'teacher', status: 'active' }],
    }));
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    localStorage.setItem('uade.dynamic.enrollments', JSON.stringify({
      'doc-001': [{ subjectId: 'arq-software-2026', role: 'teacher', status: 'active' }],
    }));
  });
  await page.goto('/#/teacher/dashboard');
  await page.reload();
  await page.goto('/#/teacher/dashboard');

  await expect(page.getByText('Alertas de Calidad IA')).toBeVisible();
  await expect(page.getByText("Un alumno reportó que el concepto 'Patrón Observer' no aparece en los materiales de Clase 3 — Arquitectura Hexagonal y DDD").first()).toBeVisible();
});

function assertKeywordPayload(page, alerts) {
  expect(alerts.length).toBeGreaterThan(0);
  const alert = alerts[0];
  expect(alert.type).toBe('missing-keyword');
  expect(alert.keyword).toBe('Patrón Observer');
  expect(alert.classId).toBe('class-03');
  void page;
}
