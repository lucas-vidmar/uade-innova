import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * auth-api.test.js — login/logout/me/change-password endpoints (Story 1.1a/1.5).
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

const userStoreMocks = {
  getUserByEmail: mock.fn(async () => null),
  getUserById: mock.fn(async () => null),
  verifyPassword: mock.fn(() => false),
  setUserPassword: mock.fn(async () => true),
  normalizeEmail: (email) => String(email || '').trim().toLowerCase(),
  INTERNAL_ROLE_BY_ROLE: {
    student: 'Alumno',
    teacher: 'Docente',
    director: 'Director',
    admin: 'Admin',
  },
  FRONTEND_ROLE_BY_INTERNAL: {
    Alumno: 'student',
    Docente: 'teacher',
    Director: 'director',
    Admin: 'admin',
  },
};
mock.module('../services/users-store.js', { namedExports: userStoreMocks });

const sessionStoreMocks = {
  createSession: mock.fn(async (userId) => ({ token: 'tok-123', userId, expiresAt: '2026-12-31T00:00:00Z' })),
  deleteSession: mock.fn(async () => true),
  deleteSessionsForUser: mock.fn(async () => 0),
};
mock.module('../services/sessions-store.js', { namedExports: sessionStoreMocks });

const stateStoreMocks = {
  getEnrollmentsByUser: mock.fn(async () => [
    { subjectId: 'arq-software-2026', role: 'student', status: 'active' },
  ]),
};
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });

await import('./auth-api.js');

function makeRequest(body, { token, ip } = {}) {
  const headers = new Map();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (ip) headers.set('x-forwarded-for', ip);
  return {
    headers: { get: (name) => headers.get(name.toLowerCase()) || null },
    json: async () => body,
  };
}

function makeContext() {
  const log = mock.fn();
  log.error = mock.fn();
  log.warn = mock.fn();
  return { log, error: log.error };
}

function activeUser(overrides = {}) {
  return {
    userId: 'alu-001',
    name: 'Alumno',
    surname: 'Uno',
    email: 'alu001@uade.edu.ar',
    role: 'student',
    status: 'active',
    passwordHash: 'salt:hash',
    mustChangePassword: false,
    ...overrides,
  };
}

beforeEach(() => {
  userStoreMocks.getUserByEmail.mock.resetCalls();
  userStoreMocks.getUserById.mock.resetCalls();
  userStoreMocks.verifyPassword.mock.resetCalls();
  userStoreMocks.verifyPassword.mock.mockImplementation(() => true);
  userStoreMocks.setUserPassword.mock.resetCalls();
  userStoreMocks.setUserPassword.mock.mockImplementation(async () => true);
  sessionStoreMocks.createSession.mock.resetCalls();
  sessionStoreMocks.deleteSession.mock.resetCalls();
  sessionStoreMocks.deleteSessionsForUser.mock.resetCalls();
  sessionStoreMocks.deleteSessionsForUser.mock.mockImplementation(async () => 0);
});

test('HAPPY_LOGIN — valid credentials => 200 + opaque token + lowercase role/scope', async () => {
  userStoreMocks.getUserByEmail.mock.mockImplementation(async () => activeUser());
  const ctx = makeContext();
  const res = await handlers['auth-login'](makeRequest({ email: 'alu001@uade.edu.ar', password: 'secret-1' }, { ip: '1.2.3.4' }), ctx);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.success, true);
  assert.equal(body.token, 'tok-123');
  assert.equal(body.user.role, 'student');
  assert.deepEqual(body.user.scope.subjects, ['arq-software-2026']);
  assert.equal(sessionStoreMocks.createSession.mock.callCount(), 1);
});

test('BAD_PASSWORD — correct email + wrong password => 401 INVALID_CREDENTIALS (generic)', async () => {
  userStoreMocks.getUserByEmail.mock.mockImplementation(async () => activeUser());
  userStoreMocks.verifyPassword.mock.mockImplementation(() => false);
  const ctx = makeContext();
  const res = await handlers['auth-login'](makeRequest({ email: 'alu001@uade.edu.ar', password: 'wrong' }, { ip: '1.2.3.5' }), ctx);
  assert.equal(res.status, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'INVALID_CREDENTIALS');
  assert.equal(sessionStoreMocks.createSession.mock.callCount(), 0);
});

test('UNKNOWN_EMAIL — unknown email => same 401 INVALID_CREDENTIALS (no user enumeration)', async () => {
  userStoreMocks.getUserByEmail.mock.mockImplementation(async () => null);
  const ctx = makeContext();
  const res = await handlers['auth-login'](makeRequest({ email: 'ghost@uade.edu.ar', password: 'whatever' }, { ip: '1.2.3.6' }), ctx);
  assert.equal(res.status, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'INVALID_CREDENTIALS');
});

test('DISABLED_USER — status disabled => 403 ACCESS_DENIED', async () => {
  userStoreMocks.getUserByEmail.mock.mockImplementation(async () => activeUser({ status: 'disabled' }));
  const ctx = makeContext();
  const res = await handlers['auth-login'](makeRequest({ email: 'alu001@uade.edu.ar', password: 'secret-1' }, { ip: '1.2.3.7' }), ctx);
  assert.equal(res.status, 403);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'ACCESS_DENIED');
});

