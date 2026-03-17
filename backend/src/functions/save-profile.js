const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { DefaultAzureCredential } = require('@azure/identity');

const tableName = "UserProfiles";
const storageAccountUrl = `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.table.core.windows.net`;

app.http('save-profile', {
    methods: ['POST', 'PUT'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const clientPrincipalHeader = request.headers.get('x-ms-client-principal');

            if (!clientPrincipalHeader && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== "Development") {
                return { status: 401, body: "Unauthorized - missing identity" };
            }

            let userId = "local-dev-user";
            if (clientPrincipalHeader) {
                const encoded = Buffer.from(clientPrincipalHeader, 'base64').toString('utf-8');
                const principal = JSON.parse(encoded);
                
                const oidClaim = principal.claims.find(c => c.typ === "http://schemas.microsoft.com/identity/claims/objectidentifier");
                if (oidClaim) {
                    userId = oidClaim.val;
                } else {
                    userId = principal.userId;
                }
            }

            const reqBody = await request.json();
            
            // Build the table entity payload
            const entity = {
                partitionKey: "Profiles",
                rowKey: userId,
                theme: reqBody.theme || "light",
                language: reqBody.language || "es"
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
