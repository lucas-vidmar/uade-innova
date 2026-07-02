# Walkthrough: User Story #74

**Feature/Story Name**: End-to-End Distributed Tracing (Correlation-ID)  
**Status**: Completed  
**Business Impact**: Every request can now be traced from browser to backend to Azure OpenAI using a consistent `x-correlation-id`, speeding up diagnostics and reducing incident triage effort.

## What Changed
- Added backend correlation utility: `backend/src/services/correlation.js`.
  - Resolves/sanitizes inbound correlation IDs.
  - Generates fallback IDs when missing/invalid.
  - Standardizes dependency and response header propagation.
- Updated backend endpoints to include correlation behavior:
  - `backend/src/functions/rag-query.js`
  - `backend/src/functions/global-search.js`
  - `backend/src/functions/ingest-material.js`
  - `backend/src/functions/audio-api.js`
  - `backend/src/functions/process-material.js`
- Updated OpenAI service wrappers (`backend/src/services/openai.js`) to accept per-call outbound headers and pass `x-correlation-id` into Azure OpenAI SDK calls.
- Updated pipeline orchestration (`backend/src/services/pipeline.js`) to propagate correlation context during embeddings/summary/map generation.
- Updated frontend HTTP clients to inject `x-correlation-id` on outbound API calls:
  - `frontend/src/services/api.js`
  - `frontend/src/services/auth.js`

## Verification Results
- ✅ Backend tests passed (including new correlation coverage):
  - `npm test` (run in `backend/`)
- ✅ Browser usability test passed in Chrome/Chromium:
  - `npm run test:e2e -- tests/correlation-id.spec.js --project=chromium` (run in `frontend/`)
  - Validated request to `/api/global-search` includes `x-correlation-id` and feature remains usable.

## Backlog Refinement
- Add W3C `traceparent`/`tracestate` propagation alongside `x-correlation-id` to align with distributed tracing standards.
- Include correlation ID in custom telemetry events (`RAGInteraction`, `IngestionInteraction`) for easier KQL joins.
- Consider middleware-level correlation injection for all Azure Functions to avoid per-endpoint boilerplate.
