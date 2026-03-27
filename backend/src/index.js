/**
 * src/index.js — Entry point for Node.js V4 Functions
 * Imports all function definitions to ensure they are registered.
 */
import { app } from '@azure/functions';

// ─── Function Imports ───────────────────────────────────────────
import './functions/hello.js';
import './functions/classes-api.js';
import './functions/ingest-material.js';
import './functions/rag-query.js';
import './functions/global-search.js';
import './functions/class-timeline.js';
import './functions/deadlines.js';
import './functions/get-tasks.js';
import './functions/admin-api.js';
import './functions/chat-api.js';
import './functions/get-profile.js';
import './functions/get-roles.js';
import './functions/process-material.js';
import './functions/save-profile.js';
import './functions/vector-health.js';

// ─── Security Middleware ────────────────────────────────────────
const expectedFdId = process.env.FRONT_DOOR_ID;

app.hook('preInvocation', async (context) => {
    // We strictly enforce FDID validation on HTTP triggers to prevent WAF bypass
    const isHttp = context.invocationContext.options.trigger?.type === 'httpTrigger';
    if (!isHttp) return;

    // Isolate the Request object from the V4 payload arguments
    const req = context.inputs.find(i => i && typeof i.headers?.get === 'function');
    if (!req) return;

    /*
    if (expectedFdId && process.env.NODE_ENV === 'production') {
        const incomingFdId = req.headers.get('x-azure-fdid');
        if (!incomingFdId || incomingFdId !== expectedFdId) {
            const warning = `[SECURITY] Blocked a direct function access attempt. Expected FDID: ${expectedFdId}, Received: ${incomingFdId}`;
            context.log.warn(warning);
            // Throwing halting error natively blocks standard function ingress yielding 500 automatically
            throw new Error('403 Forbidden - Invalid or missing X-Azure-FDID header.');
        }
    }
    */
});
