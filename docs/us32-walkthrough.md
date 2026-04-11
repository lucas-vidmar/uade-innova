# Walkthrough: User Story #32

**Feature/Story Name**: Vector Metadata Tagging (Azure AI Search)  
**Status**: Completed  
**Business Impact**: Vector chunks now persist explicit class-level metadata and ISO lecture dates, enabling reliable Azure AI Search filtering by academic scope.

## What Changed
- Updated ingestion pipeline in `backend/src/services/pipeline.js`:
  - Adds `classId` (primary selected class) to every vector chunk metadata.
  - Ensures `lectureDate` is emitted once per ingestion run as ISO 8601 and attached to every indexed chunk.
- Updated Azure AI Search adapter in `backend/src/services/vector-store.js`:
  - Index schema now includes filterable `classId` field.
  - Upsert mapping now persists `classId` with existing metadata (`subjectId`, `classIds`, `materialType`, `lectureDate`).
  - Retrieval `select`/metadata mapping now exposes `classId` for downstream consumers.
- Added backend test coverage:
  - `backend/src/services/pipeline.test.js` validates required metadata tagging and ISO lecture date format.
  - `backend/src/services/vector-store.telemetry.test.js` validates upsert mapping and index schema filterability for `classId` and `lectureDate`.
- Added Chromium usability test:
  - `frontend/tests/vector-metadata-tagging-upload.spec.js` navigates teacher upload UI and verifies multipart payload includes `subjectId`, `classIds`, and `materialType`.

## Verification Results
- **Backend targeted tests**:  
  `node --experimental-test-module-mocks --test src/services/pipeline.test.js src/services/vector-store.telemetry.test.js` — passed (7/7).
- **Frontend Chrome usability test**:  
  `npx playwright test tests/vector-metadata-tagging-upload.spec.js` — passed (1/1).

## Acceptance Criteria Mapping
- **Metadata is attached to each indexed chunk**: `subjectId`, `classId`, `materialType`, and existing metadata are attached in pipeline/upsert mapping.
- **`lectureDate` uses ISO 8601**: validated with strict ISO normalization assertion in `pipeline.test.js`.
- **Metadata fields are filterable in Azure AI Search**: `classId` and `lectureDate` are explicitly defined as filterable in index schema and validated in test.

## Backlog Refinement
- Add migration/reindex utility for historical vectors created before `classId` support.
- Extend retrieval filters to optionally prefer `classId` exact-match when single-class context is selected.
