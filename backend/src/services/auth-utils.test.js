import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Import the real module (no mock) to test production mock gating (#218 F1 regression).
const { isDevelopment, isMockAuthAllowed, parseClientPrincipal, getAuthenticatedUser, setStashedIdentity, readDevIdentityHeader, resolveIdentityKey } = await import('./auth-utils.js');
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

test('SWA_PRINCIPAL_PROD_OFF — a forged x-ms-client-principal header is NOT identity in production', () => {
  // UJ-52: el encabezado no lo puede verificar la app y el Function App es
  // alcanzable directo, así que honrarlo por defecto es suplantación sin
  // sesión. Verificado en el piloto: sin token devolvía el perfil de otra
  // persona, el directorio completo de administración y dejaba a una identidad
  // deshabilitada seguir leyendo y escribiendo su historia.
  const principalB64 = Buffer.from(JSON.stringify({ userId: 'swa-user', userRoles: ['authenticated', 'Director'] })).toString('base64');
  const req = mockRequest({ 'x-ms-client-principal': principalB64 });
  assert.equal(parseClientPrincipal(req), null);
  assert.equal(getAuthenticatedUser(req).userId, 'anonymous');
  assert.equal(getAuthenticatedUser(req).role, 'Anonymous');
});

test('SWA_PRINCIPAL_TRUSTED — honored only when the deployment declares it trustworthy', () => {
  const principalB64 = Buffer.from(JSON.stringify({ userId: 'swa-user', userRoles: ['authenticated', 'Director'] })).toString('base64');
  const req = mockRequest({ 'x-ms-client-principal': principalB64 });
  assert.equal(parseClientPrincipal(req), null);

  process.env.SWA_PRINCIPAL_TRUSTED = 'true';
  const principal = parseClientPrincipal(req);
  assert.equal(principal.userId, 'swa-user');
  assert.ok(principal.userRoles.includes('Director'));
});

test('SWA_PRINCIPAL_DEV — honored in Development (local func start)', () => {
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
  const principalB64 = Buffer.from(JSON.stringify({ userId: 'swa-user', userRoles: ['authenticated', 'Director'] })).toString('base64');
  const principal = parseClientPrincipal(mockRequest({ 'x-ms-client-principal': principalB64 }));
  assert.equal(principal.userId, 'swa-user');
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
  process.env.SWA_PRINCIPAL_TRUSTED = 'true';
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
  process.env.SWA_PRINCIPAL_TRUSTED = 'true';
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

// Los encabezados x-edu-uid / x-mock-role no son identidad: los puede mandar
// cualquiera. En producción se ignoran (verificado: devolvían el historial de
// otro alumno sin sesión); solo valen con el atajo de mock habilitado.
test('DEV_IDENTITY_HEADER_PROD_OFF — x-edu-uid is ignored in production', () => {
  const req = mockRequest({ 'x-edu-uid': 'alu-001' });
  assert.equal(readDevIdentityHeader(req, 'x-edu-uid'), null);
  assert.equal(getAuthenticatedUser(req).userId, 'anonymous');
  assert.equal(resolveIdentityKey(req, undefined), 'pilot-user');
});

test('DEV_IDENTITY_HEADER_ESCAPE_HATCH — x-edu-uid is honored with AUTH_MOCK_ENABLED=true', () => {
  process.env.AUTH_MOCK_ENABLED = 'true';
  const req = mockRequest({ 'x-edu-uid': 'alu-001' });
  assert.equal(readDevIdentityHeader(req, 'x-edu-uid'), 'alu-001');
  assert.equal(getAuthenticatedUser(req).userId, 'alu-001');
  assert.equal(resolveIdentityKey(req, undefined), 'alu-001');
});

test('DEV_IDENTITY_HEADER_DEV — x-edu-uid is honored in Development', () => {
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
  const req = mockRequest({ 'x-edu-uid': 'alu-002' });
  assert.equal(readDevIdentityHeader(req, 'x-edu-uid'), 'alu-002');
  assert.equal(getAuthenticatedUser(req).userId, 'alu-002');
});

test('DEV_IDENTITY_HEADER_SESSION — a real session identity always wins over the header', () => {
  process.env.AUTH_MOCK_ENABLED = 'true';
  const req = mockRequest({ 'x-edu-uid': 'alu-001' });
  setStashedIdentity(req, {
    user: { userId: 'session-user', sanitizedId: 'session_user', principal: { userRoles: ['Alumno'] }, role: 'Alumno' },
    principal: null,
  });
  assert.equal(resolveIdentityKey(req, undefined), 'session-user');
});
