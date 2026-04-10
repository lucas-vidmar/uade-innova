# Walkthrough: User Story #26

**Feature/Story Name**: SGA API Schema Mapping  
**Status**: Completed  
**Business Impact**: Establishes a contract-first integration layer for institutional academic data, reducing implementation risk and accelerating future connection to real SGA services.

## What Changed
- Added Swagger/OpenAPI artifact: `docs/sga-openapi.json`.
  - Defines SGA endpoints:
    - `GET /api/sga/tasks`
    - `GET /api/sga/early-alerts`
    - `GET /api/sga/attendance`
  - Includes schema definitions for `SgaTask`, `SgaEarlyAlert`, and `SgaAttendanceStats`.
- Added backend SGA endpoints in `backend/src/functions/sga-api.js` and registered them in `backend/src/index.js`.
  - Added request validation (`studentId`, `subjectId`) and role checks for attendance endpoint.
  - Kept existing Zero-Trust guardrail pattern (`validateFrontDoorId`) consistent.
- Updated frontend API client (`frontend/src/services/api.js`) to consume SGA endpoints instead of hardcoded in-method mocks when not in `USE_MOCK` mode.
- Added backend validation tests in `backend/src/functions/sga-api.test.js`.
  - Confirms OpenAPI artifact exists and contains required paths/schemas.
  - Validates mock payloads are schema-conformant.
  - Covers required parameter and authorization edge cases.
- Added Chrome/Chromium usability test: `frontend/tests/sga-tasks.spec.js`.
  - Verifies student can navigate to tasks view and consume SGA-backed data.

## Verification Results
- ✅ Backend unit suite: `npm test` (run in `backend/`) — passed.
- ✅ Chrome/Chromium usability test: `npx playwright test tests/sga-tasks.spec.js` (run in `frontend/`) — passed.
- ⚠️ Full existing frontend e2e suite (`npm run test:e2e`) reports pre-existing unrelated failures in legacy specs (`deadlines`, `director-powerbi-dashboard`, `global-search`, `transcript-timeline`).

## Acceptance Criteria Mapping
- **OpenAPI/Swagger schema generated**: Completed via `docs/sga-openapi.json`.
- **Validate mock data against schema**: Completed via `backend/src/functions/sga-api.test.js` schema-conformance assertions against endpoint payloads.

## Backlog Refinement
- Add OpenAPI security schemes (`bearer`/SWA identity context) and operation-level auth metadata to support integration governance.
- Add pagination/filtering contracts for `sga/tasks` (`status`, `from`, `to`) to support larger cohorts.
- Introduce a formal schema validation layer (e.g., AJV) in runtime for strict contract enforcement before external SGA cutover.
