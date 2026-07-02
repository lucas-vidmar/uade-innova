# Walkthrough: User Story #46

**Feature/Story Name**: Hybrid Source Retrieval  
**Status**: Completed  
**Business Impact**: Student answers now leverage mixed context from teacher notes and bibliography, with teacher notes weighted higher to preserve instructional intent and reduce generic-only grounding.

## What Changed
- Updated `backend/src/functions/rag-query.js` with a hybrid retrieval stage:
  - Increased candidate retrieval depth (`RETRIEVAL_CANDIDATES = 10`) before final context selection.
  - Added `MATERIAL_TYPE_WEIGHT` map with stronger boost for `notes` than `bibliography`.
  - Implemented weighted reranking and deterministic mixed-context selection (`buildHybridContext`) capped by existing `MAX_RAG_CHUNKS`.
  - Preserved existing metadata filter guardrails (`subjectId` + class scope logic).
- Added backend tests in `backend/src/functions/rag-query.test.js`:
  - Verifies retrieval asks for extended candidate set (10).
  - Verifies resulting system context includes both notes and bibliography and that notes appear first due to weighting.
- Added Chromium usability test `frontend/tests/hybrid-source-retrieval.spec.js`:
  - Simulates student chat interaction and SSE response.
  - Asserts UI renders both source chips (`notas-docente.docx`, `bibliografia-cap1.pdf`).

## Verification Results
- **Backend tests**: `npm test` (backend) — passed (63/63).
- **Frontend e2e (Chromium)**:
  - `npx playwright test tests/follow-up-chat.spec.js` — passed.
  - `npx playwright test tests/hybrid-source-retrieval.spec.js` — passed.

## Acceptance Criteria Mapping
- **Both source types retrieved**: Hybrid context selector ensures notes+bibliography are included whenever both exist in candidates.
- **Higher weight to Teacher notes**: Weighted reranking applies higher multiplier to `notes` versus `bibliography`, ordering teacher notes first when competing.
- **Context window contains mixed chunks**: Verified via unit test assertions on system prompt context composition and Chromium usability test source chips.

## Backlog Refinement
- Add telemetry dimension `sourceMix` (e.g., `notes+bibliography`, `notes-only`) to monitor hybrid retrieval quality over time.
- Add tunable weighting config per subject to let faculty calibrate note-vs-bibliography emphasis.
- Add guardrail for minimum semantic diversity to avoid repeated chunks from a single file in the same response.
