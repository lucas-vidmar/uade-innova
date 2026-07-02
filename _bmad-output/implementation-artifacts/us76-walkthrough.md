# Walkthrough: User Story #76

**Feature/Story Name**: RAG Pipeline TTFT Tracking  
**Status**: Completed  
**Business Impact**: Technical leads can now monitor first-token responsiveness in App Insights, improving optimization of perceived student chat latency.

## What Changed
- Updated streaming RAG execution in `backend/src/functions/rag-query.js`:
  - Captures first non-empty SSE delta emission timestamp (`firstTokenAt`).
  - Computes `ttftMs` as `first_token_time - request_start_time`.
  - Emits TTFT values in stream-mode telemetry while preserving existing behavior for non-stream mode.
- Extended telemetry contract in `backend/src/services/telemetry.js`:
  - Added `measurements.ttftMs` to `RAGInteraction` custom events.
  - Added `properties.firstTokenAt` to preserve first-token timestamp context.
- Added backend unit validation in `backend/src/functions/rag-query-stream.test.js`:
  - Verifies stream mode still emits SSE events.
  - Verifies telemetry payload includes numeric `ttftMs` and populated `firstTokenAt`.
- Added Chrome/Chromium usability test in `frontend/tests/ttft-streaming-usability.spec.js`:
  - Navigates to student dashboard chat.
  - Verifies streamed response is rendered incrementally in the UI.

## Verification Results
- **Backend tests**: `npm test` (backend) — **91 passed, 0 failed**.
- **Frontend Chrome usability test**: `npx playwright test tests/ttft-streaming-usability.spec.js` — **passed**.

## Acceptance Criteria Mapping
- **Timestamp captured on first SSE stream**: Implemented (`firstTokenAt`) when first non-empty `delta` chunk is emitted.
- **Query TTFT distribution in App Insights**: TTFT is now emitted as `customEvents` measurement `ttftMs` in `RAGInteraction`, enabling percentile/distribution KQL.

### Example KQL (TTFT Distribution)
```kql
customEvents
| where name == "RAGInteraction"
| where todouble(customMeasurements.ttftMs) > 0
| extend ttftMs = todouble(customMeasurements.ttftMs)
| summarize
    interactions = count(),
    avgTtftMs = avg(ttftMs),
    p50 = percentile(ttftMs, 50),
    p90 = percentile(ttftMs, 90),
    p95 = percentile(ttftMs, 95)
    by bin(timestamp, 1d)
| order by timestamp desc
```

## Backlog Refinement
- Add TTFT segmented dashboards by `subjectId` and prompt version to identify content-specific latency hot spots.
- Add TTFT anomaly alerts (e.g., p95 above SLA threshold) for proactive operations response.
- Extend telemetry with separate network queue time vs model-first-token time for deeper root-cause analysis.
