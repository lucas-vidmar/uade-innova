import { app } from '@azure/functions';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { trackUserLogin } from '../services/telemetry.js';

const tableName = "UserProfiles";

app.http('get-profile', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            // Use shared auth utility to parse identity
            const principal = parseClientPrincipal(request);

            const userId = principal?.oid || "pilot-user";

            // Emit UserLogin telemetry event for login-frequency analysis (Issue #69)
            if (principal) {
                trackUserLogin({
                    userId,
                    roles: principal.userRoles || [],
                }).catch(err => console.error('[Telemetry] Error emitting UserLogin event:', err));
            }

            const { getTableClient } = await import('../services/storage.js');
            const tableClient = getTableClient(tableName);

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
            context.error('Error fetching profile:', error);
            return {
                status: 500,
                body: "Internal Server Error"
            };
        }
    })
});
