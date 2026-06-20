import { validateFrontDoorId } from '../services/auth-utils.js';
import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';

app.http('hello', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        return { status: 200, body: 'Hello from Azure Functions!' };
    })
});
