import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * with-auth.test.js — session-token identity resolution + role enforcement
 * (Story 1.1a/1.1b rewrite: Users table + Sessions table + Enrollments scope).
 */

process.env.AZURE_FUNCTIONS_ENVIRONMENT = '';
process.env.AUTH_MOCK_ENABLED = '';

const authUtilsMocks = {
  parseClientPrincipal: mock.fn(() => null),
  setStashedIdentity: mock.fn(() => {}),
};
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });

const sessionStoreMocks = {
  getSession: mock.fn(async () => null),
};
mock.module('../services/sessions-store.js', { namedExports: sessionStoreMocks });

const usersStoreMocks = {
  getUserById: mock.fn(async () => null),
  INTERNAL_ROLE_BY_ROLE: {
    student: 'Alumno',
    teacher: 'Docente',
    director: 'Director',
    admin: 'Admin',
  },
};
mock.module('../services/users-store.js', { namedExports: usersStoreMocks });

const stateStoreMocks = {
  getEnrollmentsByUser: mock.fn(async () => []),
};
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });

const { withAuth } = await import('./with-auth.js');

function makeRequest({ token, mockRole, method = 'POST' } = {}) {
  const headers = new Map();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (mockRole) headers.set('x-mock-role', mockRole);
  return {
    method,
    headers: { get: (name) => headers.get(name.toLowerCase()) || null },
  };
}

function makeContext() {
  const log = mock.fn();
  log.warn = mock.fn();
  log.error = mock.fn();
  log.info = mock.fn();
  return { log };
}

function activeUser(overrides = {}) {
  return {
    userId: 'alu-001',
    name: 'Alumno Uno',
    surname: 'Prueba',
    email: 'alu@uade.edu.ar',
    role: 'student',
    status: 'active',
    passwordHash: 'salt:hash',
    mustChangePassword: false,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = '';
  process.env.AUTH_MOCK_ENABLED = '';
  authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => null);
  sessionStoreMocks.getSession.mock.mockImplementation(async () => null);
  usersStoreMocks.getUserById.mock.mockImplementation(async () => null);
  stateStoreMocks.getEnrollmentsByUser.mock.mockImplementation(async () => []);
  authUtilsMocks.setStashedIdentity.mock.resetCalls();
});

test('NO_TOKEN_NO_ROLES — handler runs with context.user null (no roles required)', async () => {
  const handler = mock.fn(async (req, ctx) => {
    assert.equal(ctx.user, null);
    assert.equal(ctx.principal, null);
    return { status: 200, body: 'ok' };
  });
  const wrapped = withAuth(handler);
  const res = await wrapped(makeRequest(), makeContext());
  assert.equal(res.status, 200);
});

test('NO_TOKEN_GATED — anonymous on role-required route returns 401 AUTH_REQUIRED', async () => {
  const handler = mock.fn(async () => ({ status: 200 }));
  const wrapped = withAuth(handler, { roles: ['Docente'] });
  const res = await wrapped(makeRequest(), makeContext());
  assert.equal(res.status, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'AUTH_REQUIRED');
  assert.equal(handler.mock.callCount(), 0);
});

test('SESSION_OK — resolves role/scope from Users + Enrollments and calls handler', async () => {
  sessionStoreMocks.getSession.mock.mockImplementation(async () => ({
    token: 'tok-1',
    userId: 'alu-001',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  }));
  usersStoreMocks.getUserById.mock.mockImplementation(async (id) => activeUser({ userId: id, role: 'teacher', email: 'doc@uade.edu.ar' }));
  stateStoreMocks.getEnrollmentsByUser.mock.mockImplementation(async () => [
    { subjectId: 'arq-software-2026', role: 'teacher', status: 'active' },
    { subjectId: 'otra-materia', role: 'student', status: 'active' },
    { subjectId: 'inactiva', role: 'student', status: 'disabled' },
  ]);

  const handler = mock.fn(async (req, ctx) => {
    assert.equal(ctx.user.id, 'alu-001');
    assert.equal(ctx.user.userId, 'alu-001');
    assert.equal(ctx.user.role, 'Docente');
    assert.equal(ctx.user.email, 'doc@uade.edu.ar');
    assert.deepEqual(ctx.user.scope.subjects, ['arq-software-2026', 'otra-materia']);
    assert.ok(ctx.principal.userRoles.includes('Docente'));
    return { status: 200 };
  });
  const wrapped = withAuth(handler, { roles: ['Docente'] });
  const res = await wrapped(makeRequest({ token: 'tok-1' }), makeContext());
  assert.equal(res.status, 200);
  assert.equal(handler.mock.callCount(), 1);
});

test('SESSION_INVALID — unknown token => 401 INVALID_SESSION, never downgraded to mock', async () => {
  sessionStoreMocks.getSession.mock.mockImplementation(async () => null);
  authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
  const handler = mock.fn(async () => ({ status: 200 }));
  const wrapped = withAuth(handler, { roles: ['Docente'] });
  const res = await wrapped(makeRequest({ token: 'garbage-token' }), makeContext());
  assert.equal(res.status, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'INVALID_SESSION');
  assert.equal(handler.mock.callCount(), 0);
});

