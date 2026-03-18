# Feature: Subject-Filtered Retrieval (User Story #39)

**Status**: Completed
**Business Impact**: Ensures strict academic data isolation and consistent retrieval quality by preventing cross-subject contamination.

## Key Milestones
- [x] Fixed metadata mapping bug in `rag-query.js` (plural `classIds`).
- [x] Implemented mandatory top-level `subjectId` filter in Pinecone queries.
- [x] Added automatic bibliography inclusion in contextual RAG searches.
- [x] Verified subject isolation with 100% unit test coverage.

## Summary
The RAG engine now enforces a strict subject-level boundary. When a student interacts with the bot, the system automatically filters knowledge base results to match the active subject. Additionally, materials marked as "Bibliography" are now correctly included in the retrieval context even when specific class-level filters are applied, fulfilling the requirements for comprehensive academic assistance.
