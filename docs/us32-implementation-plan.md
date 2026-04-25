# Implementation Plan: User Story #32

**Feature/Story Name**: Vector Metadata Tagging (Pinecone)  
**Status**: In Progress  
**Business Impact**: Vector documents carry consistent academic metadata (`subjectId`, `classId`, `materialType`, `lectureDate`) so retrieval can be precisely filtered by course and class scope.

## Requirements & Constraints Analysis
- Each indexed chunk must include metadata fields required by the story: `subjectId`, `classId`, and `materialType`.
- `lectureDate` must be persisted in **ISO 8601** format.
- Metadata fields must be **filterable** at Pinecone namespace/metadata level.
- Existing multi-class ingestion behavior (`classIds`) must remain backward-compatible with current RAG filtering.

## Edge Cases Considered
- Multi-class uploads: preserve `classIds` while also setting a deterministic `classId` (primary class) to support single-class filters.
- Legacy indices: ensure index definition includes new filterable field without breaking existing query paths.
- Missing/invalid lecture date: pipeline should always emit `new Date(...).toISOString()` to guarantee ISO format.
- Query compatibility: vector retrieval should continue supporting `classIds` filters while exposing `classId` in selected/result metadata.

## Planned Milestones
- [ ] Extend vector metadata payload generation in pipeline with `classId` and ISO `lectureDate`.
- [ ] Update Pinecone metadata schema to include filterable `classId`.
- [ ] Persist and return `classId` in vector upsert/query adapters.
- [ ] Add unit tests validating metadata mapping, ISO date format, and filterable schema presence.
- [ ] Add a Chromium Playwright usability test covering teacher upload flow metadata submission.
- [ ] Run backend tests and targeted frontend Playwright test.
- [ ] Close issue #32 and produce walkthrough artifact.

## Out of Scope
- Re-indexing historical documents already stored in production.
- Changes to ranking logic or prompt orchestration in RAG response generation.
