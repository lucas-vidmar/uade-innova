/**
 * Shared authentication utilities for Azure Functions within Static Web Apps.
 */

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

/**
 * Parses the x-ms-client-principal header injected by Azure Static Web Apps.
 * @param {Request} request The incoming Azure Function request object.
 * @returns {Object|null} The parsed principal object or null if not found.
 */
export function parseClientPrincipal(request) {
    // 1. Try to parse real SWA principal
    const clientPrincipalHeader = request?.headers?.get?.('x-ms-client-principal');
    if (clientPrincipalHeader) {
        try {
            const encoded = Buffer.from(clientPrincipalHeader, 'base64').toString('utf-8');
            const principal = JSON.parse(encoded);
            
            // Extract useful claims for easier access
            const claims = principal.claims || [];
            const groups = claims.filter(c => c.typ === 'groups').map(c => c.val);
            const oid = claims.find(c => c.typ === "http://schemas.microsoft.com/identity/claims/objectidentifier")?.val || principal.userId;
            
            return {
                ...principal,
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
    if (!isMockAuthAllowed()) {
        return null;
    }
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
        
        return {
            userId: mockUserId,
            userDetails: `Mock ${mappedRole}`,
            userRoles: ['authenticated', mappedRole],
            groups: [],
            oid: `mock-${mockRole}-oid`
        };
    }

    return null;
}

/**
 * Unifies user identification across functions, respecting both real SWA principals 
 * and the x-mock-role header for pilot/demo modes.
 * @param {Request} request 
 */
export function getAuthenticatedUser(request) {
    const principal = parseClientPrincipal(request);
    
    // Priority: Principal fields -> x-edu-uid -> Anonymous fallback
    let userId = principal?.userId || principal?.oid;
    
    if (!userId) {
        userId = request?.headers?.get?.('x-edu-uid') || 'anonymous';
    }
    
    const sanitizedId = String(userId).replace(/[^a-zA-Z0-9]/g, '_');
    
    return {
        userId,
        sanitizedId,
        principal,
        role: principal?.userRoles?.find(r => ['Director', 'Docente', 'Alumno', 'Admin', 'Security'].includes(r)) || 'Anonymous'
    };
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
