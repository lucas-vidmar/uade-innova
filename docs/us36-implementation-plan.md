# Implementation Plan: User Story #36

**Feature/Story Name**: PPTX Structure Extraction  
**Status**: Completed  
**Business Impact**: Preserves pedagogical context by keeping slide boundaries explicit, so RAG answers can trace content back to the correct slide segment.

## Requirements & Constraints Analysis
- Story requires **slide-level separation** to be preserved in extracted PPTX text.
- Existing parser currently extracts text from `<a:t>` nodes but can lose edge-case structure guarantees.
- Output must remain compatible with current chunking/indexing pipeline (`parseFile` → `chunkText` → embeddings).
- Verification must include backend automated tests and at least one Chrome browser usability test.

## Edge Cases Considered
- Slide file ordering issues (`slide10.xml` vs `slide2.xml`) causing lexical-sort mistakes.
- Slides with no extractable text still needing structural markers.
- XML entity decoding (`&amp;`, etc.) in extracted content.
- Empty/low-text decks where structural tags are the main signal.

## Planned Milestones
- [x] Harden PPTX parser sorting and structural tagging behavior.
- [x] Keep explicit `[Diapositiva N]` markers for every slide, including empty slides.
- [x] Add parser unit tests validating ordering and tag presence.
- [x] Add Chrome Playwright usability test in teacher upload flow for presentation upload behavior.
- [x] Run backend + frontend tests and document verification evidence.
- [x] Close story and publish walkthrough artifact.

## Out of Scope
- Visual slide thumbnail extraction.
- OCR for images embedded in slides.
- Historic reprocessing of already-ingested PPTX materials.
