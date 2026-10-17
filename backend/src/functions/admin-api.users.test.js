import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * admin-api.test.js — admin user CRUD + reset password (Story 1.4/1.5).
 */

const handlers = {};
mock.module('@azure/functions', {
  namedExports: {
    app: {
      http: (name, options) => {
        handlers[name] = options.handler;
      },
    },
  },
});

mock.module('../middleware/with-auth.js', {
  namedExports: {
    withAuth: (handler) => handler,
  },
});
mock.module('../middleware/with-correlation.js', {
  namedExports: {
    withCorrelation: (handler) => handler,
  },
});

mock.module('../services/auth-utils.js', {
  namedExports: {
    validateFrontDoorId: () => true,
  },
});

const storageMocks = {
  getTableClient: () => ({
    createTable: async () => true,
    listEntities: () => ({ async *[Symbol.asyncIterator]() {} }),
  }),
};
mock.module('../services/storage.js', { namedExports: storageMocks });

const usersStoreMocks = {
  listUsers: mock.fn(async () => []),
  createUser: mock.fn(async () => ({ userId: 'alu-009', name: 'Nuevo', surname: 'User', email: 'nuevo@uade.edu.ar', role: 'student', status: 'active' })),
  updateUser: mock.fn(async () => ({ userId: 'alu-001', name: 'Alumno', surname: 'Uno', email: 'alu001@uade.edu.ar', role: 'teacher', status: 'active' })),
  deleteUser: mock.fn(async () => true),
  setUserPassword: mock.fn(async () => true),
  generateRandomPassword: mock.fn(() => 'R4nd0m-P4ss'),
};
mock.module('../services/users-store.js', { namedExports: usersStoreMocks });

const sessionStoreMocks = {
  deleteSessionsForUser: mock.fn(async () => 0),
};
mock.module('../services/sessions-store.js', { namedExports: sessionStoreMocks });

await import('./admin-api.js');

function makeRequest({ body, params } = {}) {
  return {
    headers: { get: () => null },
    params: params || {},
    json: async () => body,
  };
}

function makeContext() {
  const log = mock.fn();
  log.error = mock.fn();
  return { log, error: log.error, user: { id: 'adm-001', role: 'Admin' } };
}

beforeEach(() => {
  usersStoreMocks.listUsers.mock.resetCalls();
  usersStoreMocks.listUsers.mock.mockImplementation(async () => []);
  usersStoreMocks.createUser.mock.resetCalls();
  usersStoreMocks.deleteUser.mock.resetCalls();
  usersStoreMocks.deleteUser.mock.mockImplementation(async () => true);
  usersStoreMocks.updateUser.mock.resetCalls();
  usersStoreMocks.setUserPassword.mock.resetCalls();
  usersStoreMocks.setUserPassword.mock.mockImplementation(async () => true);
  sessionStoreMocks.deleteSessionsForUser.mock.resetCalls();
  sessionStoreMocks.deleteSessionsForUser.mock.mockImplementation(async () => 0);
});

test('ADMIN_LIST_USERS — returns users with lowercase roles from the Users table', async () => {
  usersStoreMocks.listUsers.mock.mockImplementation(async () => [
    { userId: 'alu-001', name: 'A', surname: 'Uno', email: 'a@uade.edu.ar', role: 'student', status: 'active', mustChangePassword: false },
    { userId: 'doc-001', name: 'D', surname: 'Dos', email: 'd@uade.edu.ar', role: 'teacher', status: 'active', mustChangePassword: false },
  ]);
  const res = await handlers['admin-list-users'](makeRequest(), makeContext());
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.data.length, 2);
  assert.equal(body.data[0].role, 'student');
  assert.equal(body.data[1].role, 'teacher');
});

