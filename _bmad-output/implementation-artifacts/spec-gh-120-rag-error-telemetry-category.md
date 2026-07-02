---
title: 'RAG Error Telemetry by Category'
type: 'feature'
created: '2026-06-19'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** RAG failures (safety blocks, retrieval errors, parsing failures, LLM errors) are logged locally but not emitted as structured telemetry to App Insights, making it impossible to monitor error category trends over time.

**Approach:** Add a `trackRAGError` function to the telemetry service that emits a `RAGErrorCategorized` event with `errorCategory`, `code`, `subjectId`, and timestamp. Wire it into all four error paths in `rag-query.js` after the existing `normalizeCategorizedError` call, with explicit `client.flush()` to guarantee delivery on Consumption plan.

## Suggested Review Order

**Telemetry event contract**

- New `trackRAGError` function with flush-on-error for Consumption-plan delivery guarantee
  [`telemetry.js:288`](../backend/src/services/telemetry.js#L288)

**Integration into RAG error paths**

- Embedding failure — earliest error path, user-provided `classIds` not yet destructured
  [`rag-query.js:396`](../backend/src/functions/rag-query.js#L396)

- Pinecone retrieval failure — includes `classIds` for correlation
  [`rag-query.js:478`](../backend/src/functions/rag-query.js#L478)

- Streaming LLM error — fire-and-forget inside ReadableStream controller
  [`rag-query.js:700`](../backend/src/functions/rag-query.js#L700)

- Blocking LLM error — standard error path
  [`rag-query.js:736`](../backend/src/functions/rag-query.js#L736)
