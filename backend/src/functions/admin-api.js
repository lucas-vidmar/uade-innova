import { app } from '@azure/functions';
import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import { parseClientPrincipal } from '../services/auth-utils.js';

const tableName = "UserProfiles";
const storageAccountUrl = `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.table.core.windows.net`;

/**
 * Endpoint for institutional administrators (Directores) to list all users.
 * Restricted via userRoles/groups.
 */
app.http('admin-get-users', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'admin/users',
    handler: async (request, context) => {
        try {
            const principal = parseClientPrincipal(request);
            
            // Security Verification: Must be Director
            // Note: In SWA, we can also use staticWebApp.config.json for route protection,
            // but we double-check here for defense-in-depth.
            const isDirector = principal?.userRoles?.includes('Director') || process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";

            if (!isDirector) {
                return { status: 403, body: "Forbidden - Administrator access required" };
            }

            const credential = new DefaultAzureCredential();
            const tableClient = new TableClient(storageAccountUrl, tableName, credential);

            const users = [];
            const entities = tableClient.listEntities();

            for await (const entity of entities) {
                users.push({
                    id: entity.rowKey,
                    theme: entity.theme,
                    language: entity.language,
                    consentAccepted: entity.consentAccepted || false,
                    // Note: TableStorage doesn't store name/email by default in our current schema
                    // In a real sys, we might join with Entra ID Graph API
                    lastActive: entity.timestamp
                });
            }

            return {
                jsonBody: users
            };

        } catch (error) {
            context.log.error('Error fetching users for admin:', error);
            return {
                status: 500,
                body: "Internal Server Error"
            };
        }
    }
});
