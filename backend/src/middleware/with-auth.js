/**
 * middleware/with-auth.js — Identity resolution + role enforcement.
 *
 * Priority order:
 *   1. `Authorization: Bearer <token>` validated via Entra OIDC (if configured).
 *   2. Trusted SWA `x-ms-client-principal` header (proxy path — future #194).
 *   3. Mock fallback — ONLY in Development or when AUTH_MOCK_ENABLED=true.
 *
 * When the server-side allowlist (`ALLOWED_USERS_JSON`) is configured, the
 * verified email is resolved against it (trimmed + case-insensitive, fail
 * closed) and the principal's role + scope are OVERRIDDEN from the allowlist —
 * never from `clientPrincipal.userRoles` or client-submitted params (Story 1.1a).
 * An authenticated-but-unlisted identity receives 403 ACCESS_DENIED.
 *
 * A token that IS present but invalid is NEVER silently downgraded to SWA/mock:
 * it returns a structured 401. `options.roles` enables role gating (403 FORBIDDEN).
 *
 * Self-contained: does not depend on `getAuthenticatedUser` so functions whose
 * tests mock `auth-utils.js` with a partial export surface still work.
 */

import { parseClientPrincipal, setStashedIdentity } from '../services/auth-utils.js';
import {
  isAllowlistConfigured,
  resolveEntryForEmail,
  resolveScopeForEmail,
  resolvePrincipalEmail,
} from '../services/allowlist.js';
import { validateBearerToken } from '../services/oidc-validator.js';
import { structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';

const KNOWN_ROLES = ['Director', 'Docente', 'Alumno', 'Admin', 'Security'];

function authError(status, code, message) {
  return structuredErrorResponse(status, message, ErrorCategory.AUTH, code);
}

// Mirrors auth-utils.isMockAuthAllowed() without importing it, so the mocked
// module surface in tests (auth-utils mocked with namedExports) stays stable.
function isMockAuthPermitted() {
  const env = process.env.AZURE_FUNCTIONS_ENVIRONMENT || process.env.NODE_ENV;
  return env === 'Development' || env === 'development' || process.env.AUTH_MOCK_ENABLED === 'true';
}

function buildUserFromPrincipal(principal) {
  if (!principal) return null;
  const userId = principal.userId || principal.oid || 'anonymous';
  const sanitizedId = String(userId).replace(/[^a-zA-Z0-9]/g, '_');
  const role =
    principal.userRoles?.find((r) => KNOWN_ROLES.includes(r)) || 'Anonymous';
  return { userId, sanitizedId, principal, role };
}

/**
 * Applies server-side allowlist enforcement to a resolved principal (Story 1.1a).
 * Mutates the principal's userRoles with the allowlist-derived role and returns
 * the email. Returns an error response (403 ACCESS_DENIED) when enforcement
 * fails; returns null when the request may proceed.
 * @param {Object|null} principal
 * @param {Request} request
 * @param {Object} context
 * @returns {{error: Object}|{email: string|null}}
 */
function enforceAllowlist(principal, request, context) {
  if (!isAllowlistConfigured()) {
    return { email: null };
  }

  const email = resolvePrincipalEmail(principal, request);

  if (email) {
    const entry = resolveEntryForEmail(email);
    if (!entry) {
      context?.log?.(`[Auth] Deny (allowlist): email=${email} — no en allowlist (fail closed).`);
      return {
        error: authError(403, 'ACCESS_DENIED', 'Tu cuenta no está habilitada para acceder a esta plataforma. Contactá a administración.'),
      };
    }
    // Role/scope come from the allowlist, never from clientPrincipal.userRoles.
    if (!principal) {
      // No SWA/OIDC principal but a verified relayed email (pilot transport):
      // synthesize a principal so the rest of the pipeline works.
      principal = {
        userId: email,
        userDetails: email,
        userRoles: ['authenticated', entry.internalRole],
        claims: [],
      };
    } else {
      principal.userRoles = ['authenticated', entry.internalRole];
    }
    return { email, principal };
  }

  if (!principal) {
    // No identity and no verifiable email: unauthenticated — 401, not 403.
    context?.log?.('[Auth] Deny (allowlist): sin identidad ni email (401).');
    return {
      error: authError(401, 'AUTH_REQUIRED', 'Se requiere autenticación para acceder a este recurso.'),
    };
  }

  if (!isMockAuthPermitted()) {
    // Authenticated principal but no verifiable email in production: fail closed.
    context?.log?.('[Auth] Deny (allowlist): identidad sin email verificable (fail closed).');
    return {
      error: authError(403, 'ACCESS_DENIED', 'No se pudo verificar tu identidad. Iniciá sesión nuevamente.'),
    };
  }

  // Development / escape-hatch mock identities carry no email: preserve mock
  // precedence so local dev keeps working while the allowlist is configured.
  context?.log?.('[Auth] Allowlist configurada + identidad mock sin email: precedencia mock (Development / escape hatch).');
  return { email: null };
}

/**
 * Wraps an HTTP handler with identity resolution + optional role enforcement.
 * @param {Function} handler The Azure Functions HTTP handler.
 * @param {{roles?: string[]}} [options]
 */
export function withAuth(handler, options = {}) {
  const requiredRoles = Array.isArray(options.roles) ? options.roles : [];

  return async (request, context) => {
    if (request?.method === 'OPTIONS') {
      return handler(request, context);
    }

    const tokenResult = await validateBearerToken(request);

    let principal = null;
    if (tokenResult.status === 'valid') {
      principal = tokenResult.principal;
      context?.log?.(`[Auth] Authenticated via OIDC: userId=${principal?.userId}`);
    } else if (tokenResult.status === 'invalid') {
      const reason = tokenResult.reason;
      if (reason === 'expired' || reason === 'not-before') {
        context?.log?.(`[Auth] Rejected token (${reason})`);
        return authError(401, 'TOKEN_EXPIRED', 'La sesión expiró. Iniciá sesión nuevamente.');
      }
      context?.log?.(`[Auth] Rejected token (${reason})`);
      return authError(401, 'INVALID_TOKEN', 'Token de autenticación inválido.');
    }

    if (!principal) {
      principal = parseClientPrincipal(request);
    }

    // Server-side allowlist enforcement (Story 1.1a): resolve verified email →
    // override role/scope; deny unlisted identities (fail closed). May return a
    // synthesized principal when identity came from the relayed email only.
    const allowlistResult = enforceAllowlist(principal, request, context);
    if (allowlistResult.error) {
      return allowlistResult.error;
    }
    if (allowlistResult.principal) {
      principal = allowlistResult.principal;
    }

    const user = buildUserFromPrincipal(principal);
    if (user) {
      if (allowlistResult.email) user.email = allowlistResult.email;
      user.scope = allowlistResult.email ? resolveScopeForEmail(allowlistResult.email) : undefined;
    }

    context.user = user;
    context.principal = principal || null;
    // Stash resolved identity in a WeakMap (auth-utils) so functions that resolve
    // identity via parseClientPrincipal(request)/getAuthenticatedUser(request)
    // honor the validated OIDC principal instead of re-deriving from SWA/mock
    // headers (#218). HttpRequest.user/principal are read-only getters, so direct
    // assignment fails.
    setStashedIdentity(request, { user, principal: principal || null });

    if (requiredRoles.length > 0) {
      if (!principal) {
        return authError(401, 'AUTH_REQUIRED', 'Se requiere autenticación para acceder a este recurso.');
      }
      const userRoles = principal.userRoles || [];
      const hasRole = requiredRoles.some((r) => userRoles.includes(r));
      if (!hasRole) {
        context?.log?.(`[Auth] Forbidden: userId=${user?.userId}, required=${requiredRoles.join(',')}, roles=${userRoles.join(',')}`);
        return authError(403, 'FORBIDDEN', 'No tenés permisos para acceder a este recurso.');
      }
    }

    return handler(request, context);
  };
}

/**
 * Convenience wrapper for role-gated endpoints.
 * @param {string[]} roles
 */
export function requireRole(roles) {
  return (handler) => withAuth(handler, { roles });
}
