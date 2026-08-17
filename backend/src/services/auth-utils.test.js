import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Import the real module (no mock) to test production mock gating (#218 F1 regression).
const { isDevelopment, isMockAuthAllowed, parseClientPrincipal, getAuthenticatedUser, setStashedIdentity } = await import('./auth-utils.js');
const { resetAllowlistCache, isAllowlistConfigured } = await import('./allowlist.js');

function mockRequest(headers = {}) {
  return {
    headers: {
      get: (name) => headers[name.toLowerCase()] || null,
    },
    query: {
      get: (name) => headers[name.toLowerCase()] || null,
    },
  };
}

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
  process.env.NODE_ENV = 'production';
  process.env.AUTH_MOCK_ENABLED = '';
  process.env.ALLOWED_USERS_JSON = '';
  resetAllowlistCache();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in savedEnv)) delete process.env[k];
  }
  Object.assign(process.env, savedEnv);
});

test('isDevelopment returns false in production (AZURE_FUNCTIONS_ENVIRONMENT=Production)', () => {
  assert.equal(isDevelopment(), false);
});

test('isDevelopment returns false when NODE_ENV=production', () => {
  delete process.env.AZURE_FUNCTIONS_ENVIRONMENT;
  assert.equal(isDevelopment(), false);
});

test('isDevelopment returns true for Development', () => {
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
  assert.equal(isDevelopment(), true);
});

test('isDevelopment returns true for lowercase development NODE_ENV', () => {
  delete process.env.AZURE_FUNCTIONS_ENVIRONMENT;
  process.env.NODE_ENV = 'development';
  assert.equal(isDevelopment(), true);
});

test('MOCK_PROD_OFF — mock auth rejected in Production when AUTH_MOCK_ENABLED falsy', () => {
  assert.equal(isMockAuthAllowed(), false);
  const principal = parseClientPrincipal(mockRequest({ 'x-mock-role': 'director' }));
  assert.equal(principal, null);
  const viaQuery = parseClientPrincipal(mockRequest({ _mock_role: 'director' }));
  assert.equal(viaQuery, null);
});

test('MOCK_ESCAPE_HATCH — mock auth allowed in Production when AUTH_MOCK_ENABLED=true', () => {
  process.env.AUTH_MOCK_ENABLED = 'true';
  assert.equal(isMockAuthAllowed(), true);
  const principal = parseClientPrincipal(mockRequest({ 'x-mock-role': 'director' }));
  assert.equal(principal?.userRoles?.includes('Director'), true);
});

test('MOCK_DEV — mock auth allowed in Development', () => {
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
  assert.equal(isMockAuthAllowed(), true);
});

test('SWA_PRINCIPAL — real x-ms-client-principal header is parsed regardless of env', () => {
  const principalB64 = Buffer.from(JSON.stringify({ userId: 'swa-user', userRoles: ['Director'] })).toString('base64');
  const principal = parseClientPrincipal(mockRequest({ 'x-ms-client-principal': principalB64 }));
  assert.equal(principal.userId, 'swa-user');
  assert.ok(principal.userRoles.includes('Director'));
});

test('STASHED_PRINCIPAL — request principal stashed by withAuth wins over headers (#218)', () => {
  const principalB64 = Buffer.from(JSON.stringify({ userId: 'swa-user', userRoles: ['Director'] })).toString('base64');
  const req = mockRequest({ 'x-ms-client-principal': principalB64 });
  setStashedIdentity(req, { principal: { userId: 'oidc-user', userRoles: ['Docente'], authType: 'oidc' }, user: null });
  const principal = parseClientPrincipal(req);
  assert.equal(principal.userId, 'oidc-user');
  assert.ok(principal.userRoles.includes('Docente'));
  assert.equal(principal.authType, 'oidc');
});

test('STASHED_USER — getAuthenticatedUser prefers user stashed by withAuth (#218)', () => {
  const req = mockRequest({});
  setStashedIdentity(req, {
    user: { userId: 'oidc-user', sanitizedId: 'oidc_user', principal: { userRoles: ['Docente'] }, role: 'Docente' },
    principal: null,
  });
  const user = getAuthenticatedUser(req);
  assert.equal(user.userId, 'oidc-user');
  assert.equal(user.sanitizedId, 'oidc_user');
  assert.equal(user.role, 'Docente');
});

test('ALLOWLIST_UNRESOLVABLE_EMAIL — configured allowlist + authenticated principal without a listed email yields role Denied (fail closed, Story 1.1a/10.25)', () => {
  process.env.ALLOWED_USERS_JSON = JSON.stringify([
    { email: 'prof@uade.edu.ar', role: 'teacher' },
  ]);
  resetAllowlistCache();
  assert.equal(isAllowlistConfigured(), true);

  const principalB64 = Buffer.from(JSON.stringify({
    userId: 'swa-stranger',
    userRoles: ['authenticated', 'Alumno'],
    email: 'stranger@uade.edu.ar',
  })).toString('base64');
  const req = mockRequest({ 'x-ms-client-principal': principalB64 });
  const user = getAuthenticatedUser(req);
  assert.equal(user.role, 'Denied');
  assert.equal(user.email, 'stranger@uade.edu.ar');
  assert.equal(user.scope, undefined);
});

test('ALLOWLIST_ALLOWED_EMAIL — configured allowlist + listed email resolves the allowlist role (Story 1.1a)', () => {
  process.env.ALLOWED_USERS_JSON = JSON.stringify([
    { email: 'prof@uade.edu.ar', role: 'teacher', subjects: ['arq-software-2026'] },
  ]);
  resetAllowlistCache();

  const principalB64 = Buffer.from(JSON.stringify({
    userId: 'swa-prof',
    userRoles: ['authenticated', 'Alumno'],
    email: 'prof@uade.edu.ar',
  })).toString('base64');
  const req = mockRequest({ 'x-ms-client-principal': principalB64 });
  const user = getAuthenticatedUser(req);
  assert.equal(user.role, 'Docente');
  assert.deepEqual(user.scope, { subjects: ['arq-software-2026'], classes: [] });
});
