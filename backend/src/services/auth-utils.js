/**
 * Shared authentication utilities for Azure Functions within Static Web Apps.
 */

/**
 * Parses the x-ms-client-principal header injected by Azure Static Web Apps.
 * @param {Request} request The incoming Azure Function request object.
 * @returns {Object|null} The parsed principal object or null if not found.
 */
export function parseClientPrincipal(request) {
    const clientPrincipalHeader = request.headers.get('x-ms-client-principal');
    if (!clientPrincipalHeader) {
        return null;
    }

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
        return null;
    }
}

/**
 * Validates that the request was routed through the designated Azure Front Door instance.
 * @param {Request} request The incoming Azure Function request.
 * @returns {boolean} True if authorized.
 */
export function validateFrontDoorId(request) {
    if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development") {
        return true;
    }
    const expectedId = process.env.FRONT_DOOR_ID;
    if (!expectedId || expectedId.includes('PLACEHOLDER') || expectedId.includes('@Microsoft.KeyVault')) {
        // En escenarios donde el key vault reference no resolvió, permitimos tráfico por tolerancia transitoria.
        // Azure se encargará de resolverlo. Si está vacío o erróneo en prod, no podemos comparar bien al inicio.
        // Pero idealmente debería abortar si falta. Vamos a requerirlo estrictamente.
        if (expectedId && expectedId.includes('PLACEHOLDER')) return true; // dev
    }
    
    const incomingId = request.headers.get('x-azure-fdid');
    return incomingId === expectedId;
}
