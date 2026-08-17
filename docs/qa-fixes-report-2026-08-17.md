# QA Fixes Report — Handoff for the Testing Agent

**Date:** 2026-08-17
**Branch:** `main` (merged) — pushed to `origin/main` (`257aa15..04a14a7`)
**Deployed:** Frontend live at https://agreeable-beach-002ff0c0f.6.azurestaticapps.net (Azure Static Web App `stapp-dashboard-q47bia47kk3na`, RG `RG_UADE_INNOVA_DEV`)
**Scope of this batch:** 6 fixes from the comprehensive browser QA audit (`docs/qa-comprehensive-audit-report.md`, `docs/mega-flows-qa-report.md`). **All changes are frontend-only** — the backend code is unchanged.

---

## What was changed (6 fixes)

| # | Fix | Files | Commit / Merge | GitHub issue |
|---|-----|-------|----------------|--------------|
| 1 | **Default subject fallback** (DEFECT-01, Critical) | `frontend/src/services/subjects.api.js`, `frontend/src/services/auth.js` | `f0fbcb5` / `e80b0e0` | #291 |
| 2 | **Admin user allowlist table** (DEFECT-02, High) | `frontend/src/pages/admin/UserManagement.js`, `frontend/src/services/auth.js` | `af56130` / `9bfb338` | #292 |
| 3 | **Keep `#/login` for logged-out users** (DEFECT-03, Medium) | `frontend/src/main.js` | `e21614b` / `d7d6b57` | #293 |
| 4 | **Podcast player with playback speed** (UX-02) | `frontend/src/pages/student/ClassDetail.js` | `40992cd` / `87898d3` | #294 |
| 5 | **"Consultar con IA" on graded tasks** (UX-03) | `frontend/src/pages/student/Tasks.js`, `frontend/src/pages/student/Dashboard.js`, `frontend/src/components/ChatWidget.js` | `dc08c7c` / `59673c9` | #295 |
| 6 | **Glossary "Agregar Término" always visible** (UX-01) | `frontend/src/pages/teacher/GlossaryManager.js` | `cf70b62` / `04a14a7` | #296 |

> GitHub was in a partial outage while this report was written; issues #291 and #292 were created successfully, #293–#296 may still be pending creation. Verify with `gh issue list --repo lucas-vidmar/uade-innova`.

---

## Detailed change description (for regression testing)

### 1. Default subject fallback — DEFECT-01
**Problem:** When `/api/subjects` cold-starts or fails, `auth.getActiveSubjectId()` returned `null`, collapsing Student Dashboard, Teacher Upload and Teacher Dashboard into the empty state *"No hay materias vinculadas a tu cuenta."* and hiding the chat input / upload forms.

**Change:**
- `subjects.api.js` — new exported `DEFAULT_SUBJECT = { id: 'arq-software-2026', name: 'Arquitectura de Software (2026-1)' }`; `mergeSubjectsWithLocal()` now falls back to `[DEFAULT_SUBJECT]` when the merged list is empty (and `getSubjects()` propagates it).
- `auth.js` — `getActiveSubjectId()` returns `DEFAULT_SUBJECT.id` instead of `null` when the user has no subjects.

**How it was verified:** Orca browser with the backend fully down: student dashboard rendered subject context *"Arquitectura de Software (2026-1)"*, search placeholder *"Buscar en Arquitectura de Software (2026-1)..."*, chat input functional after accepting terms; teacher upload panel rendered all 4 tabs; teacher dashboard rendered. No empty-state lockout. `npm run build` passes.

**Regression checklist for the tester:**
- [ ] Student dashboard loads with subject context when backend is down / cold-starting
- [ ] Chat input + prompt chips visible (after accepting terms)
- [ ] Teacher upload dropzone visible; teacher dashboard cards render
- [ ] No occurrence of *"No hay materias vinculadas a tu cuenta."* in those views