test('ADMIN_CREATE_USER — creates a user with a provided password', async () => {
  usersStoreMocks.createUser.mock.mockImplementation(async (input) => ({
    userId: input.userId,
    name: input.name,
    surname: input.surname,
    email: input.email,
    role: input.role,
    status: 'active',
  }));
  const res = await handlers['admin-create-user'](makeRequest({ body: {
    userId: 'alu-009',
    name: 'Nuevo',
    surname: 'User',
    email: 'nuevo@uade.edu.ar',
    role: 'student',
    password: 'manual-pass-1',
  } }), makeContext());
  assert.equal(res.status, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.data.email, 'nuevo@uade.edu.ar');
  assert.equal(body.generatedPassword, undefined);
});

test('ADMIN_CREATE_USER_RANDOM — generatePassword=true returns a generated password once', async () => {
  usersStoreMocks.createUser.mock.mockImplementation(async (input) => ({
    userId: input.userId,
    name: input.name,
    surname: input.surname,
    email: input.email,
    role: input.role,
    status: 'active',
  }));
  const res = await handlers['admin-create-user'](makeRequest({ body: {
    userId: 'alu-010',
    name: 'Random',
    surname: 'User',
    email: 'random@uade.edu.ar',
    role: 'student',
    generatePassword: true,
  } }), makeContext());
  assert.equal(res.status, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.generatedPassword, 'R4nd0m-P4ss');
});

test('ADMIN_CREATE_USER_WEAK_PASSWORD — manual password under 8 chars rejected', async () => {
  const res = await handlers['admin-create-user'](makeRequest({ body: {
    userId: 'alu-013',
    name: 'X',
    surname: 'Y',
    email: 'weak@uade.edu.ar',
    role: 'student',
    password: 'short',
  } }), makeContext());
  assert.equal(res.status, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.error.code, 'WEAK_PASSWORD');
  // createUser must NOT have been called for a rejected weak password.
  assert.equal(usersStoreMocks.createUser.mock.callCount(), 0);
});

test('ADMIN_CREATE_USER_NON_UADE — domain violation propagates 400 EMAIL_DOMAIN_INVALID', async () => {
  const domainErr = new Error('El email debe pertenecer al dominio @uade.edu.ar.');
  domainErr.status = 400;
  domainErr.code = 'EMAIL_DOMAIN_INVALID';
  usersStoreMocks.createUser.mock.mockImplementation(async () => { throw domainErr; });
  const res = await handlers['admin-create-user'](makeRequest({ body: {
    userId: 'alu-011',
    name: 'X',
    surname: 'Y',
    email: 'foo@gmail.com',
    role: 'student',
    password: 'secret-1',
  } }), makeContext());
  assert.equal(res.status, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.error.code, 'EMAIL_DOMAIN_INVALID');
});

test('ADMIN_CREATE_USER_DUP — duplicate email propagates 409 EMAIL_EXISTS', async () => {
  const dupErr = new Error('Ya existe un usuario con el email.');
  dupErr.status = 409;
  dupErr.code = 'EMAIL_EXISTS';
  usersStoreMocks.createUser.mock.mockImplementation(async () => { throw dupErr; });
  const res = await handlers['admin-create-user'](makeRequest({ body: {
    userId: 'alu-012',
    name: 'X',
    surname: 'Y',
    email: 'alu001@uade.edu.ar',
    role: 'student',
    password: 'secret-1',
  } }), makeContext());
  assert.equal(res.status, 409);
  const body = JSON.parse(res.body);
  assert.equal(body.error.code, 'EMAIL_EXISTS');
});

test('ADMIN_UPDATE_USER — edits role/status by id', async () => {
  usersStoreMocks.updateUser.mock.mockImplementation(async (id, updates) => ({
    userId: id,
    name: 'Alumno',
    surname: 'Uno',
    email: 'alu001@uade.edu.ar',
    role: updates.role || 'student',
    status: updates.status || 'active',
  }));
  const res = await handlers['admin-update-user'](makeRequest({ body: { role: 'teacher', status: 'disabled' }, params: { id: 'alu-001' } }), makeContext());
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.data.role, 'teacher');
  assert.equal(body.data.status, 'disabled');
  const [id, updates] = usersStoreMocks.updateUser.mock.calls[0].arguments;
  assert.equal(id, 'alu-001');
  assert.equal(updates.role, 'teacher');
});

