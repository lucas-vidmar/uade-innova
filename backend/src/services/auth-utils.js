/**
 * Shared authentication utilities for Azure Functions within Static Web Apps.
 */

import {
  isAllowlistConfigured,
  resolveRoleForEmail,
  resolveScopeForEmail,
  resolvePrincipalEmail,
  resolveUserIdForEmail,
} from './allowlist.js';

// Resolved identity stash per-request, populated by the withAuth middleware.
// Stored in a WeakMap because Azure Functions' HttpRequest exposes `user`/`principal`
// as read-only getters that cannot be assigned (#218).
const resolvedIdentity = new WeakMap();

/**
 * Stores the identity resolved by withAuth for a request.
 * @param {Request} request
 * @param {{user: Object|null, principal: Object|null}} identity
 */
export function setStashedIdentity(request, identity) {
  resolvedIdentity.set(request, identity);
}

/**
 * Retrieves the identity stashed by withAuth for a request, or null.
 * @param {Request} request
 * @returns {{user: Object|null, principal: Object|null}|null}
 */
export function getStashedIdentity(request) {
  return resolvedIdentity.get(request) || null;
}

/**
 * True when running in a local Development environment (func start / azurite).
 * Azure sets AZURE_FUNCTIONS_ENVIRONMENT to 'Production' (capital P); local
 * func start sets it to 'Development'. NODE_ENV is set to 'production' by bicep.
 * @returns {boolean}
 */
export function isDevelopment() {
  const env = process.env.AZURE_FUNCTIONS_ENVIRONMENT || process.env.NODE_ENV;
  return env === 'Development' || env === 'development';
}

/**
 * True when the mock auth fallback is permitted: Development OR the explicit
 * AUTH_MOCK_ENABLED escape hatch (pilot continuity until #194 provisions Entra).
 * @returns {boolean}
 */
export function isMockAuthAllowed() {
  return isDevelopment() || process.env.AUTH_MOCK_ENABLED === 'true';
}

function enrichPrincipalEmail(principal, request) {
  const email = resolvePrincipalEmail(principal, request);
  if (email && !principal.email) principal.email = email;
  return principal;
}

/**
 * Parses the x-ms-client-principal header injected by Azure Static Web Apps.
 * @param {Request} request The incoming Azure Function request object.
 * @returns {Object|null} The parsed principal object or null if not found.
 */
export function parseClientPrincipal(request) {
    // 0. Principal already resolved by the withAuth middleware (validated OIDC
    //    Bearer token). Functions wrapped in withAuth get this for free (#218).
    const stashed = getStashedIdentity(request);
    if (stashed && stashed.principal) {
        return enrichPrincipalEmail(stashed.principal, request);
    }

    let principal = null;

    // 1. Try to parse real SWA principal
    const clientPrincipalHeader = request?.headers?.get?.('x-ms-client-principal');
    if (clientPrincipalHeader) {
        try {
            const encoded = Buffer.from(clientPrincipalHeader, 'base64').toString('utf-8');
            const parsed = JSON.parse(encoded);
            
            // Extract useful claims for easier access
            const claims = parsed.claims || [];
            const groups = claims.filter(c => c.typ === 'groups').map(c => c.val);
            const oid = claims.find(c => c.typ === "http://schemas.microsoft.com/identity/claims/objectidentifier")?.val || parsed.userId;
            
            principal = {
                ...parsed,
                groups,
                oid
            };
        } catch (error) {
            console.error('Error parsing x-ms-client-principal:', error);
        }
    }

    // 2. Fallback to mock role (header or query param) for demo/mock mode
    // Query params avoid CORS preflight in browser.
    // Guarded: only Development or explicit AUTH_MOCK_ENABLED=true (pilot
    // continuity until #194 provisions Entra ID + token plumbing).
    if (!principal && isMockAuthAllowed()) {
        const mockRole = request.headers?.get?.('x-mock-role') || request.query?.get?.('_mock_role');
        const eduUid = request.headers?.get?.('x-edu-uid') || request.query?.get?.('_mock_uid');
        if (mockRole) {
            const roleMapping = {
                'director': 'Director',
                'teacher': 'Docente',
                'student': 'Alumno',
                'admin': 'Admin',
                'security': 'Security'
            };
            const mappedRole = roleMapping[mockRole] || 'Anonymous';
            const userIdMapping = {
                'director': 'dir-001',
                'teacher': 'doc-001',
                'student': 'alu-001',
                'admin': 'adm-001',
                'security': 'sec-001'
            };
            const mockUserId = eduUid || userIdMapping[mockRole] || `mock-${mockRole}`;
            
            principal = {
                userId: mockUserId,
                userDetails: `Mock ${mappedRole}`,
                userRoles: ['authenticated', mappedRole],
                groups: [],
                oid: `mock-${mockRole}-oid`
            };
        }
    }

    if (!principal) return null;
    return enrichPrincipalEmail(principal, request);
}

