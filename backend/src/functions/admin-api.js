import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { getTableClient } from '../services/storage.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { CONFIG } from '../services/config.js';

const USER_PROFILES_TABLE = "UserProfiles";
const ENROLLMENTS_TABLE_NAME = CONFIG.tables.enrollments;

/**
 * Builds a map of userId → primary role by scanning the Enrollments table.
 * Teacher role takes precedence over student.
 */
async function buildUserRoleMap() {
    const roleMap = {};
    try {
        const enrollmentsClient = getTableClient(ENROLLMENTS_TABLE_NAME);
        await enrollmentsClient.createTable().catch(() => {});
        const entities = enrollmentsClient.listEntities();
        for await (const entity of entities) {
            const userId = entity.rowKey;
            const role = entity.role;
            if (!userId || !role) continue;
            // Teacher role takes precedence over student
            if (!roleMap[userId] || role === 'teacher') {
                roleMap[userId] = role;
            }
        }
    } catch (err) {
        console.error('[AdminAPI] Error building role map from Enrollments:', err.message);
    }
    return roleMap;
}

/**
 * Endpoint for institutional administrators (Directores) to list all users.
 * Restricted via userRoles/groups.
 */
app.http('manage-get-users', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'manage/users',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const principal = parseClientPrincipal(request);
            
            // Security Verification: Must be Director
            const isDirector = principal?.userRoles?.includes('Director');

            if (!isDirector) {
                return { status: 403, body: "Forbidden - Administrator access required" };
            }

            const [roleMap, tableClient] = await Promise.all([
                buildUserRoleMap(),
                (async () => {
                    const client = getTableClient(USER_PROFILES_TABLE);
                    await client.createTable().catch(() => {});
                    return client;
                })(),
            ]);

            const users = [];
            const entities = tableClient.listEntities();

            for await (const entity of entities) {
                users.push({
                    id: entity.rowKey,
                    name: entity.name || "Usuario Desconocido",
                    email: entity.email || "No disponible",
                    role: roleMap[entity.rowKey] || null,
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
    }))
});
