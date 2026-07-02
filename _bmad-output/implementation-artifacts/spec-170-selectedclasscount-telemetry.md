---
title: 'Track selectedClassCount in RAG Telemetry'
type: 'feature'
created: '2026-06-19'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** RAG telemetry lacks visibility into how many classes a user selects per query, making it impossible to correlate answer quality with context breadth.

**Approach:** Compute unique class count from the `classIds` request field and emit it as a measurement in the existing `RAGInteraction` App Insights custom event.

## Suggested Review Order

1. `src/functions/rag-query.js:213` — `resolveSelectedClassCount` pure function: check sentinel handling, dedup logic, and null safety
2. `src/functions/rag-query.js:548` — streaming path: verify `selectedClassCount` is passed to telemetry before the catch handler
3. `src/functions/rag-query.js:652` — blocking path: same check as above
4. `src/services/telemetry.js:95` — measurement emission: verify `Number.isFinite` guard and default to 0
5. `src/services/rag-filter.test.js:313` — telemetry tests: verify `selectedClassCount` assertions match `classIds` input
