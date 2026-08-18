import { test, expect } from '@playwright/test';

const CLASSES = [
  { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Introducción', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
  { id: 'class-02', subjectId: 'arq-software-2026', title: 'Clase 2 — SAGA y CQRS', date: '2026-03-12', topics: [], materials: [], summaryReady: true },
];

test('teacher can link a task to multiple classes via "Vincular a clases"', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This usability check must run on Chrome/Chromium.');

  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_uid', 'doc-001');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/get-profile?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ consentAccepted: true, role: 'teacher' }) });
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLASSES) });
  });

  let savedPayload = null;
  await page.route('**/api/deadlines?**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'deadline-1', title: 'TP Final', description: 'Entrega final', subjectId: 'arq-software-2026', classId: 'class-01', classIds: ['class-01'], dueDate: '2026-07-01', weight: 25, notifyOnDayBefore: true, notifyOnDayOf: true, status: 'pending' },
        ]),
      });
      return;
    }
    savedPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...savedPayload, id: 'deadline-new' }) });
  });

  await page.route('**/api/corrections-pending?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/class-views?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/enrollments?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/subject-weights/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { notes: 1.35, bibliography: 1.1, transcript: 1.0, presentation: 0.95 }, defaults: true }),
    });
  });

  await page.goto('/#/teacher/dashboard');
  await expect(page.locator('#create-task-btn')).toBeVisible();
  await page.locator('#create-task-btn').click();

  const modal = page.locator('.modal-overlay');
  await expect(modal.locator('#task-link-classes-btn')).toBeVisible();
  await expect(modal.locator('#task-classes-container')).toBeHidden();

  await modal.locator('#task-link-classes-btn').click();
  await expect(modal.locator('#task-classes-container')).toBeVisible();
  const checkboxes = modal.locator('.task-class-checkbox');
  await expect(checkboxes).toHaveCount(2);

  await modal.locator('.task-class-checkbox[value="class-01"]').check();
  await modal.locator('.task-class-checkbox[value="class-02"]').check();

  await modal.locator('#task-title').fill('Trabajo Práctico N°3');
  await modal.locator('#task-weight').fill('15');
  await modal.locator('#task-duedate').fill('2026-07-15');
  await modal.locator('#task-save-btn').click();

  await expect(modal).toBeHidden();
  expect(savedPayload).not.toBeNull();
  expect(savedPayload.classIds).toEqual(['class-01', 'class-02']);
  expect(savedPayload.title).toBe('Trabajo Práctico N°3');
  expect(savedPayload.subjectId).toBe('arq-software-2026');

  await expect(page.locator('body')).toContainText('Tarea creada');
});

test('teacher edit modal reveals pre-selected linked classes via "Vincular a clases"', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This usability check must run on Chrome/Chromium.');

  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_role', 'teacher');
    sessionStorage.setItem('edu_uid', 'doc-001');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLASSES) });
  });

  await page.route('**/api/corrections-pending?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/class-views?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/enrollments?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/subject-weights/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { notes: 1.35, bibliography: 1.1, transcript: 1.0, presentation: 0.95 }, defaults: true }),
    });
  });

  let savedPayload = null;
  await page.route('**/api/deadlines?**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'deadline-1', title: 'TP Final', description: 'Entrega final', subjectId: 'arq-software-2026', classId: 'class-01', classIds: ['class-01'], dueDate: '2026-07-01', weight: 25, notifyOnDayBefore: true, notifyOnDayOf: true, status: 'pending' },
        ]),
      });
      return;
    }
    savedPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...savedPayload, id: savedPayload?.id || 'deadline-new' }) });
  });

  await page.goto('/#/teacher/dashboard');
  await expect(page.locator('.btn-edit-deadline').first()).toBeVisible();
  await page.locator('.btn-edit-deadline').first().click();

  const modal = page.locator('.modal-overlay');
  await expect(modal.locator('#edit-link-classes-btn')).toContainText('Vincular a clases (1 vinculada)');
  await expect(modal.locator('#edit-deadline-classes')).toBeHidden();

  await modal.locator('#edit-link-classes-btn').click();
  await expect(modal.locator('#edit-deadline-classes')).toBeVisible();
  const checked = modal.locator('.edit-deadline-class-checkbox:checked');
  await expect(checked).toHaveCount(1);
  await expect(checked.first()).toHaveValue('class-01');

  await modal.locator('.edit-deadline-class-checkbox[value="class-02"]').check();
  await modal.locator('#edit-deadline-save').click();
  await expect(modal).toBeHidden();
  expect(savedPayload).not.toBeNull();
  expect(savedPayload.classIds).toEqual(['class-01', 'class-02']);
  await expect(page.locator('body')).toContainText('Deadline actualizado');
});

test('student task detail shows "Materiales relacionados" with links to linked classes', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This usability check must run on Chrome/Chromium.');

  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_uid', 'alu-001');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/get-profile?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ consentAccepted: true, role: 'student' }) });
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLASSES) });
  });

  await page.route('**/api/chat-history?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/sga/tasks?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'task-1', studentId: 'alu-001', title: 'TP1: Diagrama de Arquitectura C4', dueDate: '2026-04-20', weight: 25, status: 'pending', classIds: ['class-01', 'class-02'], grade: null, subjectId: 'arq-software-2026' },
        { id: 'task-2', studentId: 'alu-001', title: 'Quiz Online — Estilos Arquitectónicos', dueDate: '2026-04-10', weight: 10, status: 'completed', classIds: ['class-01'], grade: 8.5, subjectId: 'arq-software-2026' },
      ]),
    });
  });

  await page.route('**/api/deadlines?subjectId=**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'deadline-1', title: 'Entrega Final', description: 'Proyecto integrador', subjectId: 'arq-software-2026', classId: 'class-02', classIds: ['class-02'], dueDate: '2026-07-01', weight: 30, notifyOnDayBefore: true, notifyOnDayOf: true, status: 'pending' },
      ]),
    });
  });

  await page.goto('/#/student/tasks');

  await expect(page.locator('body')).toContainText('TP1: Diagrama de Arquitectura C4');
  await expect(page.locator('body')).toContainText('Entrega Final');

  const detailButtons = page.locator('.task-detail-btn');
  await expect(detailButtons).toHaveCount(3);

  const tp1Row = page.locator('tr', { hasText: 'TP1: Diagrama de Arquitectura C4' });
  await tp1Row.locator('.task-detail-btn').click();

  const modal = page.locator('.modal-overlay');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Materiales relacionados');
  const classLinks = modal.locator('a[href^="#/student/class/"]');
  await expect(classLinks).toHaveCount(2);
  await expect(classLinks.nth(0)).toContainText('Clase 1 — Introducción');
  await expect(classLinks.nth(1)).toContainText('Clase 2 — SAGA y CQRS');

  await modal.locator('.dialog-close').first().click();
  await expect(modal).toBeHidden();

  const quizRow = page.locator('tr', { hasText: 'Quiz Online — Estilos Arquitectónicos' });
  await quizRow.locator('.task-detail-btn').click();
  const completedModal = page.locator('.modal-overlay');
  await expect(completedModal).toContainText('Quiz Online — Estilos Arquitectónicos');
  await expect(completedModal).toContainText('Materiales relacionados');
  await expect(completedModal.locator('a[href^="#/student/class/"]')).toHaveCount(1);
});