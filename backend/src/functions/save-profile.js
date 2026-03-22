import { app } from '@azure/functions';
import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import { parseClientPrincipal } from '../services/auth-utils.js';

const tableName = "UserProfiles";
const storageAccountUrl = `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.table.core.windows.net`;

app.http('save-profile', {
    methods: ['POST', 'PUT'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const principal = parseClientPrincipal(request);

            if (!principal && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== "Development") {
                return { status: 401, body: "Unauthorized - missing identity" };
            }

            const userId = principal?.oid || "local-dev-user";

            const reqBody = await request.json();
            
            // Build the table entity payload
            const entity = {
                partitionKey: "Profiles",
                rowKey: userId,
                theme: reqBody.theme || "light",
                language: reqBody.language || "es",
                consentAccepted: reqBody.consentAccepted ?? false
            };

            const credential = new DefaultAzureCredential();
            const tableClient = new TableClient(storageAccountUrl, tableName, credential);

            // Upsert the data seamlessly handling initial creation or subsequent updates
            await tableClient.upsertEntity(entity, "Replace");

            return {
                status: 200,
                jsonBody: { message: "Profile saved successfully" }
            };

        } catch (error) {
            context.log.error('Error saving profile:', error);
            return {
                status: 500,
                body: "Internal Server Error"
            };
        }
    }
});
