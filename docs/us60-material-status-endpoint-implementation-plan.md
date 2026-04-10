# Implementation Plan: User Story #60 (Refinement)

**Feature/Story Name**: Material status endpoint for efficient processing notifications  
**Status**: Completed  
**Business Impact**: Reduces notification polling overhead by querying status directly by `materialId` instead of scanning all classes.

## Requirements Analysis
- Keep global toast behavior for processing completion/error.
- Optimize polling path with a dedicated backend endpoint keyed by `materialId` + `subjectId`.
- Preserve backwards-compatible UX when endpoint is unavailable or data is temporarily missing.

## Edge Cases & Technical Constraints
- Material may still be `processing` for multiple polls.
- Material may reach `ready` or `error` terminal state.
- Material may not be found yet due to eventual consistency between ingestion and state persistence.
- Frontend upload page still needs class data; optimization targets notification polling only.
- Avoid breaking local/dev fallback behavior.

## Planned Changes
- Add backend API endpoint: `GET /api/material-status/{materialId}?subjectId=...`.
- Add state-store helper to fetch one material by partition/row key efficiently.
- Add frontend API method `api.getMaterialStatus(subjectId, materialId)`.
- Update processing notification service to poll material status endpoint first, with fallback to current classes-based strategy on errors.
- Extend tests:
  - Backend unit test for material-status endpoint contract.
  - Playwright browser test (Chromium) to verify upload → navigate away → toast, while polling uses material-status path.

## Verification Plan
- Run backend tests for modified function suite.
- Run frontend Playwright test for processing notifications.
- Confirm success toast appears after navigation and endpoint is polled.

## Verification Results
- ✅ Backend tests passed: `npm test -- src/functions/material-status.test.js src/functions/classes-api.test.js`
- ✅ Frontend browser test passed (Chromium/Chrome engine): `npm run test:e2e -- tests/processing-notifications.spec.js`
- ✅ Toast behavior remained intact after route navigation while polling status by `materialId`.