test('MISSING_FIELDS — empty email/password => 400', async () => {
  const ctx = makeContext();
  const res = await handlers['auth-login'](makeRequest({ email: '', password: '' }, { ip: '1.2.3.8' }), ctx);
  assert.equal(res.status, 400);
});

test('RATE_LIMIT — repeated attempts are throttled with 429 TOO_MANY_ATTEMPTS', async () => {
  // CONFIG default login limit is 5 attempts per window. Force rejection after
  // the limit by exercising the same IP+email key several times.
  userStoreMocks.getUserByEmail.mock.mockImplementation(async () => activeUser());
  const ctx = makeContext();
  let saw429 = false;
  for (let i = 0; i < 12; i += 1) {
    const res = await handlers['auth-login'](makeRequest({ email: 'alu001@uade.edu.ar', password: 'secret-1' }, { ip: '9.9.9.9' }), ctx);
    if (res.status === 429) {
      saw429 = true;
      const body = JSON.parse(res.body);
      assert.equal(body.code, 'TOO_MANY_ATTEMPTS');
      break;
    }
  }
  assert.equal(saw429, true);
});

test('ME_OK — authenticated me returns user + scope', async () => {
  userStoreMocks.getUserById.mock.mockImplementation(async () => activeUser());
  const ctx = makeContext();
  ctx.user = { id: 'alu-001', userId: 'alu-001', role: 'Alumno' };
  const res = await handlers['auth-me'](makeRequest({}, { token: 'tok-123' }), ctx);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.data.role, 'student');
  assert.deepEqual(body.data.scope.subjects, ['arq-software-2026']);
});

test('ME_UNAUTHENTICATED — no identity => 401 AUTH_REQUIRED', async () => {
  const ctx = makeContext();
  const res = await handlers['auth-me'](makeRequest({}), ctx);
  assert.equal(res.status, 401);
});

test('CHANGE_PW_WRONG — wrong current password => 401 INVALID_CURRENT_PASSWORD, no hash update', async () => {
  userStoreMocks.getUserById.mock.mockImplementation(async () => activeUser());
  userStoreMocks.verifyPassword.mock.mockImplementation(() => false);
  const ctx = makeContext();
  ctx.user = { id: 'alu-001', userId: 'alu-001', role: 'Alumno' };
  const res = await handlers['auth-change-password'](
    makeRequest({ currentPassword: 'wrong', newPassword: 'new-password-1' }, { token: 'tok-123' }),
    ctx
  );
  assert.equal(res.status, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'INVALID_CURRENT_PASSWORD');
  assert.equal(userStoreMocks.setUserPassword.mock.callCount(), 0);
  assert.equal(sessionStoreMocks.deleteSessionsForUser.mock.callCount(), 0);
});

test('CHANGE_PW_OK — correct current password updates hash and revokes other sessions', async () => {
  userStoreMocks.getUserById.mock.mockImplementation(async () => activeUser());
  userStoreMocks.verifyPassword.mock.mockImplementation(() => true);
  userStoreMocks.setUserPassword.mock.mockImplementation(async () => true);
  const ctx = makeContext();
  ctx.user = { id: 'alu-001', userId: 'alu-001', role: 'Alumno' };
  const res = await handlers['auth-change-password'](
    makeRequest({ currentPassword: 'current-ok', newPassword: 'new-password-1' }, { token: 'tok-123' }),
    ctx
  );
  assert.equal(res.status, 200);
  assert.equal(userStoreMocks.setUserPassword.mock.callCount(), 1);
  const [, password, opts] = userStoreMocks.setUserPassword.mock.calls[0].arguments;
  assert.equal(password, 'new-password-1');
  assert.equal(opts.mustChangePassword, false);
  assert.equal(sessionStoreMocks.deleteSessionsForUser.mock.callCount(), 1);
  const [userId, exceptToken] = sessionStoreMocks.deleteSessionsForUser.mock.calls[0].arguments;
  assert.equal(userId, 'alu-001');
  assert.equal(exceptToken, 'tok-123');
});

test('CHANGE_PW_WEAK — new password shorter than 8 chars => 400 WEAK_PASSWORD', async () => {
  userStoreMocks.getUserById.mock.mockImplementation(async () => activeUser());
  userStoreMocks.verifyPassword.mock.mockImplementation(() => true);
  const ctx = makeContext();
  ctx.user = { id: 'alu-001', userId: 'alu-001', role: 'Alumno' };
  const res = await handlers['auth-change-password'](
    makeRequest({ currentPassword: 'current-ok', newPassword: 'short' }, { token: 'tok-123' }),
    ctx
  );
  assert.equal(res.status, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.error.code, 'WEAK_PASSWORD');
});

test('LOGOUT — deletes the presented session', async () => {
  sessionStoreMocks.deleteSession.mock.mockImplementation(async () => true);
  const ctx = makeContext();
  const res = await handlers['auth-logout'](makeRequest({}, { token: 'tok-123' }), ctx);
  assert.equal(res.status, 200);
  assert.equal(sessionStoreMocks.deleteSession.mock.callCount(), 1);
});
