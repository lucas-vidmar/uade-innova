/**
 * Shared authentication utilities for Azure Functions within Static Web Apps.
 */

/**
 * Parses the x-ms-client-principal header injected by Azure Static Web Apps.
 * @param {Request} request The incoming Azure Function request object.
 * @returns {Object|null} The parsed principal object or null if not found.
 */
export function parseClientPrincipal(request) {
    // 1. Try to parse real SWA principal
    const clientPrincipalHeader = request.headers.get('x-ms-client-principal');
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

    // 2. Fallback to mock role header for demo/mock mode
    const mockRole = request.headers.get('x-mock-role');
    const eduUid = request.headers.get('x-edu-uid');
    if (mockRole) {
        const roleMapping = {
            'director': 'Director',
            'teacher': 'Docente',
            'student': 'Alumno'
        };
        const mappedRole = roleMapping[mockRole] || 'Anonymous';
        const userIdMapping = {
            'director': 'dir-001',
            'teacher': 'doc-001',
            'student': 'alu-001'
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
        userId = request.headers.get('x-edu-uid') || 'anonymous';
    }
    
    const sanitizedId = String(userId).replace(/[^a-zA-Z0-9]/g, '_');
    
    return {
        userId,
        sanitizedId,
        principal,
        role: principal?.userRoles?.find(r => ['Director', 'Docente', 'Alumno'].includes(r)) || 'Anonymous'
    };
}

/**
 * Validates that the request was routed through the designated Azure Front Door instance.
 * @param {Request} request The incoming Azure Function request.
 * @returns {boolean} True if authorized.
 */
export function validateFrontDoorId(request) {
    // Para el piloto sin Front Door, permitimos todas las peticiones
    return true;
    /*
    if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development") {
        return true;
    }
    const expectedId = process.env.FRONT_DOOR_ID;
    if (!expectedId || expectedId.includes('PLACEHOLDER') || expectedId.includes('@Microsoft.KeyVault')) {
        if (expectedId && expectedId.includes('PLACEHOLDER')) return true; // dev
    }
    
    const incomingId = request.headers.get('x-azure-fdid');
    return incomingId === expectedId;
    */
}
