# Walkthrough: User Story #33

**Feature/Story Name**: Material Type Prioritization  
**Status**: Completed  
**Business Impact**: Students now see whether a source is core class material or supporting bibliography, improving trust and interpretability of AI answers.

## What Changed
- Added a centralized classification rule in `backend/src/services/material-classification.js`:
  - `bibliography` is tagged as `secondary`.
  - all other material types are tagged as `primary`.
- Updated ingestion pipeline (`backend/src/services/pipeline.js`) to persist `materialPriority` per chunk metadata during vector indexing.
- Extended vector store mapping (`backend/src/services/vector-store.js`) so index schema, upsert payloads, and retrieval payloads include `materialPriority`.
- Updated RAG response behavior (`backend/src/functions/rag-query.js`):
  - ranking supports material-priority fallback (`bibliography` → `secondary`, others → `primary`) for legacy vectors,
  - returned `sources` now include `materialPriority`.
- Updated global search (`backend/src/functions/global-search.js`) to expose `materialPriority` in search results with legacy fallback.
- Added student-facing visual differentiation:
  - chat source chips now show **Primario/Secundario** badges (`frontend/src/components/ChatWidget.js`),
  - global search result cards include priority badges (`frontend/src/pages/student/Dashboard.js`, `frontend/src/styles/pages.css`).
- Added/updated automated tests:
  - backend unit coverage for pipeline metadata propagation, RAG source priority, global search payload, and vector-store schema mapping,
  - Chrome Playwright usability test for source-priority visibility (`frontend/tests/material-priority-usability.spec.js`).

## Verification Results
- **Backend tests**: `npm test` (backend) — passed (101/101).
- **Chrome usability test**: `npx playwright test tests/material-priority-usability.spec.js` — passed.

## Acceptance Criteria Mapping
- **`materialType` distinguishes primary/secondary**: Implemented via deterministic material-priority classification and propagated through indexing and API responses.
- **Verify PDF vs TXT tags**: Covered by classification logic and end-to-end UI verification where bibliography (PDF) is shown as secondary and class notes/transcript as primary.

## Backlog Refinement
- Add configurable teacher override to mark specific bibliography uploads as primary when used as mandatory class base material.
- Add an optional migration script to backfill `materialPriority` for already-indexed historical vectors.
