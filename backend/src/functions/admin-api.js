import { app } from '@azure/functions';
import { getTableClient } from '../services/storage.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';

const tableName = "UserProfiles";

/**
 * Endpoint for institutional administrators (Directores) to list all users.
 * Restricted via userRoles/groups.
 */
app.http('manage-get-users', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'manage/users',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const principal = parseClientPrincipal(request);
            
            // Security Verification: Must be Director
            const isDirector = principal?.userRoles?.includes('Director') || process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";

            if (!isDirector) {
                return { status: 403, body: "Forbidden - Administrator access required" };
            }

            const tableClient = getTableClient(tableName);
            
            // Ensure table exists in local dev or if not yet created in cloud
            await tableClient.createTable().catch(() => {}); 

            const users = [];
            const entities = tableClient.listEntities();

            for await (const entity of entities) {
                users.push({
                    id: entity.rowKey,
                    name: entity.name || "Usuario Desconocido",
                    email: entity.email || "No disponible",
                    theme: entity.theme,
                    language: entity.language,
                    consentAccepted: entity.consentAccepted || false,
                    lastActive: entity.timestamp
                });
            }

            return {
                jsonBody: users
            };

        } catch (error) {
            context.error('Error fetching users for admin:', error);
            return {
                status: 500,
                body: "Internal Server Error"
            };
        }
    }
});
