---
title: 'Issue #126 — RAG Retrieval Mix Telemetry'
type: 'feature'
created: '2026-06-19'
status: 'done'
baseline_commit: '2682b7a24072ae5265baac7d8b92fd23dce1cc24'
context:
  - 'backend/src/services/telemetry.js'
  - 'backend/src/functions/rag-query.js'
---

## Intent

**Problem:** RAG telemetry tracks token usage, latency, and class count, but has no visibility into which material types (notes, bibliography, transcript, presentation) are actually used per response — making it impossible to correlate answer quality with retrieval source diversity over time.

**Approach:** Compute a `sourceMix` string from the `materialType` values in the final sources array (after hybrid context building) and emit it as a custom dimension in the existing `RAGInteraction` App Insights event, for both streaming and blocking paths.

## Boundaries & Constraints

**Always:**
- `sourceMix` must be computed from the final 4 chunks after `buildHybridContext` — not from raw Pinecone candidates.
- Value must be computed by a pure `resolveSourceMix(sources)` function analogous to `resolveSelectedClassCount`.
- Must emit for both streaming and blocking paths at the existing `trackRAGInteraction` call sites.
- No frontend changes — telemetry is backend-only.
- No new App Insights event types — extend the existing `RAGInteraction` event.

**Ask First:**
- If the source mix classification categories (notes-only, bibliography-only, mixed-other etc.) need to be different from the ACs, I'll ask.

**Never:**
- Never persist sourceMix in chat logs or SessionMetrics table — App Insights only.
- Never add external dependencies or new npm packages.
- Never change the SSE `metadata` event format or the sources array structure.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Only notes chunks in final set | `sources = [{materialType:'notes'}, {materialType:'notes'}]` | sourceMix = `"notes-only"` | N/A |
| Notes + bibliography present | `sources = [{materialType:'notes'}, {materialType:'bibliography'}]` | sourceMix = `"notes+bibliography"` | N/A |
| Only transcript chunks | `sources = [{materialType:'transcript'}]` | sourceMix = `"transcript-only"` | N/A |
| Only presentation chunks | `sources = [{materialType:'presentation'}]` | sourceMix = `"presentation-only"` | N/A |
| Three or more types mixed | `sources = [{materialType:'notes'}, {materialType:'transcript'}, {materialType:'presentation'}]` | sourceMix = `"mixed-other"` | N/A |
| Empty sources (no matches / refusal) | `sources = []` | sourceMix = `"none"` | N/A |
| Null/undefined materialType in chunk | `sources = [{materialType: null}]` | sourceMix = `"unknown"` | N/A |

## Code Map

- `backend/src/functions/rag-query.js` — add `resolveSourceMix()` pure function; add `sourceMix` param to both `trackRAGInteraction` calls (streaming line ~550, blocking line ~642)
- `backend/src/services/telemetry.js` — add `sourceMix` parameter to `trackRAGInteraction()`; emit as custom dimension in `properties`

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/telemetry.js` — Add `sourceMix` param to `trackRAGInteraction()` function signature and emit as `properties.sourceMix` in the `trackEvent` call
- [x] `backend/src/functions/rag-query.js` — Add `resolveSourceMix(sources)` pure function that returns a classification string
- [x] `backend/src/functions/rag-query.js:550` — Add `sourceMix` to streaming path `trackRAGInteraction` call
- [x] `backend/src/functions/rag-query.js:642` — Add `sourceMix` to blocking path `trackRAGInteraction` call (compute from `matches` before telemetry call, since `sources` is assembled after it)

**Acceptance Criteria:**
- Given a streaming RAG query with notes+bibliography chunks, when telemetry is emitted, then the `RAGInteraction` event has `properties.sourceMix = "notes+bibliography"`
- Given a blocking RAG query with only transcript chunks, when telemetry is emitted, then the `RAGInteraction` event has `properties.sourceMix = "transcript-only"`
- Given a RAG query with no matches (refusal), when telemetry is emitted, then the `RAGInteraction` event has `properties.sourceMix = "none"`

## Verification

**Commands:**
- `npm run lint:backend` -- expected: no lint errors
- Run a manual RAG query via the API or frontend and check App Insights for the new `sourceMix` dimension

**Manual checks:**
- Verify `sourceMix` appears in App Insights `RAGInteraction` custom events with correct values for notes+bibliography, notes-only, bibliography-only, transcript-only, presentation-only, mixed-other, and none scenarios

## Suggested Review Order

**Core logic — source mix classification**

- Pure function that maps material types to a classification string; covers all 4 known types plus unknown/empty
  [`rag-query.js:218`](../../backend/src/functions/rag-query.js#L218)

**Telemetry wiring**

- Added `sourceMix` as optional property in `RAGInteraction` custom event with `'unknown'` fallback
  [`telemetry.js:61`](../../backend/src/services/telemetry.js#L61)

**Streaming path integration**

- Computes mix from the already-built `sources` array right before telemetry emission
  [`rag-query.js:585`](../../backend/src/functions/rag-query.js#L585)

**Blocking path integration**

- Derives mix from `matches` metadata since `sources` is assembled after the telemetry call
  [`rag-query.js:665`](../../backend/src/functions/rag-query.js#L665)