### 2. Admin user allowlist table — DEFECT-02
**Problem:** `/#/admin/users` rendered 0 rows when `/api/admin/users` returned an empty list.

**Change:**
- `auth.js` — `USERS` mock identities object now exported (`export const USERS`).
- `UserManagement.js` — new `renderFallbackUsers()` renders the 8 pilot accounts (Lucas Vidmar, María González, Carlos Mendoza, Sofía Ramírez, Tomás Herrera, Profesor Xavier, Joaquín García, Admin Técnico) with name, email, role badge (`student`/`teacher`/`director`/`admin`) and subject scope tag *"Arquitectura de Software (2026-1)"* whenever `api.getAdminUsers()` returns empty or throws. Remote users still render normally when present.

**How it was verified:** Orca browser on `/#/admin/users` (admin role, backend down) — table rendered all 8 rows with role badges and scope tags, plus an informational note that the remote API returned no users.

**Regression checklist for the tester:**
- [ ] `/#/admin/users` shows the 8 pilot accounts when the API is empty/offline
- [ ] Role badges show `student`/`teacher`/`director`/`admin`
- [ ] Subject scope tag shows *"Arquitectura de Software (2026-1)"*
- [ ] When the API returns users, the remote table still renders (fallback does not override real data)

### 3. `#/login` for logged-out/sessionless users — DEFECT-03
**Problem:** Direct navigation to `/#/login` auto-redirected to `/#/student/dashboard` in dev/testing because `initAuth()` marks the mock user as logged in.

**Change (in `main.js`):**
- `handleRoute()` — the `#/login` branch only redirects to the role dashboard when the session is genuinely authenticated (`edu_logged_in === 'true'` AND authenticated AND has a role AND not access-denied). Logged-out/sessionless users get `renderLogin()` (the sign-in card).
- `bootstrap()` — an explicit `#/login` hash is deferred to `handleRoute()` instead of being caught by the role-mismatch redirect.

**How it was verified:** Orca browser — (a) logged-out session on `#/login` kept the *"Iniciá sesión"* card with the *"Iniciar sesión con Microsoft"* link (no auto-bounce); (b) authenticated session on `#/login` still redirected to `#/{role}/dashboard` (existing behavior preserved).

**Regression checklist for the tester:**
- [ ] Logged-out: `/#/login` shows the sign-in card and stays there
- [ ] Authenticated: `/#/login` redirects to the role dashboard
- [ ] Access-denied users are not bounced to a dashboard

### 4. Podcast player with playback speed — UX-02
**Problem:** Class detail had no embedded audio player for the TTS podcast summary.

**Change (in `ClassDetail.js`):** The *"Podcast de Estudio (IA)"* section now renders `<audio id="class-podcast-audio" controls preload="metadata">` plus a speed row with **1x / 1.25x / 1.5x** buttons. Clicking sets `audio.playbackRate`, toggles `active` class + `aria-pressed`, and highlights the selected button (1x default). A `loadedmetadata` handler resets the rate to 1x on a new track. Audio URL still comes from `api.getClassAudioUrl(classId, activeSubjectId)` (`/api/audio-api`).

**How it was verified:** Backend had no seeded audio for the pilot class (backend down), so the widget markup + wiring were verified via DOM injection on the live route: clicking 1.25x → `playbackRate=1.25` (button active), 1.5x → `1.5`, 1x → `1`; `loadedmetadata` resets to 1x. The deployed chunk `ClassDetail-DXy-b5-V.js` contains `class-podcast-audio`.

**Regression checklist for the tester:**
- [ ] With a class that has an audio summary, the podcast card shows `<audio controls>` + speed buttons
- [ ] Speed buttons update playback rate and highlight correctly
- [ ] New track load resets speed to 1x
- [ ] No layout regression in the premium-vibe card

### 5. "Consultar con IA" on graded tasks — UX-03
**Problem:** On `/#/student/tasks`, students had no direct action to consult the AI assistant about a grade/correction criteria.

