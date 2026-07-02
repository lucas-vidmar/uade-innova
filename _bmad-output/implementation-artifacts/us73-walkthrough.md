# Walkthrough: User Story #73

**Feature/Story Name**: RAG Error Categorization  
**Status**: Completed  
**Business Impact**: Improves observability and support triage by exposing standardized machine-readable error categories for RAG failures.

## What Changed
- Added centralized taxonomy in `backend/src/services/error-categories.js`:
  - `ErrorCategory`: `RETRIEVAL_FAILURE`, `SAFETY`, `PARSING`, `LLM`.
  - `CategorizedError` with standardized properties (`errorCategory`, `code`, `status`, `details`).
  - `normalizeCategorizedError()` for resilient classification of legacy/untyped exceptions.
- Updated `backend/src/functions/rag-query.js` to return categorized error payloads:
  - Blocking mode now returns `{ error, errorCategory }` on failures.
  - Streaming mode (`SSE`) now emits `event: error` with `{ error, errorCategory }`.
- Updated backend services to emit typed categories at source:
  - `openai.js` → safety/content-filter exceptions map to `SAFETY`.
  - `vector-store.js` retrieval failures map to `RETRIEVAL_FAILURE`.
  - `parser.js` parsing/unsupported-file failures map to `PARSING`.
- Updated frontend error handling:
  - `frontend/src/services/api.js` now preserves backend `errorCategory` for stream startup failures.
  - `frontend/src/components/ChatWidget.js` surfaces category to the student in chat error feedback.
- Added automated tests:
  - Backend: `rag-query.test.js` safety-path test validates `errorCategory: "SAFETY"`.
  - Frontend Playwright (Chrome): `frontend/tests/rag-error-categorization.spec.js` validates visible SAFETY category in chat UX.

## Verification Results
- **Backend tests**: `npm test` (in `backend/`) ✅
- **Targeted backend tests**: `npm test -- src/functions/rag-query.test.js src/functions/rag-query-stream.test.js src/functions/material-status.test.js` ✅
- **Chrome usability test**: `npx playwright test tests/rag-error-categorization.spec.js` (in `frontend/`) ✅

## Backlog Refinement
- Add a non-blocking telemetry event (`RAGErrorCategorized`) to trend category frequencies over time (especially SAFETY vs RETRIEVAL_FAILURE).
- Add localized user-friendly error copy per category (instead of a raw enum) while preserving enum in payload for analytics.
- Extend categorization coverage to additional endpoints (`ingest-material`, `global-search`) for end-to-end consistency.
