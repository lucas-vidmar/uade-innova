# Implementation Plan: User Story #73

**Story**: RAG Error Categorization  
**Issue**: #73  
**Objective**: Distinguish backend failures using standardized `ErrorCategory` values: `RETRIEVAL_FAILURE`, `SAFETY`, `PARSING`, `LLM`.

## Requirements Analysis
- Add standardized error category metadata to RAG-related exceptions.
- Ensure API responses expose machine-readable category for observability and UX handling.
- Validate at least one **Safety** exception path with automated tests.
- Maintain existing behavior for successful RAG flows.

## Technical Constraints & Edge Cases
- Safety exceptions can come from different providers/shapes (`content_filter`, policy rejection message, status code + body combinations).
- Legacy thrown errors may arrive as plain `Error` instances without metadata.
- Streaming mode (`SSE`) requires category propagation inside `event: error` payloads.
- Frontend currently discards backend error metadata; category must be preserved for UI handling.

## Design
1. Introduce centralized error taxonomy helper (`error-categories.js`) with:
   - Enum-like `ErrorCategory` constants.
   - `CategorizedError` class (standard properties: `errorCategory`, `code`, `status`, `details`).
   - Normalization helper that classifies unknown errors into required categories.
2. Update backend RAG function (`rag-query.js`) to:
   - Normalize all catch blocks and return `{ error, errorCategory }`.
   - Emit categorized errors in stream mode SSE `error` events.
3. Update service-level exceptions (`parser.js`, `vector-store.js`, `openai.js`) to throw categorized errors where applicable.
4. Update frontend API/Chat widget to preserve and render category on failures.
5. Add tests:
   - Backend unit test for Safety exception classification.
   - Frontend Chrome Playwright usability test validating category visibility to users.

## Verification Plan
- Backend: `npm test` (from `backend/`).
- Frontend e2e (Chrome): `npx playwright test tests/rag-error-categorization.spec.js` (from `frontend/`).
- Confirm issue acceptance criterion: trigger safety exception and verify `errorCategory === "SAFETY"`.

## Risks & Mitigations
- **Risk**: Over-classification by brittle message matching.  
  **Mitigation**: prioritize explicit provider signals (`code`, `finish_reason`) before fallback text heuristics.
- **Risk**: UI regressions in chat error rendering.  
  **Mitigation**: add dedicated Playwright check for chat failure path.
