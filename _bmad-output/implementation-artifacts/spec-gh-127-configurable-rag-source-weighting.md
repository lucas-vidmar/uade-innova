---
title: 'Issue #127 — Configurable RAG Source Weighting by Subject'
type: 'feature'
created: '2026-06-19'
status: 'done'
baseline_commit: '4c5a3948bfaa81a1e2851533f245fb5b9b169758'
context:
  - 'backend/src/functions/rag-query.js'
  - 'backend/src/services/state-store.js'
  - 'backend/src/services/storage.js'
  - 'frontend/src/services/api.js'
  - 'frontend/src/pages/teacher/Dashboard.js'
  - 'frontend/src/pages/director/SubjectManagement.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** All subjects use the same fixed material-type weights (`notes: 1.35, bibliography: 1.1, transcript: 1.0, presentation: 0.95`) in `rag-query.js:25`. A math course may want to weigh bibliography over transcripts, while a software engineering course may prioritize teacher notes — but there is no way to tune this per subject.

**Approach:** Store subject-level weight config in Table Storage (`SubjectWeights`), expose a CRUD API with role-based access (Director/Admin/Teacher-owner), add a configuration UI in the teacher dashboard and director subject management, and modify the RAG pipeline to load subject-specific weights at query time (falling back to current hardcoded defaults).

## Boundaries & Constraints

**Always:**
- Subject weight config stored in Table Storage (`SubjectWeights` table, PartitionKey=subjectId, RowKey="weights")
- RAG query loads weights per-subject at runtime; no hardcoded per-subject branches
- API endpoints enforce role-based access: GET is open to any authenticated user, PUT only to Director/Admin or Teacher enrolled in that subject
- Safe defaults match existing hardcoded values when no config exists
- Students can never modify weights

**Ask First:**
- Placement of the weight configuration UI within the teacher dashboard
- Whether to add weight config access from director SubjectManagement page or as a standalone page

**Never:**
- No new infrastructure (reuse existing Table Storage and patterns)
- No changes to the Pinecone index schema or chunk metadata
- No real-time sync or distributed caching — load per request

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| GET weights for subject with config | `GET /api/subject-weights/{subjectId}` | `{ notes: 1.5, bibliography: 1.0, transcript: 0.8, presentation: 0.9 }` | N/A |
| GET weights for subject without config | `GET /api/subject-weights/{subjectId}` | Default weights returned with `{ _defaults: true }` | N/A |
| PUT valid weights | `PUT /api/subject-weights/{subjectId}` with `{ notes: 1.5 }` | `200` with merged config | 400 on invalid values (negative, >3) |
| PUT by unauthorized user | Same request, student role | `403 Forbidden` | N/A |
| RAG query with subject that has config | Question on subject with custom weights | Chunks ranked using subject-specific weights | Falls back to defaults on storage error (non-blocking) |
| RAG query with subject without config | Question on subject without weight config | Chunks ranked using default weights | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/services/subject-weights.js` — NEW: Table Storage CRUD for subject weight config (get, upsert, validate)
- `backend/src/functions/subject-weights-api.js` — NEW: HTTP endpoints GET/PUT `/api/subject-weights/{subjectId}` with role check
- `backend/src/functions/rag-query.js` — MODIFY: load subject-specific weights in handler before `rankMatches()` call
- `backend/src/index.js` — MODIFY: import new function
- `backend/src/functions/rag-query.test.js` — MODIFY: add test cases for subject-specific weighting
- `frontend/src/services/api.js` — MODIFY: add `getSubjectWeights()` and `saveSubjectWeights()` methods
- `frontend/src/pages/teacher/SubjectWeights.js` — NEW: weight configuration panel for teachers
- `frontend/src/pages/teacher/Dashboard.js` — MODIFY: wire SubjectWeights into teacher dashboard

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/subject-weights.js` — CRUD service: `getSubjectWeights(subjectId)` returns merged config with defaults, `upsertSubjectWeights(subjectId, weights, userId)` validates and saves, `DEFAULT_WEIGHTS` constant
- [x] `backend/src/functions/subject-weights-api.js` — HTTP Function: `GET` returns weights (open to any authed user), `PUT` validates body and checks role (Director/Admin/Teacher with enrollment), returns merged result
- [x] `backend/src/functions/rag-query.js` — After enrollment check, load `subjectWeights` from service; modify `getMaterialWeight()` to accept optional weights map; thread through `rankMatches()` and `buildHybridContext()`
- [x] `backend/src/index.js` — Add import for `subject-weights-api`
- [x] `backend/src/functions/rag-query.test.js` — Test: subject with custom weights ranks correctly, missing config uses defaults, invalid config falls back gracefully
- [x] `frontend/src/services/api.js` — Add `getSubjectWeights(subjectId)` and `saveSubjectWeights(subjectId, weights)` methods following existing mock + live pattern
- [x] `frontend/src/pages/teacher/SubjectWeights.js` — NEW: panel with 4 sliders (notes, bibliography, transcript, presentation) range 0.0-3.0 step 0.05, reset-to-defaults button, save button, shows current effective weights
- [x] `frontend/src/pages/teacher/Dashboard.js` — MODIFY: add "Ponderación de fuentes" section, calls `renderSubjectWeights()` for selected subject

**Acceptance Criteria:**
- Given a subject with custom weight config, when a RAG query runs, then chunk scores are computed using the subject's custom weights instead of defaults
- Given a subject without custom weight config, when a RAG query runs, then the existing hardcoded defaults are used
- Given a Director user, when they PUT weights for any subject, then the config is saved and returned on subsequent GET calls
- Given a Teacher user enrolled in a subject, when they PUT weights for that subject, then the config is saved
- Given a Student user, when they attempt to PUT weights, then a 403 response is returned
- Given the Teacher SubjectWeights UI, when sliders are adjusted and saved, then the API is called and the form reflects saved values

## Verification

**Commands:**
- `npm run lint --prefix backend` — expected: no errors
- `npm test --prefix backend` — expected: rag-query.test.js passes including new weighting tests
