# Walkthrough: User Story #94 — Per-notification quick actions and feedback

## Scope Delivered
- Added backend quick action endpoint: `PATCH /api/notifications/{id}/read`.
- Added per-user read persistence via `readByUserIds` in notification storage.
- Added student notification quick action in UI (`Marcar leída`) with immediate feedback.
- Added App Insights custom telemetry event: `NotificationInteraction`.
- Added unit test coverage for success and authorization edge cases.

## Files Updated
- `backend/src/functions/notifications.js`
- `backend/src/functions/notifications.test.js`
- `backend/src/services/notification-store.js`
- `backend/src/services/notification-store.test.js`
- `backend/src/services/telemetry.js`
- `frontend/src/components/Sidebar.js`
- `frontend/src/services/api.js`
- `frontend/src/styles/pages.css`
- `frontend/tests/notifications.spec.js`
- `docs/us94-implementation-plan.md`

## Verification Evidence

### 1) Backend automated tests (local)
Command:
```bash
npm test
```
Result:
- ✅ Pass (`104/104`) including updated notification tests.

### 2) Focused backend tests
Command:
```bash
node --experimental-test-module-mocks --test src/functions/notifications.test.js src/services/notification-store.test.js
```
Result:
- ✅ Pass (`8/8`) including:
  - mark-read success path
  - unauthorized student rejection
  - readByUserIds persistence

### 3) Frontend E2E test status
Command:
```bash
npm run test:e2e -- tests/notifications.spec.js
```
Result:
- ⚠️ Not executed in this environment (`playwright: command not found`).
- Test case was updated to validate quick action behavior and badge decrement.

## Security and Governance Notes
- No secrets hardcoded.
- Subject and recipient scoping enforced server-side before write.
- Error responses are actionable and sanitized (no stack traces).

## Telemetry Added
- Event name: `NotificationInteraction`
- Properties:
  - `action` (`mark_read`)
  - `status` (`success`/`error`)
  - `userId`
  - `subjectId`
  - `notificationId`

## Pending Cloud Validation (requires UADE environment access)
- `azd deploy` to dev/prod.
- Smoke test on live Static Web App URL.
- App Insights query check for `NotificationInteraction` events and absence of 5xx spikes.
