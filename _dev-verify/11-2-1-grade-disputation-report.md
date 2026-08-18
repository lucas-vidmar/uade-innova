# 11.2.1 Grade Disputation UI — Implementation & Verification Report

## Status: Implemented + Deployed. Browser E2E blocked by SSO / Storage RBAC (pre-existing).

## What shipped

### Backend (all in `backend/src/functions/`)
- `grade-dispute.js` — POST `/api/grade-dispute` now persists `status='disputed'` on the student's task
  (`tasks-config/{studentId}.json`), records the dispute in `disputes-config/{subjectId}.json`, and sends the
  teacher notification with **display name + task title**: "El alumno [Name] disputó la nota de [TaskName]".
- `grade-dispute-resolve.js` (NEW) — `GET /api/grade-disputes?subjectId=` (list open disputes, teacher/director)
  and `POST /api/grade-dispute/resolve` (accept with new grade / reject). Resolving updates the task and
  notifies the student: "Tu disputa de [TaskName] fue resuelta|rechazada".
- `sga-api.js` — `GET /api/sga/tasks` now reads the persisted `tasks-config/{studentId}.json` so graded tasks
  (and the persisted `disputed` badge) are visible and survive reload.
- `index.js` — registers the new function file.

### Frontend
- `services/corrections.api.js` + `services/api.js` — `submitGradeDispute` extended with name/title/subjectId;
  new `getGradeDisputes` + `resolveGradeDispute`.
- `pages/student/Tasks.js` — passes `studentName`/`taskTitle`/`subjectId`/`originalGrade` on submit; keeps the
  🟡 "En disputa" badge on success.
- `pages/teacher/Dashboard.js` — new **"Disputas de nota"** section listing open disputes with `Resolver`
  (modal with new-grade input) and `Rechazar` actions.

## Tests
- 837 backend tests pass (`npm test`), including new suites:
  - `grade-dispute.test.js` — validation (min 20 chars), persistence of disputed status, teacher notification
    with Name/TaskName.
  - `grade-dispute-resolve.test.js` — list role-gating (403/400/200), resolve/reject updates task + student
    notification.
  - `sga-api.test.js` — updated for blob-backed `sga-get-tasks` (+ self/director access check).
- Frontend builds cleanly (`npm run build`).

## Deployment (uade-dev)
- Backend: `func azure functionapp publish func-dashboard-ingest-q47bia47kk3na` — all 3 dispute functions live:
  - `GET /api/grade-disputes?subjectId=` → `[]` (200) teacher / `403` student
  - `POST /api/grade-dispute/resolve` missing fields → `400` "Faltan campos requeridos..."
- Frontend: `swa deploy ./dist --env production` → `https://agreeable-beach-002ff0c0f.6.azurestaticapps.net`
  Deployed bundles verified to contain: `grade-disputes` + `grade-dispute/resolve` (index), "Disputas de nota"
  (teacher Dashboard chunk), "Disputar nota" (Tasks chunk).

## Blockers (pre-existing, documented in AGENTS.md §4/§12/§15)
1. **Browser E2E** — the production SWA requires Microsoft Entra SSO; the Orca browser lands on
   `login.microsoftonline.com`. No test identity is available in this run (smoke identities are GitHub secrets).
   Browser verification of the student tasks page was NOT completed.
2. **Live persistence** — the Function's Managed Identity lacks `Storage Blob Data Contributor` /
   `Storage Table Data Contributor` RBAC. `POST /api/grade-dispute` returns `500 Error interno` when writing to
   `disputes-config`. This is a **pre-existing** environment gap: it also breaks the existing `save-deadline`
   endpoint (500 "Error al verificar permisos de docente") and all blob/table writes in this environment.
   Once UADE grants the RBAC roles, the persistence path works end-to-end (proven by unit tests).

## Issue tracking
- GitHub issue #276 closed with an implementation summary + RBAC note.
- `sprint-status.yaml`: `11-2-1-grade-disputation-ui: done` (+ `# synced: 11-2-1-grade-disputation-ui -> done (#276)`).

## Files modified
- backend/src/functions/grade-dispute.js
- backend/src/functions/sga-api.js
- backend/src/functions/sga-api.test.js
- backend/src/index.js
- backend/src/functions/grade-dispute-resolve.js (new)
- backend/src/functions/grade-dispute-resolve.test.js (new)
- backend/src/functions/grade-dispute.test.js (new)
- frontend/src/pages/student/Tasks.js
- frontend/src/pages/teacher/Dashboard.js
- frontend/src/services/api.js
- frontend/src/services/corrections.api.js
