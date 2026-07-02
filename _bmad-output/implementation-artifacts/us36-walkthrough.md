# Walkthrough: User Story #36

**Feature/Story Name**: PPTX Structure Extraction  
**Status**: Completed  
**Business Impact**: The RAG ingestion pipeline now preserves slide boundaries more reliably, improving traceability from AI responses back to original slide structure.

## What Changed
- Updated PPTX extraction in `backend/src/services/parser.js`:
  - slide XML files are now ordered numerically (`slide1`, `slide2`, ..., `slide10`) instead of lexical ordering,
  - extracted text keeps explicit `[Diapositiva N]` tags per slide,
  - empty slides are still represented with their slide tag to preserve structure,
  - XML entities in text nodes are decoded for cleaner output.
- Added parser coverage in `backend/src/services/parser.test.js`:
  - verifies slide ordering and presence of slide tags,
  - verifies empty slide handling still emits structural markers.
- Added Chrome usability validation in `frontend/tests/pptx-structure-upload.spec.js`:
  - teacher uploads a `.pptx` from the Presentation tab,
  - UI confirms processing state and request includes `materialType=presentation`.

## Verification Results
- **Backend tests**: `npm test` (backend) — passed (105/105).
- **Chrome usability test**: `npx playwright test tests/pptx-structure-upload.spec.js` (frontend) — passed.

## Acceptance Criteria Mapping
- **Slide-level separation maintained in text**: Implemented with deterministic slide ordering and explicit `[Diapositiva N]` structural markers for every slide.
- **Verify tags in parsed PPTX output**: Implemented in automated parser tests asserting marker presence and sequence.

## Backlog Refinement
- Consider adding slide-title metadata extraction (when a title placeholder exists) to improve source citations in chat answers.
- Consider adding optional image OCR for text-only-on-image slides in a future enhancement.
