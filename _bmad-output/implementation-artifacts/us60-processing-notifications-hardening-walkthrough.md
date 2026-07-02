# Walkthrough: User Story #60 (Polling Hardening)

## Summary
This refinement strengthens global processing notifications so completion toasts remain reliable even when persisted tracked jobs in local storage are malformed or duplicated.

## What Changed
- **Notification tracking normalization** (`frontend/src/services/processing-notifications.js`)
  - Added `normalizeTrackedJob` to validate required identifiers (`materialId`, `subjectId`), sanitize `filename`, and normalize class IDs.
  - Added `normalizeTrackedJobs` to clean invalid stored entries and deduplicate tracked jobs by `subjectId + materialId`.
  - Updated `init()` to normalize persisted jobs before polling.
  - Updated `trackJob()` to normalize payloads before enqueueing.

- **Browser test coverage (Chrome channel)** (`frontend/tests/processing-notifications.spec.js`)
  - Set test execution to use **Chrome** (`test.use({ channel: 'chrome' })`).
  - Added a new test that seeds one invalid + one valid persisted job, navigates to the dashboard, and verifies that the valid job resolves to a global success toast.

- **Planning artifact**
  - Added implementation plan: `docs/us60-processing-notifications-hardening-implementation-plan.md`.

## Verification Results
- ✅ `npm run test:e2e -- tests/processing-notifications.spec.js`
  - Passed existing flow test: upload → navigate away → completion toast.
  - Passed new hardening test: invalid persisted job ignored, valid persisted job toasted.

## Acceptance Criteria Mapping
- **Polling or WebSocket triggers toast globally**: Met via global polling service across route navigation.
- **Navigate away from upload; verify toast pops up**: Explicitly validated by Playwright test.

## Backlog Refinement
Potential follow-up story identified:
- **US (new): Expire stale processing jobs after TTL + retries**
  - As a teacher, I want stale uploads to stop polling after a safe timeout so I don’t see indefinite background checks and can receive a clear "timed out" notification with retry guidance.
