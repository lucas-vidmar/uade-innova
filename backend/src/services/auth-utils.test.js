import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Import the real module (no mock) to test production mock gating (#218 F1 regression).
const { isDevelopment, isMockAuthAllowed, parseClientPrincipal } = await import('./auth-utils.js');

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
