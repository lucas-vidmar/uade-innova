/**
 * middleware/with-auth.js — Identity resolution + role enforcement.
 *
 * Priority order:
 *   1. `Authorization: Bearer <token>` validated via Entra OIDC (if configured).
 *   2. Trusted SWA `x-ms-client-principal` header (proxy path — future #194).
 *   3. Mock fallback — ONLY in Development or when AUTH_MOCK_ENABLED=true.
 *
 * A token that IS present but invalid is NEVER silently downgraded to SWA/mock:
 * it returns a structured 401. `options.roles` enables role gating (403 FORBIDDEN).
 *
 * Self-contained: does not depend on `getAuthenticatedUser` so functions whose
 * tests mock `auth-utils.js` with a partial export surface still work.
 */

import { parseClientPrincipal, setStashedIdentity } from '../services/auth-utils.js';
import { validateBearerToken } from '../services/oidc-validator.js';
import { structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';

const KNOWN_ROLES = ['Director', 'Docente', 'Alumno', 'Admin', 'Security'];

function authError(status, code, message) {
  return structuredErrorResponse(status, message, ErrorCategory.AUTH, code);
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

    const user = buildUserFromPrincipal(principal);

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
