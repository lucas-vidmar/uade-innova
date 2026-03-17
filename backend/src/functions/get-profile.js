const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { DefaultAzureCredential } = require('@azure/identity');

const tableName = "UserProfiles";
const storageAccountUrl = `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.table.core.windows.net`;

app.http('get-profile', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            // In SWA production, Entra ID data comes securely in this header
            const clientPrincipalHeader = request.headers.get('x-ms-client-principal');

            if (!clientPrincipalHeader && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== "Development") {
                return { status: 401, body: "Unauthorized - missing identity" };
            }

            let userId = "local-dev-user"; // Fallback for local testing
            if (clientPrincipalHeader) {
                const encoded = Buffer.from(clientPrincipalHeader, 'base64').toString('utf-8');
                const principal = JSON.parse(encoded);
                
                // Find the OID (Object ID) from the claims to use as the unique RowKey
                const oidClaim = principal.claims.find(c => c.typ === "http://schemas.microsoft.com/identity/claims/objectidentifier");
                if (oidClaim) {
                    userId = oidClaim.val;
                } else {
                    userId = principal.userId;
                }
            }

            // Initialize Table SDK with Zero-Trust identity
            const credential = new DefaultAzureCredential();
            const tableClient = new TableClient(storageAccountUrl, tableName, credential);

            try {
                // Table Storage uses PartitionKey (broad category) and RowKey (unique ID)
                const entity = await tableClient.getEntity("Profiles", userId);
                return {
                    jsonBody: {
                        theme: entity.theme || "light",
                        language: entity.language || "es"
                    }
                };
            } catch (err) {
                if (err.statusCode === 404) {
                    // Profile doesn't exist yet, return defaults
                    return {
                        jsonBody: {
                            theme: "light",
                            language: "es"
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
