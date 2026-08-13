import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signToken(claims, { kid = 'test-key', expOffset = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = {
    iss: 'https://login.microsoftonline.com/test-tenant/v2.0',
    aud: 'test-client',
    iat: now,
    nbf: now,
    exp: now + expOffset,
    ...claims,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(privateKey, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${signingInput}.${signature}`;
}

const jwks = {
  keys: [
    {
      kty: 'RSA',
      kid: 'test-key',
      alg: 'RS256',
      use: 'sig',
      ...publicKey.export({ format: 'jwk' }),
    },
  ],
};

const discoveryDoc = {
  issuer: 'https://login.microsoftonline.com/test-tenant/v2.0',
  jwks_uri: 'https://login.microsoftonline.com/test-tenant/discovery/v2.0/keys',
};

process.env.ENTRA_TENANT_ID = 'test-tenant';
process.env.ENTRA_CLIENT_ID = 'test-client';
process.env.AUTH_MOCK_ENABLED = '';

globalThis.fetch = async (url) => {
  if (String(url).includes('openid-configuration')) {
    return { ok: true, json: async () => discoveryDoc };
  }
  return { ok: true, json: async () => jwks };
};

const authUtilsMocks = {
  parseClientPrincipal: mock.fn(() => null),
};
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });

const { withAuth } = await import('./with-auth.js');
const { resetOidcCache } = await import('../services/oidc-validator.js');

function makeRequest({ token, mockRole, swaPrincipal, method = 'POST' } = {}) {
  const headers = new Map();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (mockRole) headers.set('x-mock-role', mockRole);
  if (swaPrincipal) headers.set('x-ms-client-principal', swaPrincipal);
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

beforeEach(() => {
  resetOidcCache();
  authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => null);
});

test('NO_IDENTITY — passes through with context.user null when no identity and no roles required', async () => {
  const handler = mock.fn(async (req, ctx) => {
    assert.equal(ctx.user, null);
    assert.equal(ctx.principal, null);
    return { status: 200, body: 'ok' };
  });
  const wrapped = withAuth(handler);
  const res = await wrapped(makeRequest(), makeContext());
  assert.equal(res.status, 200);
});

test('VALID_OIDC — resolves principal from Bearer token and populates context.user', async () => {
  const token = signToken({ oid: 'user-123', roles: ['Docente'] });
  const handler = mock.fn(async (req, ctx) => {
    assert.equal(ctx.principal.userId, 'user-123');
    assert.equal(ctx.user.userId, 'user-123');
    assert.ok(ctx.user.role === 'Docente' || ctx.principal.userRoles.includes('Docente'));
    return { status: 200, body: 'ok' };
  });
  const wrapped = withAuth(handler);
  const res = await wrapped(makeRequest({ token }), makeContext());
  assert.equal(res.status, 200);
});

test('INVALID_TOKEN — returns 401 INVALID_TOKEN, never downgrades to mock', async () => {
  authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
  const handler = mock.fn(async () => ({ status: 200 }));
  const wrapped = withAuth(handler);
  const res = await wrapped(makeRequest({ token: 'not-a-valid-jwt' }), makeContext());
  assert.equal(res.status, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.errorCategory, 'AUTH');
  assert.equal(body.code, 'INVALID_TOKEN');
  assert.equal(handler.mock.callCount(), 0);
});

test('EXPIRED_TOKEN — returns 401 TOKEN_EXPIRED', async () => {
  const token = signToken({ oid: 'u-1' }, { expOffset: -100 });
  const wrapped = withAuth(mock.fn(async () => ({ status: 200 })));
  const res = await wrapped(makeRequest({ token }), makeContext());
  assert.equal(res.status, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'TOKEN_EXPIRED');
});

test('ROLE_OK — Docente allowed on Docente-gated route', async () => {
  const token = signToken({ oid: 'u-1', roles: ['Docente'] });
  const handler = mock.fn(async () => ({ status: 200 }));
  const wrapped = withAuth(handler, { roles: ['Docente', 'Director'] });
  const res = await wrapped(makeRequest({ token }), makeContext());
  assert.equal(res.status, 200);
  assert.equal(handler.mock.callCount(), 1);
});

test('ROLE_MISMATCH — Alumno on teacher route returns 403 FORBIDDEN', async () => {
  const token = signToken({ oid: 'u-1', roles: ['Alumno'] });
  const wrapped = withAuth(mock.fn(async () => ({ status: 200 })), { roles: ['Docente', 'Director'] });
  const res = await wrapped(makeRequest({ token }), makeContext());
  assert.equal(res.status, 403);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'FORBIDDEN');
});

test('AUTH_REQUIRED — anonymous on role-required route returns 401', async () => {
  const wrapped = withAuth(mock.fn(async () => ({ status: 200 })), { roles: ['Docente'] });
  const res = await wrapped(makeRequest(), makeContext());
  assert.equal(res.status, 401);
  const body = JSON.parse(res.body);
  assert.equal(body.code, 'AUTH_REQUIRED');
});

test('SWA_PRINCIPAL — resolves principal from x-ms-client-principal when no Bearer', async () => {
  authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'swa-user', userRoles: ['Director'] }));
  const principalB64 = Buffer.from(JSON.stringify({ userId: 'swa-user', userRoles: ['Director'] })).toString('base64');
  const handler = mock.fn(async (req, ctx) => {
    assert.equal(ctx.principal.userId, 'swa-user');
    return { status: 200 };
  });
  const wrapped = withAuth(handler, { roles: ['Director'] });
  const res = await wrapped(makeRequest({ swaPrincipal: principalB64 }), makeContext());
  assert.equal(res.status, 200);
});

test('MOCK_DEV — mock principal resolves in Development', async () => {
  const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
  authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'mock-teacher', userRoles: ['Docente'] }));
  try {
    const handler = mock.fn(async () => ({ status: 200 }));
    const wrapped = withAuth(handler, { roles: ['Docente'] });
    const res = await wrapped(makeRequest({ mockRole: 'teacher' }), makeContext());
    assert.equal(res.status, 200);
  } finally {
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
  }
});

test('OPTIONS_PREFLIGHT — bypasses auth wrapper', async () => {
  const handler = mock.fn(async () => ({ status: 204 }));
  const wrapped = withAuth(handler, { roles: ['Docente'] });
  const res = await wrapped(makeRequest({ method: 'OPTIONS' }), makeContext());
  assert.equal(res.status, 204);
  assert.equal(handler.mock.callCount(), 1);
});
