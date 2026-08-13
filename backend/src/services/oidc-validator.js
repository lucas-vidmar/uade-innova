/**
 * services/oidc-validator.js — Entra ID OIDC token validation
 *
 * Validates `Authorization: Bearer <token>` JWTs against a Microsoft Entra ID
 * tenant using OIDC discovery + JSON Web Key Sets (JWKS). Signature verification
 * uses Node's built-in `crypto` (no external JWT dependency) so Consumption-plan
 * cold starts stay lean.
 *
 * Behavior when OIDC is not configured (ENTRA_TENANT_ID / ENTRA_CLIENT_ID unset):
 * `validateBearerToken` returns `{ status: 'none' }` so the SWA-principal / mock
 * paths in `with-auth.js` continue to govern. This is the pre-#194 pilot posture.
 */

import { createPublicKey, createVerify } from 'node:crypto';
import { CONFIG } from './config.js';

const DEFAULT_JWKS_TTL_MS = 3600000;

let discoveryCache = null;
let discoveryCacheExpires = 0;
let jwksCache = null;
let jwksCacheExpires = 0;

/**
 * Test hook: clears cached discovery/JWKS so tests can re-inject fetch mocks.
 */
export function resetOidcCache() {
  discoveryCache = null;
  discoveryCacheExpires = 0;
  jwksCache = null;
  jwksCacheExpires = 0;
}

function isConfigured() {
  const tenantId = CONFIG.auth?.oidc?.tenantId || '';
  const clientId = CONFIG.auth?.oidc?.clientId || '';
  return Boolean(
    tenantId &&
    tenantId !== 'PLACEHOLDER' &&
    !tenantId.includes('@Microsoft.KeyVault') &&
    clientId &&
    clientId !== 'PLACEHOLDER' &&
    !clientId.includes('@Microsoft.KeyVault')
  );
}

