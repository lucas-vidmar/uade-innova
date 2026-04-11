# Implementation Plan: US35 - Ingestion Status Tracking

Enable an end-to-end status transition experience (`processing` → `ready`/`error`) so docentes can see material ingestion progress update in the UI without manually refreshing.

## Requirements Analysis
- GitHub issue: **#35 — Ingestion Status Tracking**
- User story: *As a Docente, I want to see a "Processing" to "Ready" indicator.*
- Acceptance criteria:
  - Backend function updates material status.
  - Frontend polls/listens for status changes.
  - UI updates state without refresh.

## Edge Cases and Constraints
- Multiple selected classes per upload (`classIds[]`) must be updated coherently.
- Polling may resolve via `/material-status/{id}` or fallback `/classes`.
- Persisted tracked jobs in localStorage may include stale/invalid entries.
- Avoid duplicate listener registration across route re-renders.
- Keep compatibility with existing mock/fallback API behavior.

## Implementation Strategy
1. **Frontend status event propagation**
   - Extend `processing-notifications` service with a subscription API.
   - Emit terminal status events (`ready`/`error`) when polling resolves a tracked job.

2. **Teacher upload page live reconciliation**
   - Subscribe from `UploadMaterials` to processing status events.
   - Reconcile matching `classes[].materials[]` entries and re-render status badges.
   - Ensure cleanup/unsubscribe on route change to prevent leaks.

3. **Automated verification**
   - Add a Playwright Chrome usability test that uploads a file and verifies visual status badge transitions from **Procesando** to **Listo** on the same page without manual refresh.
   - Run backend unit tests and frontend e2e suite subset relevant to processing notifications.

## Files Planned
- `frontend/src/services/processing-notifications.js` (update)
- `frontend/src/pages/teacher/UploadMaterials.js` (update)
- `frontend/tests/processing-notifications.spec.js` (update/add scenario)

## Verification Commands
- `npm --prefix backend test`
- `npm --prefix frontend run test:e2e -- tests/processing-notifications.spec.js`
