# Correlation Middleware

All HTTP Azure Functions should use the `withCorrelation` middleware to automatically handle correlation ID resolution, W3C trace context, and response header injection.

## Usage

```js
import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';

app.http('my-function', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'my-route',
    handler: withCorrelation(async (request, context) => {
        // context.correlationId  — resolved from x-correlation-id header or auto-generated
        // context.traceContext   — { traceparent, tracestate, traceId, spanId }
        // context.dependencyHeaders — { x-correlation-id, traceparent } for downstream calls

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correlationId: context.correlationId }),
        };
    }),
});
```

## What it does

1. **Resolves correlation ID** from the inbound `x-correlation-id` request header (generates a UUID if absent)
2. **Parses W3C trace context** from `traceparent`/`tracestate` headers (generates fresh ones if absent)
3. **Builds dependency headers** with a child trace span for downstream HTTP calls (OpenAI, Pinecone, etc.)
4. **Attaches all three** to the Azure Functions `context` object for use inside the handler
5. **Injects correlation response headers** (`x-correlation-id`, `traceparent`) into every response returned by the handler

## Context properties

| Property | Type | Description |
|---|---|---|
| `context.correlationId` | `string` | UUID — either from inbound header or auto-generated |
| `context.traceContext` | `object` | `{ traceparent, tracestate, traceId, spanId }` |
| `context.dependencyHeaders` | `object` | Headers to forward on downstream HTTP calls |

## Example — propagating to downstream services

```js
handler: withCorrelation(async (request, context) => {
    const { dependencyHeaders } = context;
    const { embedding } = await generateEmbedding(query, { headers: dependencyHeaders });
    // ...
})
```

## Note

The middleware does **not** catch errors. If the handler throws, the error propagates to the Azure Functions runtime as normal. The middleware only modifies successful return values.
