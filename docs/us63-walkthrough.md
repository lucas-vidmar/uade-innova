# Walkthrough: User Story #63

## Summary
Implemented teacher-facing engagement/material alerts so docentes can see critical student or material issues directly in the analytics view.

## What Changed
- **Backend:** Added `GET /api/sga/teacher-alerts` in `backend/src/functions/sga-api.js`.
  - Validates Front Door header.
  - Requires `subjectId`.
  - Restricts access to `Docente`/`Director` roles (or Development mode).
  - Returns mixed alert types: `low_engagement` and `material_report`.

- **Frontend API:** Added `api.getTeacherAlerts(subjectId)` in `frontend/src/services/api.js`.
  - Includes payload normalization for robust rendering.
  - Handles API failures with safe empty-list fallback.

- **Teacher UI:** Updated `frontend/src/pages/teacher/Analytics.js`.
  - Fetches analytics + teacher alerts concurrently.
  - Renders new **“Alertas docentes (engagement/material)”** card.
  - Shows severity badges, indicators (attendance/grade or report count), and recommended action.
  - Handles empty-state gracefully.

## Verification
- **Backend unit tests**
  - Command: `npm test -- src/functions/sga-api.test.js` (backend)
  - Result: ✅ pass
  - Added coverage for:
    - missing `subjectId` returns `400`
    - unauthorized role returns `403`
    - authorized role returns valid mixed alert payload

- **Chrome usability E2E (Playwright)**
  - Test: `frontend/tests/teacher-alerts.spec.js`
  - Command: `npm run test:e2e -- tests/teacher-alerts.spec.js` (frontend)
  - Result: ✅ pass
  - Verifies teacher can navigate to analytics and see populated alert table with both alert categories.

## Acceptance Criteria Check
- Teacher receives alerts for low engagement/material reports. ✅
- Teacher alert view populates correctly. ✅

## Backlog Refinement Suggestions
1. **Alert acknowledgment workflow:** Add “acknowledge/dismiss” actions with audit trail for docentes.
2. **Priority routing:** Escalate high-severity alerts to Director after configurable SLA (e.g., 48h).
3. **Real signal integration:** Replace mock alert builder with derived signals from attendance, grades, and material feedback telemetry.