/**
 * Unifies user identification across functions, respecting both real SWA principals
 * and the x-mock-role header for pilot/demo modes.
 * @param {Request} request
 */
export function getAuthenticatedUser(request) {
    // 0. User already resolved by the withAuth middleware (validated OIDC
    //    Bearer token). Functions wrapped in withAuth get this for free (#218).
    const stashed = getStashedIdentity(request);
    if (stashed && stashed.user) {
        return stashed.user;
    }

    const principal = parseClientPrincipal(request);

    // Priority: Principal fields -> x-edu-uid -> Anonymous fallback
    let userId = principal?.userId || principal?.oid;

    if (!userId) {
        userId = request?.headers?.get?.('x-edu-uid') || 'anonymous';
    }

    const sanitizedId = String(userId).replace(/[^a-zA-Z0-9]/g, '_');

    const email = principal ? resolvePrincipalEmail(principal, request) : null;
    const allowlistConfigured = isAllowlistConfigured();
    const allowlistRole = email ? resolveRoleForEmail(email) : null;
    const scope = email ? resolveScopeForEmail(email) : null;
    // Application user id (pilot data key) resolved from the allowlist entry
    // (Story 10.24); falls back to the verified email, then to the raw id.
    const appUserId = email ? resolveUserIdForEmail(email) : null;
    const mockPermitted = isMockAuthAllowed();

    // Fail closed: a configured allowlist with an unresolvable email yields a
    // non-functional role ('Denied'), never a principal-derived role. Mirrors
    // with-auth's enforceAllowlist so both enforcement points agree.
    let role = allowlistConfigured && !allowlistRole && (email || !mockPermitted)
        ? 'Denied'
        : (allowlistRole
            || principal?.userRoles?.find(r => ['Director', 'Docente', 'Alumno', 'Admin', 'Security'].includes(r))
            || 'Anonymous');

    return {
        userId,
        sanitizedId,
        id: appUserId || userId,
        principal,
        role,
        email: email || undefined,
        scope: scope || undefined,
    };
}

/**
 * Single per-user identity key end-to-end (#327/#329).
 *
 * Session-token principals (withAuth) carry NO `oid` — only `userId` — so any
 * caller keying storage rows by `principal?.oid` silently collapses every
 * session user onto the literal 'pilot-user' row (consent) or splits
 * read vs write rows (profiles). This helper prefers the session-resolved
 * identity (`context.user`, then the withAuth stash), falls back to the
 * allowlist/SWA/mock resolution, then `x-edu-uid`, and only lastly the
 * legacy 'pilot-user' dev fallback.
 *
 * @param {Request} request
 * @param {Object} [context] Azure Functions context (carries `.user` when withAuth ran)
 * @returns {string} Stable per-user storage key. Never null/undefined.
 */
export function resolveIdentityKey(request, context) {
    if (context?.user?.userId) return context.user.userId;
    const stashed = getStashedIdentity(request);
    if (stashed?.user?.userId) return stashed.user.userId;
    const authUser = getAuthenticatedUser(request);
    if (authUser?.userId && authUser.userId !== 'anonymous') return authUser.userId;
    return request?.headers?.get?.('x-edu-uid') || 'pilot-user';
}

/**
 * Checks whether a principal has at least one of the given roles.
 * @param {Object|null} principal The resolved principal object.
 * @param {string[]} roles Role names to test (e.g. ['Docente', 'Director']).
 * @returns {boolean}
 */
export function hasAnyRole(principal, roles) {
  if (!principal || !Array.isArray(roles) || roles.length === 0) return false;
  const userRoles = principal.userRoles || [];
  return roles.some((r) => userRoles.includes(r));
}

/**
 * True when the request carries a valid Bearer token header (used to decide
 * whether an invalid token must 401 instead of falling back to SWA/mock).
 * @param {Request} request
 * @returns {boolean}
 */
export function hasBearerToken(request) {
  const header = request?.headers?.get?.('authorization') || '';
  return /^Bearer\s+\S+$/i.test(header);
}

/**
 * Validates that the request was routed through the designated Azure Front Door instance.
 * @param {Request} request The incoming Azure Function request.
 * @returns {boolean} True if authorized.
 */
export function validateFrontDoorId(request) {
    const env = process.env.AZURE_FUNCTIONS_ENVIRONMENT || process.env.NODE_ENV;
    if (env === "Development") {
        return true;
    }
    const expectedId = process.env.FRONT_DOOR_ID;
    if (!expectedId || expectedId.includes('PLACEHOLDER') || expectedId.includes('@Microsoft.KeyVault')) {
        return true;
    }

    const incomingId = request.headers.get('x-azure-fdid');
    return incomingId === expectedId;
}
