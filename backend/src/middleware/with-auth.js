/**
 * middleware/with-auth.js — Session-token identity resolution + role enforcement.
 *
 * The Microsoft-account / allowlist auth path is GONE. Identity now comes from
 * the app-owned central user database:
 *
 *   1. `Authorization: Bearer <token>` → opaque session in the `Sessions` table.
 *   2. Session `userId` → user record in the `Users` table (role, status).
 *   3. Scope resolved from the `Enrollments` table by `userId`.
 *
 * Fail closed:
 *   - Unknown/expired token            → 401 INVALID_SESSION
 *   - Missing token in production      → 401 AUTH_REQUIRED (when gated)
 *   - Disabled / unknown user          → 403 ACCESS_DENIED
 *   - Unenrolled student on scoped API → 403 FORBIDDEN (scope is resolved per
 *     request from Enrollments; endpoints enforce their own scope).
 *   - A token that IS present but invalid is NEVER downgraded to mock.
 *
 * Development/escape-hatch mock identities (no token) are still permitted via
 * `parseClientPrincipal` so local frontend dev keeps working without the
 * backend (Story 1.1a dev-mock path).
 *
 * `options.roles` enables role gating (403 FORBIDDEN). The roles are the
 * internal (Spanish) role names used across the codebase: Alumno, Docente,
 * Director, Admin.
 */

import { setStashedIdentity, parseClientPrincipal } from '../services/auth-utils.js';
import { structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';

// NOTE: sessions-store / users-store / state-store are imported lazily inside
// resolveSessionIdentity(). The store modules are mocked (partial surfaces) by
// many function tests, and a static import here would make every function that
// wraps withAuth fail to load under those mocks.

const KNOWN_ROLES = ['Director', 'Docente', 'Alumno', 'Admin', 'Security'];

function authError(status, code, message) {
  return structuredErrorResponse(status, message, ErrorCategory.AUTH, code);
}

function extractBearerToken(request) {
  const authHeader = request?.headers?.get?.('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match ? match[1].trim() : null;
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
 * Resolves an authenticated identity from an opaque session token. Returns
 * { user, principal } on success, or an error response when the token is
 * invalid / user is missing or disabled (fail closed).
 * @param {string} token
 * @param {Object} context
 * @returns {Promise<{user: Object, principal: Object}|{error: Object}>}
 */
async function resolveSessionIdentity(token, context) {
  const { getSession } = await import('../services/sessions-store.js');
  const { getUserById, INTERNAL_ROLE_BY_ROLE } = await import('../services/users-store.js');
  const { getEnrollmentsByUser } = await import('../services/state-store.js');

  const session = await getSession(token);
  if (!session) {
    context?.log?.('[Auth] Rejected session token (unknown or expired).');
    return {
      error: authError(401, 'INVALID_SESSION', 'La sesión no es válida o expiró. Iniciá sesión nuevamente.'),
    };
  }

  const appUser = await getUserById(session.userId);
  if (!appUser || appUser.status !== 'active') {
    context?.log?.(`[Auth] Deny: userId=${session.userId} — usuario inexistente o deshabilitado (fail closed).`);
    return {
      error: authError(403, 'ACCESS_DENIED', 'Tu cuenta no está habilitada para acceder a esta plataforma. Contactá a administración.'),
    };
  }

  const internalRole = INTERNAL_ROLE_BY_ROLE[appUser.role];
  if (!internalRole) {
    context?.log?.(`[Auth] Deny: userId=${appUser.userId} — rol inválido ${appUser.role} (fail closed).`);
    return {
      error: authError(403, 'ACCESS_DENIED', 'Tu cuenta no tiene un rol válido. Contactá a administración.'),
    };
  }

  // Scope is resolved from Enrollments per request (Story 1.1b). Director/Admin
  // roles keep an empty subject scope here; their dashboards are not scoped.
  const enrollments = await getEnrollmentsByUser(appUser.userId);
  const subjects = [...new Set(
    enrollments.filter((e) => e.status === 'active').map((e) => e.subjectId)
  )].filter(Boolean);

  const user = {
    userId: appUser.userId,
    id: appUser.userId,
    sanitizedId: String(appUser.userId).replace(/[^a-zA-Z0-9]/g, '_'),
    role: internalRole,
    email: appUser.email,
    name: appUser.name,
    mustChangePassword: appUser.mustChangePassword === true,
    scope: { subjects, classes: [] },
    principal: null,
  };

  const principal = {
    userId: appUser.userId,
    userDetails: appUser.email,
    userRoles: ['authenticated', internalRole],
    claims: [],
  };

  context?.log?.(`[Auth] Authenticated via session: userId=${appUser.userId}, role=${internalRole}, scope=${subjects.join(',') || 'n/a'}`);
  return { user, principal };
}

/**
 * Wraps an HTTP handler with session-token identity resolution + optional role
 * enforcement.
 * @param {Function} handler The Azure Functions HTTP handler.
 * @param {{roles?: string[]}} [options]
 */
export function withAuth(handler, options = {}) {
  const requiredRoles = Array.isArray(options.roles) ? options.roles : [];

  return async (request, context) => {
    if (request?.method === 'OPTIONS') {
      return handler(request, context);
    }

    const token = extractBearerToken(request);
    let user = null;
    let principal = null;

    if (token) {
      let result;
      try {
        result = await resolveSessionIdentity(token, context);
      } catch (err) {
        // Storage/transient errors during session resolution must not escape as
        // an unhandled 500/stack trace. Fail closed with a structured 401 so a
        // blip forces re-auth instead of leaking internals.
        context?.log?.(`[Auth] Session resolution error: ${err?.message}`);
        return authError(401, 'INVALID_SESSION', 'No se pudo verificar tu sesión. Intentá iniciar sesión nuevamente.');
      }
      if (result.error) {
        return result.error;
      }
      user = result.user;
      principal = result.principal;
      context.user = user;
      context.principal = principal;
    } else {
      // No bearer token: fall back to a trusted SWA principal
      // (x-ms-client-principal header) or the DEV-only mock principal
      // (guarded inside auth-utils). In production a principal-less request is
      // anonymous and role-gated routes fail closed with 401.
      principal = parseClientPrincipal(request);
      if (principal) {
        user = buildUserFromPrincipal(principal);
        user.id = user.userId;
        context.user = user;
        context.principal = principal;
      }
    }

    if (context.user === undefined) context.user = user;
    if (context.principal === undefined) context.principal = principal;

    // Stash resolved identity in a WeakMap (auth-utils) so functions that resolve
    // identity via parseClientPrincipal(request)/getAuthenticatedUser(request)
    // honor the validated session instead of re-deriving from SWA/mock headers.
    setStashedIdentity(request, { user, principal });

    if (requiredRoles.length > 0) {
      if (!principal) {
        context?.log?.('[Auth] Deny: se requiere autenticación.');
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
