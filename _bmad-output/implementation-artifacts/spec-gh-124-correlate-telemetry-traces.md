---
title: 'Correlate custom telemetry events with request traces'
type: 'feature'
created: '2026-06-19'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** `RAGInteraction` and `IngestionInteraction` custom events lack correlation/trace identifiers, making it impossible to join request traces with custom telemetry in KQL for end-to-end diagnostics.

**Approach:** Introduce an optional `correlationId` parameter on both `trackRAGInteraction` and `trackIngestionInteraction`, propagate it from the caller functions where it is already resolved (`correlationId` from `resolveCorrelationId()` in HTTP handlers, passed via blob metadata in async pipelines), and emit it as a custom dimension in the App Insights event properties.

## Suggested Review Order

1. **Telemetry function signatures — new `correlationId` param accepted and conditionally emitted**
   [`telemetry.js:63`](../../backend/src/services/telemetry.js#L63) — `trackRAGInteraction` now accepts optional `correlationId`, emitted as `properties.correlationId` only when provided
   [`telemetry.js:160`](../../backend/src/services/telemetry.js#L160) — `trackIngestionInteraction` same pattern

2. **RAG query — correlationId propagated to both streaming and blocking telemetry calls**
   [`rag-query.js:646`](../../backend/src/functions/rag-query.js#L646) — streaming path passes already-resolved `correlationId` to `trackRAGInteraction`
   [`rag-query.js:740`](../../backend/src/functions/rag-query.js#L740) — blocking path same propagation

3. **Ingestion pipeline — correlationId from blob metadata propagated to success and error telemetry**
   [`pipeline.js:238`](../../backend/src/services/pipeline.js#L238) — success path passes `correlationId` to `trackIngestionInteraction`
   [`pipeline.js:267`](../../backend/src/services/pipeline.js#L267) — error path same propagation

4. **KQL examples — joins using native `operation_Id` and custom `correlationId`**
   [`docs/kql-correlation-queries.md`](../../docs/kql-correlation-queries.md) — reference for joining telemetry events with request traces
