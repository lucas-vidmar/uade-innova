# Implementation Plan: User Story #63

## Story
**Title:** Teacher Engagement & Feedback Alerts  
**As a** Docente, **I want** to be notified of critical student/material issues.

## Acceptance Criteria Mapping
- Teacher receives alerts for low engagement/material reports.
- Verify Teacher alert view populates correctly.

## Requirements & Constraints Analysis
1. **Role-aware access:** Alerts endpoint must be restricted to Docente/Director (or Development mode), matching existing SGA endpoint security behavior.
2. **Subject isolation:** Alerts must be scoped by `subjectId` to avoid cross-subject leakage.
3. **UI integration point:** Teacher currently has analytics view; this is the best place to surface actionable alerts without creating a new route.
4. **Robust rendering:** UI must tolerate empty alerts, mixed alert types, and partial fields safely.
5. **Contract stability:** Frontend should normalize backend payload to avoid coupling to optional fields.

## Edge Cases Considered
- Missing `subjectId` query -> `400` validation error.
- Unauthorized caller -> `403`.
- Empty alert list for a subject -> neutral empty state in UI.
- Mixed alert types (`low_engagement`, `material_report`) with distinct indicators.
- Backend/API failure -> frontend fallback to empty list (non-blocking for analytics page).

## Implementation Steps
1. **Backend (`sga-api`)**
   - Add `GET /api/sga/teacher-alerts` endpoint.
   - Implement mock alert builder covering both alert categories.
   - Enforce Front Door validation + role authorization + required `subjectId`.

2. **Frontend API service**
   - Add `api.getTeacherAlerts(subjectId)` method.
   - Add normalization helper for consistent UI contract and safe defaults.

3. **Teacher Analytics UI**
   - Fetch analytics + alerts concurrently.
   - Render “Alertas docentes” card with table, severity badges, and per-type indicators.
   - Keep graceful empty state.

4. **Tests**
   - Backend unit tests for endpoint validation, authorization, and schema-like shape checks.
   - Playwright Chrome usability test asserting teacher alert card/table population and mixed alert-type rows.

5. **Verification**
   - Run backend unit tests.
   - Run frontend Playwright test for teacher alerts in Chrome.

## Out of Scope
- Persisting real alerts from production analytics pipeline.
- Notification push channels (email/Teams/push). This story is in-app view population.
