import { app } from '@azure/functions';
import { validateFrontDoorId } from '../services/auth-utils.js';
import { trackPollingEvent } from '../services/telemetry.js';

app.http('ingest-polling-telemetry', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'telemetry/polling',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return { status: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
        }

        let events;
        if (Array.isArray(body)) {
            events = body;
        } else if (body && Array.isArray(body.events)) {
            events = body.events;
        } else if (body && body.eventType) {
            events = [body];
        } else {
            return { status: 400, body: JSON.stringify({ error: 'No events provided' }) };
        }

        if (events.length === 0) {
            return { status: 400, body: JSON.stringify({ error: 'No events provided' }) };
        }

        const allowedTypes = new Set([
            'material_status_batch_success',
            'material_status_batch_get_success',
            'material_status_single_success',
            'classes_fallback',
            'per_item_fallback',
            'polling_error',
        ]);

        let tracked = 0;
        for (const event of events) {
            if (!event || !event.eventType) continue;
            if (!allowedTypes.has(event.eventType)) {
                context.log.warn(`[ingest-polling-telemetry] Unknown event type: ${event.eventType}`);
                continue;
            }

            trackPollingEvent({
                eventType: event.eventType,
                subjectId: event.subjectId,
                materialCount: event.materialCount,
                latencyMs: event.latencyMs,
                errorMessage: event.errorMessage,
                endpoint: event.endpoint || 'frontend',
            });
            tracked++;
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracked }),
        };
    },
});
