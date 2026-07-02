---
title: 'AI Feedback Alerts Lifecycle Management'
type: 'feature'
created: '2026-06-19'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** Teachers can see AI quality alerts on the dashboard and correction inbox but have no way to mark them as reviewed or resolved directly from these views. Alert status does not persist, and open/reviewed/resolved items are not prioritized.

**Approach:** Add a `PATCH /api/corrections-status` endpoint for status transitions (`pending → reviewed → resolved`), extend the existing corrections list to support status filtering and priority sorting (pending first), and add inline action buttons (Mark as Reviewed, Mark as Resolved) on both the teacher Dashboard and CorrectionInbox pages with loading states and TOCTOU race guards.

## Suggested Review Order

1. `backend/src/services/state-store.js` — `updateCorrectionStatus()` + `listCorrections()` helpers with `CorrectionsPending` table sync
2. `backend/src/functions/corrections/update-status/index.js` — New `PATCH /api/corrections-status` with status validation, enrollment check, race re-read guard
3. `backend/src/functions/corrections/get-pending-reports/index.js` — Extended with `status` query param, invalid status → 400, sorting by status priority
4. `frontend/src/services/api.js` — `updateCorrectionStatus()` client method + `getCorrectionsPending()` status param
5. `frontend/src/pages/teacher/CorrectionInbox.js` — Inline action buttons, KPI cards, status-based sort, double-click guard
6. `frontend/src/pages/teacher/Dashboard.js` — Replaced blob-based alerts with corrections pipeline, inline actions, loading states
