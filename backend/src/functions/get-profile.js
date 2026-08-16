import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { parseClientPrincipal, validateFrontDoorId, getAuthenticatedUser } from '../services/auth-utils.js';
import { toFrontendRole } from '../services/allowlist.js';
import { trackUserLogin } from '../services/telemetry.js';
import { withCorrelation } from '../middleware/with-correlation.js';

const tableName = "UserProfiles";

app.http('get-profile', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            // Use the allowlist-resolved identity stashed by withAuth (Story 1.1a).
            // Role/email/scope come from the server-side allowlist, never from the client.
            const user = context.user || getAuthenticatedUser(request);
            const principal = user?.principal || parseClientPrincipal(request);

            const userId = user?.userId || principal?.oid || "pilot-user";

            // Emit UserLogin telemetry event for login-frequency analysis (Issue #69)
            if (principal) {
                trackUserLogin({
                    userId,
                    roles: principal.userRoles || [],
                }).catch(err => console.error('[Telemetry] Error emitting UserLogin event:', err));
            }

            const { getTableClient } = await import('../services/storage.js');
            const tableClient = getTableClient(tableName);

            const profileDefaults = {
                theme: "light",
                language: "es",
                consentAccepted: false
            };

            let profile;
            try {
                // Table Storage uses PartitionKey (broad category) and RowKey (unique ID)
                const entity = await tableClient.getEntity("Profiles", userId);
                profile = {
                    theme: entity.theme || "light",
                    language: entity.language || "es",
                    consentAccepted: entity.consentAccepted || false
                };
            } catch (err) {
                if (err.statusCode === 404) {
                    // Profile doesn't exist yet, return defaults
                    profile = profileDefaults;
                } else {
                    throw err;
                }
            }

            return {
                jsonBody: {
                    ...profile,
                    // Allowlist-resolved identity (Story 1.1a): the only role/scope
                    // the browser ever receives. Anonymous/undefined role falls back
                    // to 'student' so unconfigured/legacy principals are not locked
                    // out by a missing role claim.
                    role: user?.role && user.role !== 'Anonymous' ? (toFrontendRole(user.role) ?? 'student') : 'student',
                    email: user?.email || principal?.email || undefined,
                    scope: user?.scope || undefined,
                }
            };
        } catch (error) {
            context.error('Error fetching profile:', error);
            return {
                status: 500,
                body: "Internal Server Error"
            };
        }
    }))
});
