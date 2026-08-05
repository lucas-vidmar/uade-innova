---
title: 'Docente RAG Sandbox — teacher playground to test RAG queries before publishing'
type: 'feature'
created: '2026-08-04'
status: 'done'
review_loop_iteration: 1
baseline_commit: '93c172640e4eb88d05f34d8371ff52ec7747c15a'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

# Docente RAG Sandbox — teacher playground to test RAG queries before publishing

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Teachers have no way to preview RAG responses before publishing materials, so they cannot verify answer quality, source relevance, or context selection. QA Flow 16 (Fail) confirms the sandbox does not exist in frontend or backend.

**Approach:** Add a teacher-only "RAG Sandbox" page that reuses the existing `/api/rag-query` engine in a sandbox mode (no enrollment/consent gates, teacher subject scope) with a "Simular alumno" toggle that reproduces the student-view retrieval filters, and keeps a per-teacher query history in localStorage.

## Boundaries & Constraints

**Always:**
- Sandbox is a teacher-only route (`/teacher/rag-sandbox`), role-guarded by the existing router (`auth.getRole()`).
- Backend reads `sandbox` from query string (`?sandbox=true`) AND body (`sandbox: true`); `simulateStudent` from body only.
- When `sandbox=true`: skip enrollment validation and AI-consent checks unconditionally (teacher playground).
- When `simulateStudent=true`: keep the existing reviewed-materials-only filter (student view = published materials). When `simulateStudent=false` (default, teacher view): skip the reviewed-materials filter so the teacher can test unpublished/draft materials before publishing.
- Telemetry (`trackRAGInteraction`) still fires in sandbox mode with `sandbox: true` flag so token cost is attributed correctly (warning in AC #6).
- Query history is stored in `localStorage` only, keyed per teacher subject (`uade.rag-sandbox.history.<subjectId>`); never persisted to backend.
- Reuse existing UI patterns: `.source-pill` chips for class selection, `.chat-sources-circles`/`.source-circle-item` for source citations, `showCitationModal`-style expand/collapse, `renderMarkdown` for answers.
- Warning banner text exactly: `⚠️ Esta consulta consume tokens del presupuesto de IA`.

**Ask First:**
- None expected. If the reviewed-filter toggle reveals a behavior that conflicts with student chat semantics, HALT and ask the user before re-deriving.

**Never:**
- Do not create a new `/api/rag-sandbox` endpoint — extend `/api/rag-query`.
- Do not persist sandbox history or chat logs to backend storage.
- Do not change student chat behavior (student path must remain gated by enrollment + consent).
- Do not add new npm dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| TEACHER_PREVIEW | sandbox=true, simulateStudent=false, reviewed materials exist | Unreviewed draft chunks returned in matches (teacher preview) | Non-blocking: reviewed filter skipped, logged |
| SIMULATE_STUDENT | sandbox=true, simulateStudent=true, reviewed materials exist | Only reviewed chunks returned (student view) | Same as current student path |
| NO_ENROLLMENT | sandbox=true, principal not enrolled | Query proceeds (no 403 ENROLLMENT_REQUIRED) | N/A |
| NO_CONSENT | sandbox=true, consent not accepted | Query proceeds (no CONSENT_REQUIRED) | N/A |
| SANDBOX_FLAG_QUERY | `POST /api/rag-query?sandbox=true` with body sandbox absent | sandbox mode active via query param | N/A |
| NO_MATCHES | sandbox query returns 0 chunks | Refusal message `No encontre informacion...` returned | Existing path |
| STREAM_ERROR | LLM fails mid-stream | `event: error` with errorCategory | Existing telemetry path |
| HISTORY_EMPTY | Fresh teacher, no saved history | Empty history panel with hint text | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/functions/rag-query.js` — Add `sandbox` + `simulateStudent` handling around enrollment/consent checks (lines ~168–196) and reviewed-filter block (lines ~317–343); tag `trackRAGInteraction` call (lines ~556, ~691) and chat-log with sandbox flag.
- `backend/src/services/ai.js` — `chatCompletion`, `generateEmbedding`, `getChatModelName` (used as-is; read-only).
- `backend/src/services/rag-ranking.js` — ranking helpers used as-is (read-only).
- `backend/src/functions/rag-query.test.js` — extend existing node:test suite with sandbox cases (teacher preview, simulate student, enrollment/consent bypass).
- `frontend/src/pages/teacher/RagSandbox.js` — NEW: full sandbox UI (query input, class chips, simulate toggle, streaming response, expandable sources, localStorage history).
- `frontend/src/main.js` — Register route `/teacher/rag-sandbox` in `ROUTES` (line ~16) + dynamic path matcher if needed.
- `frontend/src/components/Sidebar.js` — Add teacher nav entry (NAV.teacher array, line ~21) with icon + `#/teacher/rag-sandbox`.
- `frontend/src/services/rag.api.js` — Add `sandbox`/`simulateStudent` params to `ragQuery` and `ragQueryStream` (lines ~5, ~28).
- `frontend/src/services/api.js` — Re-export already present (lines 24, 93); no change needed.
- `frontend/src/components/ChatWidget.js` — Reference only for source-circle/citation/markdown patterns (read-only; sandbox is a separate page).
- `frontend/src/styles/design-system.css` / `pages.css` — Existing `.source-pill`, `.chat-sources-circles`, `.chat-bubble-assistant` classes reused (read-only).
- `frontend/src/services/local-storage.js` — `safeSetItem`/`safeGetItem` for sandbox history (used as-is).
- `frontend/tests/rag-sandbox.spec.js` — NEW Playwright E2E: open sandbox → select classes → type query → see response with sources.

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/functions/rag-query.js` -- parse `sandbox` (query+body) and `simulateStudent` (body); gate enrollment/consent checks off; gate reviewed-filter off when `simulateStudent=false`; add `sandbox`/`simulateStudent` to telemetry + chat log.
- [x] `backend/src/functions/rag-query.test.js` -- add node:test cases for sandbox preview, simulate-student, enrollment/consent bypass.
- [x] `frontend/src/pages/teacher/RagSandbox.js` -- NEW page: header, token warning banner, class chips, simulate toggle, query input, streaming answer, expandable source citations, localStorage history panel.
- [x] `frontend/src/main.js` -- register `/teacher/rag-sandbox` route.
- [x] `frontend/src/components/Sidebar.js` -- add "RAG Sandbox" link to teacher nav.
- [x] `frontend/src/services/rag.api.js` -- thread `sandbox` + `simulateStudent` through `ragQuery` and `ragQueryStream`.
- [x] `frontend/tests/rag-sandbox.spec.js` -- NEW Playwright E2E covering the sandbox flow.

**Acceptance Criteria:**
- Given a teacher with a subject and classes, when they open `#/teacher/rag-sandbox`, then the page renders with the token warning banner, class selector, "Simular alumno" toggle, and query input.
- Given the teacher selects classes and submits a query, when the response streams in, then the answer renders with expandable source citations (existing circle + modal pattern).
- Given the "Simular alumno" toggle is ON, when a query is sent, then the backend request carries `sandbox=true` and `simulateStudent=true` and returns only published/reviewed materials.
- Given the toggle is OFF (teacher preview), when a query is sent, then the backend returns unreviewed draft chunks as well.
- Given a sandbox query, when it completes, then the QA response `POST /api/rag-query?sandbox=true` returns 200 (never 403 ENROLLMENT_REQUIRED / CONSENT_REQUIRED) and telemetry records `sandbox: true`.
- Given the teacher sends multiple queries, when the page is reloaded, then the query history from `localStorage` (`uade.rag-sandbox.history.<subjectId>`) is restored.
- Given the sandbox page is open, when the Playwright E2E runs, then it passes end-to-end (open → select class → query → response with sources).

## Spec Change Log

- `2026-08-04 (bad_spec loop 1)` — **Trigger:** reviewers flagged that sandbox mode trusted a client-supplied boolean with no server-side role check (`authLevel: anonymous`), letting a student bypass enrollment + consent + reviewed filters and read unpublished drafts. **Amended (non-frozen):** added a `Docente/Director` role guard when `sandboxMode && principal` (returns `403 SANDBOX_FORBIDDEN`), resolved before the enrollment/consent gates. **Avoided:** privilege escalation exposing draft/unreviewed materials cross-subject. **KEEP:** backend must independently verify role for sandbox; never rely on the client-side route guard alone.
- `2026-08-04 (bad_spec loop 1)` — **Trigger:** reviewers noted source-citation modal could stack overlays and leak on SPA navigation, and history entries stored unbounded answer text. **Amended (non-frozen):** single active modal with close-on-reopen guard; history answers truncated to 300 chars. **Avoided:** memory/quota blowups and modal leaks. **KEEP:** modal overlay management and capped localStorage payloads.

## Verification

**Commands:**
- `cd backend && npm test -- --test-name-pattern rag-query` -- expected: new sandbox tests pass alongside existing rag-query tests.
- `cd frontend && npx playwright test tests/rag-sandbox.spec.js` -- expected: E2E passes.
- `cd frontend && npm run build` -- expected: production build succeeds with the new route/page.

## Suggested Review Order

**Sandbox backend gating (security-critical)**

- Role guard resolves principal before enrollment/consent so sandbox can't be abused by students.
  [`rag-query.js:168`](../../backend/src/functions/rag-query.js#L168)

- sandbox/simulateStudent parsed once and gated enrollment + consent off only in sandbox mode.
  [`rag-query.js:172`](../../backend/src/functions/rag-query.js#L172)

**Retrieval semantics**

- Reviewed-filter toggle: teacher preview keeps drafts, simulate-student keeps only published.
  [`rag-query.js:345`](../../backend/src/functions/rag-query.js#L345)

**Telemetry & persistence**

- Sandbox flags threaded into RAGInteraction and chat log; persistence skipped in sandbox.
  [`rag-query.js:585`](../../backend/src/functions/rag-query.js#L585)

- trackRAGInteraction serializes sandbox/simulateStudent properties.
  [`telemetry.js:83`](../../backend/src/services/telemetry.js#L83)

**Frontend API + navigation**

- rag.api.js appends `?sandbox=true` and carries simulateStudent in body.
  [`rag.api.js:5`](../../frontend/src/services/rag.api.js#L5)

- Teacher sidebar link + route registration.
  [`Sidebar.js:29`](../../frontend/src/components/Sidebar.js#L29)
  [`main.js:30`](../../frontend/src/main.js#L30)

**New sandbox page**

- Full sandbox UI: warning banner, chips, simulate toggle, streaming preview, modal sources, localStorage history.
  [`RagSandbox.js:60`](../../frontend/src/pages/teacher/RagSandbox.js#L60)

**Tests**

- 7 backend sandbox cases incl. role guard, no-persistence, subject scope.
  [`rag-query.test.js:929`](../../backend/src/functions/rag-query.test.js#L929)

- 2 E2E tests covering banner, toggle, sources modal, history, sidebar.
  [`rag-sandbox.spec.js:5`](../../frontend/tests/rag-sandbox.spec.js#L5)
