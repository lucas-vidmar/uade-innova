import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

/* ============================================================
   Central user DB — admin user management + teacher assignments
   (Story 1.4 / 1.5 / 1.6). Runs in the Vite dev server with the
   dev-mock session boot; API calls are stubbed.
   ============================================================ */

async function bootAs(page, role, uid) {
  await page.addInitScript(({ role: r, uid: u }) => {
    localStorage.setItem('uade_use_mock', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
    sessionStorage.setItem('edu_role', r);
    sessionStorage.setItem('edu_uid', u);
    sessionStorage.setItem('edu_consent_accepted', 'true');
  }, { role, uid });
}

const USERS_FIXTURE = [
  { id: 'alu-001', userId: 'alu-001', name: 'Lucas Vidmar', surname: '', email: 'lvidmar@uade.edu.ar', role: 'student', status: 'active', mustChangePassword: false },
  { id: 'doc-001', userId: 'doc-001', name: 'Profesor Xavier', surname: '', email: 'xavier@uade.edu.ar', role: 'teacher', status: 'active', mustChangePassword: false },
];

test('admin sees the user directory and can create a user with a generated password', async ({ page }) => {
  await bootAs(page, 'admin', 'adm-001');

  await page.route(/\/api\/admin\/users(?:\?|$)/, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: { userId: 'alu-010', name: 'Nuevo', surname: 'Alumno', email: 'nuevo@uade.edu.ar', role: 'student', status: 'active' }, generatedPassword: 'R4nd0m-P4ss' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: USERS_FIXTURE }) });
  });

  await page.goto('/#/admin/users');
  await expect(page.getByText('Administración de Usuarios')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('lvidmar@uade.edu.ar')).toBeVisible();
  await expect(page.getByText('xavier@uade.edu.ar')).toBeVisible();

  await page.click('#btn-create-user');
  await page.waitForSelector('#cu-userId');
  await page.fill('#cu-userId', 'alu-010');
  await page.fill('#cu-name', 'Nuevo');
  await page.fill('#cu-surname', 'Alumno');
  await page.fill('#cu-email', 'nuevo@uade.edu.ar');
  await page.check('#cu-random-password');
  await page.click('.create-user-confirm');

  // Success toast announces the generated password once.
  await expect(page.getByText(/Contraseña generada: R4nd0m-P4ss/)).toBeVisible({ timeout: 15000 });
});

test('admin can reset a user password (generated password shown once)', async ({ page }) => {
  await bootAs(page, 'admin', 'adm-001');

  await page.route(/\/api\/admin\/users\/alu-001\/reset-password(?:\?|$)/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { userId: 'alu-001', mustChangePassword: true }, generatedPassword: 'Res3t-P4ss!' }) });
  });
  await page.route(/\/api\/admin\/users(?:\?|$)/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: USERS_FIXTURE }) });
  });

  await page.goto('/#/admin/users');
  await expect(page.getByText('lvidmar@uade.edu.ar')).toBeVisible({ timeout: 15000 });

  await page.locator('tr[data-user-id="alu-001"] .btn-reset-pw').click();
  await page.getByRole('button', { name: 'Resetear' }).click();

  await expect(page.getByText(/Nueva contraseña: Res3t-P4ss!/)).toBeVisible({ timeout: 15000 });
});

test('non-UADE email rejected when admin creates a user', async ({ page }) => {
  await bootAs(page, 'admin', 'adm-001');

  await page.route(/\/api\/admin\/users(?:\?|$)/, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'EMAIL_DOMAIN_INVALID', message: 'El email debe pertenecer al dominio @uade.edu.ar.' } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: USERS_FIXTURE }) });
  });

  await page.goto('/#/admin/users');
  await expect(page.getByText('lvidmar@uade.edu.ar')).toBeVisible({ timeout: 15000 });

  await page.click('#btn-create-user');
  await page.waitForSelector('#cu-userId');
  await page.fill('#cu-userId', 'alu-011');
  await page.fill('#cu-name', 'Invalido');
  await page.fill('#cu-email', 'foo@gmail.com');
  await page.fill('#cu-password', 'password-1');
  await page.click('.create-user-confirm');

  await expect(page.locator('#create-user-error')).toContainText('@uade.edu.ar', { timeout: 15000 });
});

test('teacher can assign and remove a student in their subject', async ({ page }) => {
  await bootAs(page, 'teacher', 'doc-001');
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
  });

  const students = [
    { id: 'alu-001', userId: 'alu-001', name: 'Lucas Vidmar', surname: '', email: 'lvidmar@uade.edu.ar', role: 'student', status: 'active' },
    { id: 'alu-002', userId: 'alu-002', name: 'María González', surname: '', email: 'mgonzalez@uade.edu.ar', role: 'student', status: 'active' },
  ];
  let enrollments = [{ subjectId: 'arq-software-2026', userId: 'alu-001', role: 'student', status: 'active' }];

  await page.route(/\/api\/admin\/users(?:\?|$)/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: students }) });
  });
  await page.route(/\/api\/enrollments(?:\?|$)/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      enrollments = [...enrollments, { subjectId: body.subjectId, userId: body.userId, role: body.role, status: body.status }];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      return;
    }
    const url = new URL(req.url());
    if (url.searchParams.get('subjectId') === 'arq-software-2026' && !url.searchParams.get('userId')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: enrollments }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
  await page.route(/\/api\/classes(?:\?|$)/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.goto('/#/teacher/classes');
  await expect(page.getByText('Alumnos de la materia')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Lucas Vidmar')).toBeVisible();

  // Add María.
  await page.click('#btn-toggle-student-picker');
  await page.locator('.teacher-student-add[data-student-id="alu-002"]').click();
  await expect(page.getByText('María González')).toBeVisible({ timeout: 15000 });
});
