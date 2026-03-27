import { app } from '@azure/functions';
import { getIndexStats } from '../services/vector-store.js';
import { validateFrontDoorId } from '../services/auth-utils.js';

app.http('vector-health', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'vector-health',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        try {
            const stats = await getIndexStats();
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'azure-ai-search',
                    endpoint: process.env.AZURE_SEARCH_ENDPOINT || null,
                    indexName: process.env.AZURE_SEARCH_INDEX_NAME || null,
                    stats,
                    timestamp: new Date().toISOString(),
                }),
            };
        } catch (err) {
            context.error('[Vector Health] Error obteniendo estado del índice:', err);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'azure-ai-search',
                    error: err.message,
                }),
            };
        }
    },
});
