# Implementation Plan: User Story #65

## Story
As a Director, I want a dashboard of DAU and platform usage.

## Acceptance Criteria
- Aggregate data metrics rendered in Director role view.
- Verify individual student PII is hidden but aggregates show.

## Requirements Analysis
1. Keep Director dashboard focused on **adoption telemetry** (DAU and usage trends).
2. Avoid exposing student-identifying fields (e.g., `name`, `studentId`) in the Director UI.
3. Preserve existing telemetry capabilities already delivered for Power BI daily exports.

## Edge Cases and Constraints
- If telemetry table is empty, dashboard must still render with safe defaults.
- If role is not `Director`, endpoint must deny access in production.
- Aggregation should work even if raw alert records are sparse or partially missing attendance/grade fields.
- Frontend must avoid depending on raw per-student alerts for Director view.

## Implementation Plan
1. **Backend security and contract updates (`classes-api.js`)**
   - Enforce Director-only authorization on `GET /api/director/stats`.
   - Extend response payload with an anonymized `earlyAlertSummary` object (aggregate only).
   - Keep DAU and usage metrics sourced from `computeDirectorMetrics`.

2. **Director dashboard UI update (`frontend/src/pages/director/Dashboard.js`)**
   - Stop requesting `getEarlyAlerts()` for the Director dashboard.
   - Render aggregate-only risk widgets/table from `earlyAlertSummary`.
   - Ensure no student-level columns/values are shown.

3. **Automated testing**
   - Backend unit tests (`backend/src/functions/classes-api.test.js`):
     - Add authorization test for `get-director-stats`.
     - Add response-shape test to validate aggregate summary and absence of PII fields.
   - Frontend Playwright usability test in Chromium (`frontend/tests/director-powerbi-dashboard.spec.js`):
     - Navigate to Director dashboard.
     - Verify aggregate telemetry and anonymized alerts render.
     - Verify known student names are not present.

4. **Verification commands**
   - `npm test` in `backend/`
   - `npm run test:e2e -- director-powerbi-dashboard.spec.js --project=chromium` in `frontend/`

## Expected Outcome
Director dashboard continues to show DAU/platform usage while early-alert visibility is strictly aggregate/anonymized, satisfying telemetry and privacy requirements.
