# Implementation Plan: User Story #46

**Feature/Story Name**: Hybrid Source Retrieval (Teacher Notes + Bibliographies)  
**Status**: In Progress  
**Business Impact**: Improves answer grounding quality by ensuring RAG context combines both teacher-authored notes and bibliography evidence, while prioritizing teacher notes to align with course intent.

## Requirements & Constraints Analysis
- Story asks retrieval from both **Teacher Notes** (`notes`) and **Bibliographies** (`bibliography`).
- Acceptance criterion requires **higher weight to teacher notes**.
- Existing RAG path currently filters by `subjectId` and includes bibliography through `$or`, but ranking is purely vector score and does not enforce mixed context or weighting.
- Must preserve metadata filtering boundaries (`subjectId`, selected classes) to avoid cross-subject leakage.

## Edge Cases Considered
- Retrieval returns only one source type (e.g., only bibliography): response should still work without errors.
- Candidate chunks may not include stable `id` in mocked/testing scenarios.
- High-score transcript chunks could overshadow notes if weighting not applied.
- Transcript focus narrowing should still work before final hybrid ranking selection.

## Planned Milestones
- [ ] Expand retrieval candidate pool so weighted reranking has enough diversity.
- [ ] Implement weighted ranking by `materialType` with explicit boost for teacher notes.
- [ ] Guarantee mixed context composition when both notes and bibliography candidates are present.
- [ ] Keep final context bounded to existing chunk budget (`MAX_RAG_CHUNKS`).
- [ ] Add backend unit tests for weighted retrieval behavior and mixed-source context.
- [ ] Add Playwright Chromium usability test validating both source chips are visible in chat.
- [ ] Execute backend + frontend tests and document outcomes.

## Out of Scope
- Changing ingestion metadata schema.
- UI redesign of source chips.
- Introducing configurable weighting in admin panel (future enhancement).
