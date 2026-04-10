# Walkthrough: User Story #60 (Refinement)

**Feature/Story Name**: Material status endpoint for efficient processing notifications  
**Status**: Completed  
**Business Impact**: Reduced polling cost/latency by querying material status directly, while preserving global completion toasts after navigation.

## What Changed
- **Backend**
  - Added `GET /api/material-status/{materialId}?subjectId=...` in `backend/src/functions/classes-api.js`.
  - Added `getMaterialState(subjectId, materialId)` in `backend/src/services/state-store.js` for direct Table Storage lookup.
  - Added fallback to legacy processed blob JSON when table row is unavailable.
  - Added unit test file `backend/src/functions/material-status.test.js`.
- **Frontend**
  - Added `api.getMaterialStatus(subjectId, materialId)` in `frontend/src/services/api.js`.
  - Updated `frontend/src/services/processing-notifications.js` to use the new endpoint first and fallback to classes polling only when needed.
  - Updated Playwright test `frontend/tests/processing-notifications.spec.js` to validate material-status polling path and continued toast UX.

## Verification Results
- ✅ Backend tests passed:
  - `npm test -- src/functions/material-status.test.js src/functions/classes-api.test.js`
- ✅ Browser usability test passed (Chromium/Chrome engine):
  - `npm run test:e2e -- tests/processing-notifications.spec.js`
  - Validated flow: upload material → navigate away from upload page → global success toast appears.

## Backlog Refinement
- Add lightweight auth scoping checks to `material-status` so only authorized teachers/directors for the subject can query status.
- Add polling telemetry counters (success/fallback/error rate) to monitor reduction in `get-classes` load over time.
- Consider batch status endpoint (`POST /api/material-status/batch`) to resolve multiple material IDs in one request.
