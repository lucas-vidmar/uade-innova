import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, createHash } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signToken(claims, { kid = 'test-key', alg = 'RS256', expOffset = 3600 } = {}) {
  const header = { alg, kid, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
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

// Reset CONFIG via env before import
process.env.ENTRA_TENANT_ID = 'test-tenant';
process.env.ENTRA_CLIENT_ID = 'test-client';

const fetchedUrls = [];
globalThis.fetch = async (url) => {
  fetchedUrls.push(String(url));
  if (String(url).includes('openid-configuration')) {
    return { ok: true, json: async () => discoveryDoc };
  }
  return { ok: true, json: async () => jwks };
};

const { validateBearerToken, buildPrincipalFromOidcClaims, resetOidcCache } = await import('./oidc-validator.js');

function mockRequest(tokenOrNull) {
  return {
    headers: {
      get: (name) => (name.toLowerCase() === 'authorization' && tokenOrNull ? `Bearer ${tokenOrNull}` : null),
    },
  };
}

beforeEach(() => {
  fetchedUrls.length = 0;
  resetOidcCache();
});

test('NO_AUTH_HEADER — returns status none when no Bearer token present', async () => {
  const result = await validateBearerToken(mockRequest(null));
  assert.equal(result.status, 'none');
});

test('VALID_TOKEN — returns valid with principal built from claims', async () => {
  const token = signToken({ oid: 'user-123', name: 'Docente Test', roles: ['Docente'] });
  const result = await validateBearerToken(mockRequest(token));
  assert.equal(result.status, 'valid');
  assert.equal(result.principal.userId, 'user-123');
  assert.ok(result.principal.userRoles.includes('Docente'));
});

test('VALID_TOKEN — maps Entra groups to internal roles', async () => {
  const token = signToken({ oid: 'user-123', groups: ['Docentes-Pilot'] });
  const result = await validateBearerToken(mockRequest(token));
  assert.equal(result.status, 'valid');
  assert.ok(result.principal.userRoles.includes('Docente'));
});

test('EXPIRED_TOKEN — returns invalid reason expired', async () => {
  const token = signToken({ oid: 'user-123' }, { expOffset: -100 });
  const result = await validateBearerToken(mockRequest(token));
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'expired');
});

test('NOT_BEFORE_FUTURE — returns invalid reason not-before', async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = signToken({ oid: 'user-123', nbf: now + 1000 });
  const result = await validateBearerToken(mockRequest(token));
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'not-before');
});

test('WRONG_AUDIENCE — returns invalid reason audience', async () => {
  const token = signToken({ oid: 'user-123', aud: 'some-other-client' });
  const result = await validateBearerToken(mockRequest(token));
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'audience');
});

test('WRONG_ISSUER — returns invalid reason issuer', async () => {
  const token = signToken({ oid: 'user-123', iss: 'https://login.microsoftonline.com/other-tenant/v2.0' });
  const result = await validateBearerToken(mockRequest(token));
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'issuer');
});

test('BAD_SIGNATURE — returns invalid reason signature', async () => {
  const token = signToken({ oid: 'user-123' });
  const parts = token.split('.');
  const tampered = `${parts[0]}.${parts[1]}.${b64url('tampered-signature-bytes')}`;
  const result = await validateBearerToken(mockRequest(tampered));
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'signature');
});

test('MALFORMED — returns invalid reason malformed', async () => {
  const result = await validateBearerToken(mockRequest('not-a-jwt'));
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'malformed');
});

test('WRONG_ALG — returns invalid reason alg', async () => {
  const token = signToken({ oid: 'user-123' }, { alg: 'HS256' });
  const result = await validateBearerToken(mockRequest(token));
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'alg');
});

test('JWKS_FETCH_FAIL — falls back to none (does not hard-fail)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  try {
    const token = signToken({ oid: 'user-123' });
    const result = await validateBearerToken(mockRequest(token));
    assert.equal(result.status, 'none');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildPrincipalFromOidcClaims — passes through roles and oid', () => {
  const principal = buildPrincipalFromOidcClaims({ oid: 'u-1', roles: ['Admin'], name: 'A' });
  assert.equal(principal.userId, 'u-1');
  assert.ok(principal.userRoles.includes('Admin'));
  assert.equal(principal.authType, 'oidc');
});
