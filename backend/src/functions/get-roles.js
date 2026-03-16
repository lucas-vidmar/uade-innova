const { app } = require('@azure/functions');

app.http('get-roles', {
    methods: ['POST'],
    authLevel: 'anonymous', // SWA calls this internally, and the route must be accessible for its proxy
    handler: async (request, context) => {
        try {
            // SWA passes the claims inside the body of the POST request
            const reqBody = await request.json();
            const claims = reqBody?.claims || [];

            // Extract the 'groups' claims from the token
            const groupClaims = claims.filter(c => c.typ === 'groups').map(c => c.val);

            // Our internal roles to map to the user
            const roles = [];

            // IMPORTANT: In a production environment, you would map the actual Entra ID Object IDs
            // of the "Alumnos-Pilot" and "Docentes-Pilot" groups respectively instead of generic strings. 
            // For now, based on the requirements, we'll map generic group names for the logic flow.

            if (groupClaims.includes('Alumnos-Pilot')) {
                roles.push('Alumno');
            }

            if (groupClaims.includes('Docentes-Pilot')) {
                roles.push('Docente');
            }

            // A user could theoretically be both, or none. If none, they just remain 'authenticated'.
            return {
                jsonBody: {
                    roles: roles
                }
            };
        } catch (error) {
            context.log.error('Error parsing roles request', error);
            return {
                status: 500,
                body: "Internal Server Error"
            };
        }
    }
});
