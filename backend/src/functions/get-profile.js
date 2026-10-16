import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { parseClientPrincipal, validateFrontDoorId, getAuthenticatedUser, resolveIdentityKey, hasResolvedIdentity } from '../services/auth-utils.js';
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
            // Use the session-resolved identity stashed by withAuth: role/email
            // come from the Users table and scope from Enrollments — never from
            // the client. Fail closed when no identity is resolved.
            const user = context.user || getAuthenticatedUser(request);
            if (!user || !user.role) {
                return { status: 401, body: JSON.stringify({ error: 'Se requiere autenticación para acceder a este recurso.', code: 'AUTH_REQUIRED', errorCategory: 'AUTH' }) };
            }
            const principal = user?.principal || parseClientPrincipal(request);

            const profileDefaults = {
                theme: "light",
                language: "es",
                consentAccepted: false,
                botTone: "formal",
                botLength: "detailed",
                includeSources: true
            };

            // Single per-user identity (#329): same key save-profile writes.
            const userId = resolveIdentityKey(request, context);

            // No identity resolved: there is no row to read. Answer the profile
            // contract with the defaults and the legacy 'student' role so a
            // principal whose role could not be classified is not locked out,
            // but never read (or expose) the shared 'pilot-user' row that
            // resolveIdentityKey falls back to (#434).
            if (!hasResolvedIdentity(user)) {
                return { jsonBody: { ...profileDefaults, role: 'student' } };
            }

            // Emit UserLogin telemetry event for login-frequency analysis (Issue #69)
            if (principal) {
                trackUserLogin({
                    userId,
                    roles: principal.userRoles || [],
                }).catch(err => console.error('[Telemetry] Error emitting UserLogin event:', err));
            }

            const { getTableClient } = await import('../services/storage.js');
            const tableClient = getTableClient(tableName);

            const VALID_TONES = ['formal', 'didactic', 'concise'];
            const VALID_LENGTHS = ['concise', 'detailed'];

            // Table Storage may return booleans as native booleans or as the
            // strings "true"/"false" depending on writer; normalize defensively.
            const asBool = (value, fallback) => {
                if (typeof value === 'boolean') return value;
                if (value === 'true') return true;
                if (value === 'false') return false;
                return fallback;
            };

            let profile;
            try {
                // Table Storage uses PartitionKey (broad category) and RowKey (unique ID)
                const entity = await tableClient.getEntity("Profiles", userId);
                profile = {
                    theme: entity.theme || "light",
                    language: entity.language || "es",
                    consentAccepted: asBool(entity.consentAccepted, false),
                    botTone: VALID_TONES.includes(entity.botTone) ? entity.botTone : "formal",
                    botLength: VALID_LENGTHS.includes(entity.botLength) ? entity.botLength : "detailed",
                    includeSources: asBool(entity.includeSources, true)
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