test('ADMIN_UPDATE_USER — el cambio de permiso viaja con su dueño y su motivo (UJ-53)', async () => {
  usersStoreMocks.updateUser.mock.mockImplementation(async (id, updates) => ({
    userId: id, name: 'Alumno', surname: 'Uno', email: 'alu001@uade.edu.ar',
    role: updates.role || 'student', status: updates.status || 'active',
  }));
  const res = await handlers['admin-update-user'](
    makeRequest({ body: { role: 'teacher', reason: 'pasa a dictar la comisión de los jueves' }, params: { id: 'alu-001' } }),
    makeContext(),
  );
  assert.equal(res.status, 200);
  const [, updates] = usersStoreMocks.updateUser.mock.calls[0].arguments;
  assert.equal(updates.actor, 'adm-001', 'el acto tiene que llevar quién lo hizo');
  assert.equal(updates.reason, 'pasa a dictar la comisión de los jueves', 'el acto tiene que llevar su motivo');
});

test('ADMIN_UPDATE_USER — sin motivo declarado el motivo llega nulo, no inventado (UJ-53)', async () => {
  usersStoreMocks.updateUser.mock.mockImplementation(async (id, updates) => ({ userId: id, role: updates.role || 'student', status: 'active' }));
  await handlers['admin-update-user'](makeRequest({ body: { role: 'teacher' }, params: { id: 'alu-001' } }), makeContext());
  const [, updates] = usersStoreMocks.updateUser.mock.calls[0].arguments;
  assert.equal(updates.reason, null);
  assert.equal(updates.actor, 'adm-001');
});

test('ADMIN_LIST_USERS — el inventario expone el acto de otorgamiento de cada permiso (UJ-53)', async () => {
  usersStoreMocks.listUsers.mock.mockImplementation(async () => [
    {
      userId: 'prof-001', name: 'X', surname: 'Torres', email: 'x@uade.edu.ar', role: 'teacher', status: 'active',
      mustChangePassword: false, createdAt: '2026-06-01T10:00:00.000Z',
      grantedBy: 'adm-001', grantedAt: '2026-06-01T10:00:00.000Z', grantReason: 'alta de la cohorte 2026-1',
      statusChangedBy: 'adm-001', statusChangedAt: '2026-06-01T10:00:00.000Z', statusChangeReason: 'alta de la cohorte 2026-1',
    },
    { userId: 'alu-001', name: 'A', surname: 'Uno', email: 'a@uade.edu.ar', role: 'student', status: 'active', mustChangePassword: false },
  ]);
  const body = JSON.parse((await handlers['admin-list-users'](makeRequest(), makeContext())).body);

  const docente = body.data.find((u) => u.id === 'prof-001');
  assert.equal(docente.grantedBy, 'adm-001');
  assert.equal(docente.grantReason, 'alta de la cohorte 2026-1');
  assert.equal(docente.grantedAt, '2026-06-01T10:00:00.000Z');
  assert.equal(docente.createdAt, '2026-06-01T10:00:00.000Z');

  // Un permiso sin acto sale con los campos nulos: la superficie no puede
  // mostrar la fila como si el permiso se sostuviera solo.
  const alumna = body.data.find((u) => u.id === 'alu-001');
  assert.equal(alumna.grantedBy, null);
  assert.equal(alumna.grantedAt, null);
  assert.equal(alumna.grantReason, null);
});

test('ADMIN_CREATE_USER — el alta asienta quién la hizo y su motivo (UJ-53)', async () => {
  usersStoreMocks.createUser.mock.mockImplementation(async (input) => ({ userId: input.userId, role: input.role, status: 'active' }));
  await handlers['admin-create-user'](makeRequest({ body: {
    userId: 'alu-009', name: 'Nuevo', surname: 'User', email: 'nuevo@uade.edu.ar', role: 'student',
    password: 'manual-pass-1', reason: 'matrícula 2026-2',
  } }), makeContext());
  const [input] = usersStoreMocks.createUser.mock.calls[0].arguments;
  assert.equal(input.grantedBy, 'adm-001');
  assert.equal(input.grantReason, 'matrícula 2026-2');
});

