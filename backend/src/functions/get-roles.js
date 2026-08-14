import { validateFrontDoorId } from '../services/auth-utils.js';
import { withAuth } from '../middleware/with-auth.js';
import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';
import { CONFIG } from '../services/config.js';

app.http('get-roles', {
    methods: ['POST'],
    authLevel: 'anonymous', // SWA calls this internally, and the route must be accessible for its proxy
    handler: withCorrelation(withAuth(async (request, context) => {
        const receivedCode = request.query.get('code');
        const expectedCode = process.env.SWA_ROLES_SECRET;
        if (!expectedCode) {
            context.log.error('SWA_ROLES_SECRET is not configured');
            return { status: 500, body: JSON.stringify({ error: 'Server configuration error: SWA roles secret not set' }) };
        }
        if (receivedCode !== expectedCode) {
            context.log.warn('Unauthorized attempt to access get-roles endpoint.');
            return { status: 401, body: JSON.stringify({ error: 'Unauthorized - Invalid SWA Secret' }) };
        }
        try {
            // SWA passes the claims inside the body of the POST request
            const reqBody = await request.json();
            const claims = reqBody?.claims || [];

            // Extract the 'groups' claims from the token (handles both short and long claim types)
            const groupClaims = claims
                .filter(c => c.typ === 'groups' || c.typ === 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups')
                .map(c => c.val);

            // Extract user identity for logging
            const userEmail = claims.find(c => c.typ === 'preferred_username' || c.typ === 'email' || c.typ === 'name')?.val;
            context.log(`Mapping roles for user ${userEmail || 'unknown'}. Found ${groupClaims.length} group claims.`);

            // Our internal roles to map to the user
            const roles = [];

            // IMPORTANT: In a production environment, you would map the actual Entra ID Object IDs
            // of the "Alumnos-Pilot" and "Docentes-Pilot" groups respectively instead of generic strings. 
            // For now, based on the requirements, we'll map generic group names for the logic flow.

            // Case-insensitive check for group names
            const hasGroup = (name) => groupClaims.some(g => g.toLowerCase() === name.toLowerCase());

            if (hasGroup(CONFIG.entraGroups.alumnos)) {
                roles.push('Alumno');
            }

            if (hasGroup(CONFIG.entraGroups.docentes)) {
                roles.push('Docente');
            }
            
            if (hasGroup(CONFIG.entraGroups.directores)) {
                roles.push('Director');
            }

            // Emergency bypass for specific emails if defined in env
            const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
            if (userEmail && adminEmails.includes(userEmail.toLowerCase())) {
                context.log(`Emergency role 'Director' assigned via email match for ${userEmail}`);
                if (!roles.includes('Director')) roles.push('Director');
            }

            context.log(`Final roles assigned: ${roles.join(', ')}`);

            return {
                jsonBody: {
                    roles: roles
                }
            };
        } catch (error) {
            context.error('Error parsing roles request', error);
            return {
                status: 500,
                body: "Internal Server Error"
            };
        }
    }))
});
