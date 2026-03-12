import { app } from '@azure/functions';

app.http('hello', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        return { status: 200, body: 'Hello from Azure Functions!' };
    }
});