test('ADMIN_DELETE_USER — deletes user and revokes sessions', async () => {
  usersStoreMocks.deleteUser.mock.mockImplementation(async () => true);
  const res = await handlers['admin-delete-user'](makeRequest({ params: { id: 'alu-001' } }), makeContext());
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.data.deleted, true);
  assert.equal(sessionStoreMocks.deleteSessionsForUser.mock.callCount(), 1);
  assert.equal(sessionStoreMocks.deleteSessionsForUser.mock.calls[0].arguments[0], 'alu-001');
});

test('ADMIN_DELETE_USER_NOT_FOUND — unknown user => 404', async () => {
  usersStoreMocks.deleteUser.mock.mockImplementation(async () => false);
  const res = await handlers['admin-delete-user'](makeRequest({ params: { id: 'ghost' } }), makeContext());
  assert.equal(res.status, 404);
});

test('ADMIN_RESET_PASSWORD — resets password, sets mustChangePassword, revokes target sessions', async () => {
  usersStoreMocks.setUserPassword.mock.mockImplementation(async () => true);
  const res = await handlers['admin-reset-password'](makeRequest({ body: {}, params: { id: 'alu-001' } }), makeContext());
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.generatedPassword, 'R4nd0m-P4ss');
  assert.equal(body.data.mustChangePassword, true);
  const [id, password, opts] = usersStoreMocks.setUserPassword.mock.calls[0].arguments;
  assert.equal(id, 'alu-001');
  assert.equal(opts.mustChangePassword, true);
  assert.ok(password);
  // Reset revokes the target user's sessions (admin is a different user here).
  assert.equal(sessionStoreMocks.deleteSessionsForUser.mock.callCount(), 1);
  assert.equal(sessionStoreMocks.deleteSessionsForUser.mock.calls[0].arguments[0], 'alu-001');
});

test('ADMIN_RESET_PASSWORD_SELF — admin resetting their own password keeps their own session', async () => {
  usersStoreMocks.setUserPassword.mock.mockImplementation(async () => true);
  // Admin resets their own id; makeContext().user.id is 'adm-001'.
  const res = await handlers['admin-reset-password'](
    { headers: { get: () => 'Bearer adm-token' }, params: { id: 'adm-001' }, json: async () => ({}) },
    makeContext()
  );
  assert.equal(res.status, 200);
  assert.equal(sessionStoreMocks.deleteSessionsForUser.mock.callCount(), 1);
  // exceptToken is the admin's own bearer token.
  assert.equal(sessionStoreMocks.deleteSessionsForUser.mock.calls[0].arguments[0], 'adm-001');
  assert.equal(sessionStoreMocks.deleteSessionsForUser.mock.calls[0].arguments[1], 'adm-token');
});

test('ADMIN_RESET_PASSWORD_UNKNOWN — unknown user => 404', async () => {
  usersStoreMocks.setUserPassword.mock.mockImplementation(async () => false);
  const res = await handlers['admin-reset-password'](makeRequest({ body: {}, params: { id: 'ghost' } }), makeContext());
  assert.equal(res.status, 404);
});

test('MANAGE_GET_USERS — legacy route derives role from Users table', async () => {
  usersStoreMocks.listUsers.mock.mockImplementation(async () => [
    { userId: 'alu-001', name: 'A', surname: 'Uno', email: 'a@uade.edu.ar', role: 'student', status: 'active', mustChangePassword: false },
  ]);
  const ctx = makeContext();
  ctx.user = { id: 'dir-001', role: 'Director' };
  const res = await handlers['manage-get-users'](makeRequest(), ctx);
  assert.ok(res.jsonBody);
  assert.equal(res.jsonBody[0].role, 'student');
});
