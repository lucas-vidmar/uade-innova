# Implementation Plan: User Story #64 — Deadline Proximity Alerts

## Requirement Analysis
- **Story**: As a Student, I want notifications 48h and 24h before deadlines.
- **Acceptance Criteria**: An automated backend mechanism evaluates deadline proximity rules.
- **Explicit Test Requirement**: Validate **24h remaining** logic.

## Technical Constraints and Existing Architecture
- Backend uses Azure Functions (Node.js) with timer-driven automation already established (`post-class-summary-dispatcher`).
- Student notifications are persisted in blob-backed notification storage and surfaced by `GET /api/notifications`.
- Deadline data is stored by subject in `deadlines/{subjectId}.json`.
- Existing reminder endpoint (`/api/deadline-reminders`) is request-driven, not automated; the new story requires scheduled backend evaluation.

## Edge Cases to Cover
1. **Date-only deadlines** (`YYYY-MM-DD`) should parse deterministically in UTC.
2. **Timer cadence drift**: if dispatcher runs every N minutes, rule evaluation should use a time window (not exact millisecond equality).
3. **No duplicate alerts** across repeated timer runs for the same deadline and threshold.
4. **Missing deadline IDs**: generate deterministic IDs to keep notification dedup stable.
5. **Invalid/expired deadlines**: skip invalid dates and past due items.
6. **Subjects with no deadlines**: process safely without errors.

## Implementation Plan
1. **Add automated dispatcher function**
   - Create `backend/src/functions/deadline-proximity-dispatcher.js` with Azure Timer trigger.
   - Load all subject deadline blobs from container `deadlines`.
   - Evaluate 48h and 24h windows using UTC-safe parsing and configurable window (`DEADLINE_PROXIMITY_WINDOW_HOURS`, default `1`).
   - Generate deterministic notification IDs per `subject + deadline + threshold`.
   - Persist alerts through notification store only when not previously emitted.

2. **Integrate dispatcher into backend startup**
   - Import the new function in `backend/src/index.js`.

3. **Support deadline notification type across normalization/UI**
   - Extend notification type normalization (`deadline`) in backend and frontend APIs.
   - Update student notification center labels/icons so deadline alerts are clearly identifiable.

4. **Add automated tests**
   - Backend unit tests for dispatcher:
     - emits 24h reminder when exactly 24h remains,
     - emits 48h reminder,
     - avoids duplicate emission when existing notification already exists.
   - Keep acceptance-criteria-focused assertion explicitly covering 24h remaining logic.

5. **Add Chrome usability E2E test**
   - New Playwright (Chrome channel) spec to open student dashboard, open notification center, and verify a deadline proximity alert is visible and actionable.

6. **Documentation artifacts**
   - Add walkthrough document for Story #64 with verification results and acceptance-criteria mapping.
   - Update `docs/project-status.md` with completed milestone entry.

7. **Finalize workflow**
   - Run backend and frontend verification commands.
   - Commit with conventional message including issue suffix `#64`.
   - Close GitHub user story issue after successful implementation.