**Change:**
- `Tasks.js` — visible **"🤖 Consultar con IA"** button on graded rows (`t.grade !== null`) in the completed table, bound via `bindConsultAIEvents`; clicking navigates to `#/student/dashboard?preset=<encoded>`.
- `Dashboard.js` — reads `preset` from the hash query, passes it to `createChatWidget`, cleans the URL after applying it.
- `ChatWidget.js` — accepts a `preset` prop and pre-fills the `#chat-input` textarea after render.

**Prefill message:** `Hola, tengo una consulta sobre la correccion y criterios de evaluacion de <task title>`

**How it was verified:** Orca browser — with seeded graded tasks, both completed rows rendered the button; a real click on TP1 navigated to the dashboard and the chat input contained exactly: `Hola, tengo una consulta sobre la correccion y criterios de evaluacion de TP1 - Arquitectura Hexagonal`. Note: consent must be accepted before the chat input is visible.

**Regression checklist for the tester:**
- [ ] Completed/graded task rows show *"Consultar con IA"*
- [ ] Pending tasks do NOT show the button
- [ ] Clicking navigates to the dashboard chat with the pre-filled message (title substituted)
- [ ] Pre-fill works after consent is accepted

### 6. Glossary "Agregar Término" always visible — UX-01
**Problem:** The "Agregar Término" button only lived in the header; the empty-state card had no CTA.

**Change (in `GlossaryManager.js`):** Extracted the add-term handler into a reusable `addTerm()` (pushes `{ term: '', aliases: [] }`, re-renders, focuses the new row's term input) and bound it to BOTH the header button and a new `#glossary-add-term-empty-btn` CTA inside the empty-state card ("Sin términos aún").

**How it was verified:** Orca browser — empty state rendered both CTAs; clicking the empty-state button (and the header button) added a focused editable term row (Término/Aliases inputs + Guardar Glosario button). Deployed chunk `GlossaryManager-CutY34kY.js` contains `glossary-add-term-empty-btn`.

**Regression checklist for the tester:**
- [ ] Empty glossary shows "Agregar Término" in BOTH header and empty-state card
- [ ] Both buttons add an editable, focused term row
- [ ] Save (Guardar Glosario) still works

---

## Deployment notes

- **Frontend:** deployed via `azd deploy frontend` to the SWA (endpoint above). Verified the live bundle contains the fix markers (`arq-software-2026` in `index-DNDwLKXZ.js`; `class-podcast-audio` in `ClassDetail-DXy-b5-V.js`; `consult-ai-btn` / `correccion y criterios de evaluacion` in `Tasks-CxGC1zIl.js`; `glossary-add-term-empty-btn` in `GlossaryManager-CutY34kY.js`; `allowlist estática` in `UserManagement-Bft8fwmE.js`).
- **Backend:** NOT redeployed — no backend code changed. `azd deploy` (full) fails on the Function App because it uses `WEBSITE_RUN_FROM_PACKAGE` (Run-From-Zip), which zipdeploy cannot update; the CI pipeline (`deploy-production.yml`) deploys the backend via the publish profile. **No action needed for this batch.**
- **CI:** pushing `main` to origin triggered the production pipeline; GitHub was in a partial outage during this window, so confirm the run completed: `gh run list --repo lucas-vidmar/uade-innova`.
- **Production browser test:** the deployed site redirects unauthenticated users to Microsoft sign-in (expected). Interactive feature verification was performed against a local dev build (mock auth) with the same code that is deployed.

## Suggested retest matrix for the testing agent
Re-run the affected flows from the audit (docs/mega-flows-qa-report.md): STU-01/02/12/13/17, TEA-06/19/20/21, ADM-06/07/08/09, plus the public `/#/login` flow. Focus on the empty-state, admin users table, glossary CTA, tasks "Consultar con IA", and podcast speed controls listed above.