# Implementation Plan: User Story #76

**Feature/Story Name**: RAG Pipeline TTFT Tracking  
**Status**: In Progress  
**Business Impact**: Operations and technical leads can monitor Time to First Token (TTFT) distributions in App Insights to identify slow first-token experiences and optimize perceived chat latency.

## Requirements & Constraints Analysis
- Story requires capturing a **timestamp at first SSE token** in the RAG streaming path.
- Existing telemetry already emits `RAGInteraction` with token and duration metrics, so TTFT should be added without breaking current dashboards.
- Must keep backend robust when stream has unusual chunk ordering (e.g., usage chunk before/without token deltas).
- No hardcoded secrets or infra drift; implementation must stay in application code/tests/docs only.

## Edge Cases Considered
- Stream emits metadata + usage but no content deltas (no first token observed).
- First content delta is empty/whitespace and should not count as meaningful first token.
- Failures before first token (LLM/retrieval errors) should not emit invalid TTFT values.
- Backward compatibility for existing KQL queries that only use `durationMs` and token metrics.

## Planned Milestones
- [ ] Extend RAG streaming handler to capture first-token timestamp and compute `ttftMs` from request start.
- [ ] Emit TTFT telemetry (`ttftMs` + first-token timestamp property) in `RAGInteraction` events for stream mode.
- [ ] Keep non-stream mode behavior unchanged.
- [ ] Add backend unit tests validating TTFT telemetry capture in streaming path.
- [ ] Add Chrome Playwright usability test validating student receives streamed response incrementally in chat UI.
- [ ] Execute backend and frontend test runs and record outcomes.
- [ ] Document implementation/verification in walkthrough artifact and refine backlog if needed.

## Out of Scope
- New App Insights Workbook visualizations for TTFT percentiles.
- Alert thresholds for TTFT SLA breaches.
- Client-side TTFT instrumentation beyond server-side SSE telemetry.
