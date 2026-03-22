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
