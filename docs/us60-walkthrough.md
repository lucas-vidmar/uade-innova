# Walkthrough: User Story #60

**Feature/Story Name**: Real-time Processing Notifications  
**Status**: Completed  
**Business Impact**: Teachers now receive reliable global feedback when AI processing jobs finish, even if they are no longer on the upload screen.

## What Changed
- Added `frontend/src/services/processing-notifications.js`:
  - Tracks in-flight materials (`materialId`, `subjectId`, `classIds`, `filename`) in `localStorage`.
  - Polls `GET /api/classes?subjectId=...` on an interval and resolves terminal states (`ready` / `error`).
  - Shows global success/error toasts and removes completed jobs from the queue.
- Initialized notification service at app bootstrap (`frontend/src/main.js`) so it remains route-agnostic.
- Updated teacher upload flow (`frontend/src/pages/teacher/UploadMaterials.js`):
  - Keeps backend status (`processing`) instead of forcing immediate `ready`.
  - Registers new in-flight jobs in the global notification service.
- Added E2E Playwright test `frontend/tests/processing-notifications.spec.js`:
  - Upload file on teacher upload page.
  - Navigate away to another page.
  - Verify global toast appears when mocked status transitions from `processing` to `ready`.

## Verification Results
- **Backend tests (`npm test`)**: Partially passing; unrelated pre-existing failure in `src/functions/analytics.test.js` due to missing dev dependency `@jest/globals`.
- **Frontend E2E (`npm run test:e2e`)**:
  - New test **passed**: `processing-notifications.spec.js`.
  - Existing unrelated tests failed due to pre-existing suite instability/assertion drift (`deadlines.spec.js`, `global-search.spec.js`, `transcript-timeline.spec.js`).

## Backlog Refinement
- Add dedicated endpoint for material status by `materialId` to avoid scanning all classes during polling.
- Add optional server-sent events/WebSocket channel for push notifications to reduce polling overhead.
- Define UX rule for duplicate toasts when the same `materialId` belongs to multiple classes in multi-class uploads.
