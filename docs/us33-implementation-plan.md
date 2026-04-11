# Implementation Plan: User Story #33

**Feature/Story Name**: Material Type Prioritization  
**Status**: In Progress  
**Business Impact**: Improves study clarity by explicitly distinguishing core class evidence from complementary bibliography in AI responses.

## Requirements & Constraints Analysis
- Story requires that `materialType` support a functional distinction between **primary** and **secondary** material.
- Bibliography must be differentiated from transcripts without breaking existing ingestion, retrieval, and UI flows.
- The change must preserve current compatibility with existing records that do not yet include a priority field.
- Validation must include automated backend tests and a Chrome usability test.

## Edge Cases Considered
- Legacy vectors without stored priority metadata.
- Mixed-source responses where both notes/transcripts and bibliography appear together.
- Search and chat displays where users need understandable labels for source relevance.
- Backward compatibility for ranking logic and global search filters.

## Planned Milestones
- [ ] Add centralized material-priority classification rules.
- [ ] Persist priority metadata in ingestion/indexing flow.
- [ ] Expose material priority in RAG and global search response payloads.
- [ ] Render primary/secondary badges in student-facing source chips and search results.
- [ ] Add/update backend unit tests for classification propagation.
- [ ] Add Chrome Playwright usability verification for user-visible prioritization.
- [ ] Update project status log and produce walkthrough artifact.

## Out of Scope
- New ranking policies by academic program.
- Professor-configurable priority overrides per material.
- Historic reprocessing migration for all previously indexed vectors.