function discoveryUrl() {
  return `https://login.microsoftonline.com/${CONFIG.auth.oidc.tenantId}/v2.0/.well-known/openid-configuration`;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`OIDC fetch failed ${res.status} for ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getDiscovery() {
  const now = Date.now();
  if (discoveryCache && now < discoveryCacheExpires) return discoveryCache;
  const doc = await fetchJson(discoveryUrl());
  if (!doc.jwks_uri || !doc.issuer) {
    throw new Error('OIDC discovery response missing jwks_uri or issuer');
  }
  discoveryCache = doc;
  discoveryCacheExpires = now + (CONFIG.auth.oidc.jwksTtlMs || DEFAULT_JWKS_TTL_MS);
  return discoveryCache;
}

async function getJwks() {
  const now = Date.now();
  if (jwksCache && now < jwksCacheExpires) return jwksCache;
  const doc = await getDiscovery();
  const jwks = await fetchJson(doc.jwks_uri);
  if (!Array.isArray(jwks.keys)) {
    throw new Error('JWKS response missing keys array');
  }
  jwksCache = jwks;
  jwksCacheExpires = now + (CONFIG.auth.oidc.jwksTtlMs || DEFAULT_JWKS_TTL_MS);
  return jwksCache;
}

function base64UrlDecode(input) {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

function parseJwtParts(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]).toString('utf-8'));
    const payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf-8'));
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: parts[2] };
  } catch {
    return null;
  }
}

function findJwk(keys, kid) {
  if (!kid) return null;
  return keys.find((k) => k.kid === kid) || null;
}

function verifySignature(signingInput, signature, jwk) {
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingInput);
  return verifier.verify(key, Buffer.from(signature, 'base64url'));
}

/**
 * Builds a principal object (same shape as SWA x-ms-client-principal) from OIDC
 * token claims so downstream consumers (role checks, getAuthenticatedUser) work
 * unchanged.
 * @param {Object} payload Decoded JWT payload.
 * @returns {Object} principal-like object.
 */
export function buildPrincipalFromOidcClaims(payload) {
  const groupClaim =
    payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'] ||
    payload.groups;
  const groups = Array.isArray(groupClaim) ? groupClaim : [];

  // Entra v2 "roles" (app roles) and "groups" (group ids / names). Map group
  // names to internal roles via CONFIG.entraGroups; app roles pass through.
  const roles = Array.isArray(payload.roles) ? payload.roles : [];
  const groupNames = groups.filter((g) => typeof g === 'string' && isNaN(Number(g)));
  const matched = Object.entries(CONFIG.entraGroups || {})
    .filter(([, name]) => groupNames.some((g) => g.toLowerCase() === String(name).toLowerCase()))
    .map(([key]) => (key === 'alumnos' ? 'Alumno' : key === 'docentes' ? 'Docente' : key === 'directores' ? 'Director' : key));

  const userRoles = [...new Set(['authenticated', ...roles, ...matched])];

  return {
    userId: payload.oid || payload.sub || null,
    userDetails: payload.name || payload.preferred_username || payload.email || null,
    userRoles,
    groups,
    claims: payload,
    authType: 'oidc',
    oid: payload.oid || null,
  };
}

/**
 * Validates a Bearer token against Entra ID OIDC + JWKS.
 * @param {Request} request The Azure Functions request object.
 * @returns {Promise<{status:'valid'|'none'|'invalid', reason?: string, principal?: Object}>}
 */
export async function validateBearerToken(request) {
  const authHeader = request?.headers?.get?.('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  const token = match?.[1]?.trim();

  if (!token) {
    return { status: 'none' };
  }

  if (!isConfigured()) {
    return { status: 'none' };
  }

  const parsed = parseJwtParts(token);
  if (!parsed) {
    return { status: 'invalid', reason: 'malformed' };
  }

  const { header: jwtHeader, payload } = parsed;

  if (!jwtHeader.alg || jwtHeader.alg !== 'RS256') {
    return { status: 'invalid', reason: 'alg' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) {
    return { status: 'invalid', reason: 'expired' };
  }
  if (payload.nbf && payload.nbf > now) {
    return { status: 'invalid', reason: 'not-before' };
  }

  const expectedIssuer = CONFIG.auth.oidc.issuer ||
    `https://login.microsoftonline.com/${CONFIG.auth.oidc.tenantId}/v2.0`;
  if (!payload.iss || payload.iss !== expectedIssuer) {
    return { status: 'invalid', reason: 'issuer' };
  }

  const audience = payload.aud;
  const expectedAud = CONFIG.auth.oidc.clientId;
  if (Array.isArray(audience)) {
    if (!audience.includes(expectedAud)) {
      return { status: 'invalid', reason: 'audience' };
    }
  } else if (!audience || audience !== expectedAud) {
    return { status: 'invalid', reason: 'audience' };
  }

  try {
    const jwks = await getJwks();
    const jwk = findJwk(jwks.keys, jwtHeader.kid);
    if (!jwk) {
      return { status: 'invalid', reason: 'key-not-found' };
    }
    if (jwk.use && jwk.use !== 'sig') {
      return { status: 'invalid', reason: 'key-use' };
    }
    if (jwk.kty && jwk.kty !== 'RSA') {
      return { status: 'invalid', reason: 'key-type' };
    }
    if (jwk.alg && jwk.alg !== 'RS256') {
      return { status: 'invalid', reason: 'alg' };
    }
    const valid = verifySignature(parsed.signingInput, parsed.signature, jwk);
    if (!valid) {
      return { status: 'invalid', reason: 'signature' };
    }
  } catch (err) {
    // OIDC/JWKS infra unavailable: do NOT hard-fail requests (pilot posture).
    // Fall back to SWA/mock path and let telemetry surface the outage.
    console.error('[OIDC] validation backend unavailable, falling back:', err?.message || err);
    return { status: 'none' };
  }

  return { status: 'valid', principal: buildPrincipalFromOidcClaims(payload) };
}