test('SESSION_EXPIRED — expired token resolves to null session => 401', async () => {
  sessionStoreMocks.getSession.mock.mockImplementation(async () => null);
  const handler = mock.fn(async () => ({ status: 200 }));
  const wrapped = withAuth(handler, { roles: ['Alumno'] });
  const res = await wrapped(makeRequest({ token: 'expired-tok' }), makeContext());
  assert.equal(res.status, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'INVALID_SESSION');
});

test('SESSION_DISABLED — disabled user => 403 ACCESS_DENIED (fail closed)', async () => {
  sessionStoreMocks.getSession.mock.mockImplementation(async () => ({ token: 'tok', userId: 'disabled-1', expiresAt: new Date(Date.now() + 60000).toISOString() }));
  usersStoreMocks.getUserById.mock.mockImplementation(async () => activeUser({ userId: 'disabled-1', status: 'disabled' }));
  const handler = mock.fn(async () => ({ status: 200 }));
  const wrapped = withAuth(handler, { roles: ['Alumno'] });
  const res = await wrapped(makeRequest({ token: 'tok' }), makeContext());
  assert.equal(res.status, 403);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'ACCESS_DENIED');
  assert.equal(handler.mock.callCount(), 0);
});

test('SESSION_UNKNOWN_USER — user deleted => 403 ACCESS_DENIED (fail closed)', async () => {
  sessionStoreMocks.getSession.mock.mockImplementation(async () => ({ token: 'tok', userId: 'ghost', expiresAt: new Date(Date.now() + 60000).toISOString() }));
  usersStoreMocks.getUserById.mock.mockImplementation(async () => null);
  const handler = mock.fn(async () => ({ status: 200 }));
  const wrapped = withAuth(handler, { roles: ['Alumno'] });
  const res = await wrapped(makeRequest({ token: 'tok' }), makeContext());
  assert.equal(res.status, 403);
});

test('ROLE_MISMATCH — Alumno on teacher route => 403 FORBIDDEN', async () => {
  sessionStoreMocks.getSession.mock.mockImplementation(async () => ({ token: 'tok', userId: 'alu-001', expiresAt: new Date(Date.now() + 60000).toISOString() }));
  usersStoreMocks.getUserById.mock.mockImplementation(async () => activeUser());
  const handler = mock.fn(async () => ({ status: 200 }));
  const wrapped = withAuth(handler, { roles: ['Docente', 'Director'] });
  const res = await wrapped(makeRequest({ token: 'tok' }), makeContext());
  assert.equal(res.status, 403);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'FORBIDDEN');
  assert.equal(handler.mock.callCount(), 0);
});

test('STASH_ON_REQUEST — identity stashed via setStashedIdentity (#218)', async () => {
  sessionStoreMocks.getSession.mock.mockImplementation(async () => ({ token: 'tok', userId: 'alu-001', expiresAt: new Date(Date.now() + 60000).toISOString() }));
  usersStoreMocks.getUserById.mock.mockImplementation(async () => activeUser());
  const before = authUtilsMocks.setStashedIdentity.mock.callCount();
  const handler = mock.fn(async (req, ctx) => ({ status: 200 }));
  const wrapped = withAuth(handler);
  const res = await wrapped(makeRequest({ token: 'tok' }), makeContext());
  assert.equal(res.status, 200);
  assert.equal(authUtilsMocks.setStashedIdentity.mock.callCount(), before + 1);
  const [, identityArg] = authUtilsMocks.setStashedIdentity.mock.calls[before].arguments;
  assert.equal(identityArg.user.id, 'alu-001');
  assert.equal(identityArg.principal.userId, 'alu-001');
  assert.ok(identityArg.principal.userRoles.includes('Alumno'));
});

test('MOCK_DEV — mock principal resolves in Development when no token', async () => {
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
  authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'mock-teacher', userRoles: ['Docente'] }));
  try {
    const handler = mock.fn(async (req, ctx) => {
      assert.equal(ctx.user.role, 'Docente');
      return { status: 200 };
    });
    const wrapped = withAuth(handler, { roles: ['Docente'] });
    const res = await wrapped(makeRequest({ mockRole: 'teacher' }), makeContext());
    assert.equal(res.status, 200);
    assert.equal(handler.mock.callCount(), 1);
  } finally {
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = '';
  }
});

test('NO_PRINCIPAL_PROD — production without a token and without a resolvable principal fails closed (401)', async () => {
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
  authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => null);
  try {
    const handler = mock.fn(async () => ({ status: 200 }));
    const wrapped = withAuth(handler, { roles: ['Docente'] });
    const res = await wrapped(makeRequest(), makeContext());
    assert.equal(res.status, 401);
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'AUTH_REQUIRED');
  } finally {
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = '';
  }
});

test('OPTIONS_PREFLIGHT — bypasses auth wrapper', async () => {
  const handler = mock.fn(async () => ({ status: 204 }));
  const wrapped = withAuth(handler, { roles: ['Docente'] });
  const res = await wrapped(makeRequest({ method: 'OPTIONS' }), makeContext());
  assert.equal(res.status, 204);
  assert.equal(handler.mock.callCount(), 1);
});
