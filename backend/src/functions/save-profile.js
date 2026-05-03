import { app } from '@azure/functions';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';

const tableName = "UserProfiles";
const storageAccountUrl = `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.table.core.windows.net`;

app.http('save-profile', {
    methods: ['POST', 'PUT'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const principal = parseClientPrincipal(request);

            const userId = principal?.oid || "pilot-user";

            const reqBody = await request.json();
            
            // Build the table entity payload
            const entity = {
                partitionKey: "Profiles",
                rowKey: userId,
                name: principal?.userDetails || "Local User",
                email: principal?.userDetails || "local@uade.edu.ar",
                theme: reqBody.theme || "light",
                language: reqBody.language || "es",
                consentAccepted: reqBody.consentAccepted ?? false
            };

            const { getTableClient } = await import('../services/storage.js');
            const tableClient = getTableClient(tableName);

            // Upsert the data seamlessly handling initial creation or subsequent updates
            await tableClient.upsertEntity(entity, "Replace");

            return {
                status: 200,
                jsonBody: { message: "Profile saved successfully" }
            };

        } catch (error) {
            context.error('Error saving profile:', error);
            return {
                status: 500,
                body: "Internal Server Error"
            };
        }
    }
});
