# Implementation Plan: User Story #61

## Story
As a Student, I want the summary pushed automatically once the class ends.

## Acceptance Criteria
- Timer Trigger pushes notification.
- Test: wait until past class date and verify auto-notification is generated.

## Requirements & Constraints Analysis
- Existing student notification center already consumes `GET /api/notifications` and supports `summary` type events.
- Backend currently serves static mock notifications; there is no timer-triggered automation.
- The solution must avoid hardcoded secrets and align with serverless Azure Functions patterns.
- Must prevent duplicated auto-notifications across timer executions.
- Must preserve current behavior for existing notifications and non-student roles.

## Edge Cases
1. Class is in the future → no notification should be generated.
2. Class date is in the past but summary is not ready/validated → no notification.
3. Timer runs repeatedly for the same class → only one auto-notification should exist.
4. Missing `studentIds` in class config → notification should still be available (subject-level fallback).
5. Invalid class date → class is skipped safely without breaking the timer run.

## Technical Design
1. **Notification persistence service**
   - Add a dedicated storage service for notifications in Blob Storage container `notifications`.
   - Support list/save/upsert with deterministic IDs for deduplication.

2. **Timer-triggered dispatcher**
   - Add a new Azure Functions timer (`post-class-summary-dispatcher`).
   - On each run:
     - Discover subjects from `classes-config`.
     - Load classes for each subject.
     - Identify classes already ended.
     - Verify summary readiness (`summaryReady` in class config or validated summary payload in `class-summaries/{classId}.json`).
     - Upsert `summary` notification into subject notifications using deterministic ID `notif-auto-summary-{subjectId}-{classId}`.

3. **Notifications API integration**
   - Extend `GET /api/notifications` to merge persisted notifications with existing mock notifications.
   - Keep sorting by `createdAt`, enforce limit clamping, and add optional `userId` targeting filter.

4. **Registration**
   - Register the new timer function in backend startup (`backend/src/index.js`).

## Verification Plan
1. Backend unit tests:
   - Timer generates notification for ended class with validated/ready summary.
   - Timer skips future classes and avoids duplicates.
   - Notifications endpoint returns merged data and filters by `subjectId`, `userId`, and `limit`.
2. Frontend Chrome usability test:
   - Navigate student dashboard.
   - Verify auto-summary notification appears in bell dropdown.
   - Click notification and confirm navigation to target class.
3. Execute project tests:
   - `npm test` in `backend/`
   - `npx playwright test tests/auto-summary-notification.spec.js` in `frontend/`
