import { app } from '@azure/functions';
import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import { parseClientPrincipal } from '../services/auth-utils.js';

const tableName = "UserProfiles";
const storageAccountUrl = `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.table.core.windows.net`;

app.http('get-profile', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // Use shared auth utility to parse identity
            const principal = parseClientPrincipal(request);

            if (!principal && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== "Development") {
                return { status: 401, body: "Unauthorized - missing identity" };
            }

            const userId = principal?.oid || "local-dev-user";

            // Initialize Table SDK with Zero-Trust identity
            const credential = new DefaultAzureCredential();
            const tableClient = new TableClient(storageAccountUrl, tableName, credential);

            try {
                // Table Storage uses PartitionKey (broad category) and RowKey (unique ID)
                const entity = await tableClient.getEntity("Profiles", userId);
                return {
                    jsonBody: {
                        theme: entity.theme || "light",
                        language: entity.language || "es",
                        consentAccepted: entity.consentAccepted || false
                    }
                };
            } catch (err) {
                if (err.statusCode === 404) {
                    // Profile doesn't exist yet, return defaults
                    return {
                        jsonBody: {
                            theme: "light",
                            language: "es",
                            consentAccepted: false
                        }
                    };
                }
                throw err;
            }

        } catch (error) {
            context.log.error('Error fetching profile:', error);
            return {
                status: 500,
                body: "Internal Server Error"
            };
        }
    }
});
