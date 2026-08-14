# Browser QA Report — 2026-08-14

## Release assessment

**Recommendation: NO-GO.** The public application is not usable because the production frontend never reaches a signed-in persona. In addition, an end-to-end RAG query returned sources from an unrelated subject while the active subject and class filters were set, which is a critical academic-isolation defect.

## Agreed MVP authentication and authorization model

The university has agreed that the MVP will **not depend on a university-managed Entra ID application, tenant role assignments, groups, or RBAC**. Users will sign in with their Microsoft accounts. After Microsoft verifies the account, the application will normalize the verified email address and look it up in an application-owned, hard-coded allowlist.

Each allowlist entry must map one email address to an explicit application role, such as `student`, `teacher`, `director`, or `admin`, together with any required subject/class scope. A listed user is sent directly to the dashboard authorized for that role. A Microsoft account whose verified email is absent from the allowlist must be denied access with a clear message and a safe sign-out/retry path.

For the coding agent, the MVP security boundary is therefore:

- Microsoft sign-in proves account identity; the client must never be trusted to submit or choose its own email or role.
- The server resolves authorization from the verified Microsoft identity and the server-side allowlist on every protected API request.
- Email comparison is trimmed and case-insensitive, and duplicate/conflicting allowlist entries fail closed.
- The browser receives only the resolved user profile and role; it must not contain the complete allowlist or be able to elevate a role through local storage, query parameters, or the demo role switcher.
- Unknown, missing, or unverified email claims receive `403 Forbidden`; unauthenticated requests receive `401 Unauthorized` or initiate the Microsoft sign-in flow as appropriate.
- Changes to the allowlist require a deployment for this MVP and must not expose secrets or authentication tokens in source control or logs.
- The implementation must log allow/deny outcomes with a correlation identifier, but must not log access tokens or unnecessary identity claims.

This decision supersedes the Entra-specific expected behavior and remediation language elsewhere in this report. References to “real identities” below mean real Microsoft-account identities resolved through this allowlist model.

## Scope and evidence boundaries

- Public frontend tested: `https://agreeable-beach-002ff0c0f.6.azurestaticapps.net`
- Local UI tested: `http://127.0.0.1:5173`
- Production backend reached by the local UI through the Vite `/api` proxy configured in `frontend/vite.config.js`.
- Personas: student, professor, director, technical administrator.
- Coverage: every registered top-level route, all three dynamic route families, route guards, desktop viewport, and a 390 × 844 mobile viewport.
- Manual interactions included consent/onboarding, student class selection and chat, settings persistence UI, role changes, filters, tabs, class details, and non-destructive administrative controls.
- Existing Playwright suite: **42 passed, 4 failed, 46 total**.
- No uploads, deletions, publication actions, retention changes, model changes, enrollment changes, or corrective actions were submitted.
- One production-backed RAG query was submitted as part of the requested functional test: `¿Qué es la arquitectura hexagonal?`. It created a chat/conversation record dated 14 August in the test student's history.

Because the deployed frontend is blocked before login, all post-login UI findings are based on the current local frontend build connected to the production Azure Functions backend. They are not confirmation that the deployed frontend bundle behaves identically after authentication is repaired.

## Core functionality inventory and coverage

### Student

- Dashboard, subject selector, KPIs, recent chats, class status, and upcoming tasks.
- AI consent terms, onboarding guide, class-scoped chat, streaming answer, model label, sources, feedback/report controls, and conversation persistence.
- Class detail: summary, conceptual map, transcript timeline, transcript sections, materials, chat deep links, and auto-evaluation tab.
- Global search, notifications, tasks/grades, reports, calendar/export menu, and preferences.
- Direct route guard against teacher/director/admin pages.

### Professor

- Subject dashboard, class schedule, deadlines, source weighting, and student progress.
- Class directory/editor, summary/map/podcast controls, and publication controls.
- Multi-class upload UI, material types, processing state, summary approval, and material management.
- AI-quality correction inbox/detail, transcription corrections/detail, glossary, RAG sandbox, and analytics.

### Director

- Adoption/safety/RAG KPIs, time-window filters, exports, class-view metrics, and early-risk summary.
- SAT analytics, interventions and thresholds, class management, subject management, and dashboard links.

### Technical administrator

- Cost/vector/budget dashboard, user audit, system configuration, AI model configuration, retention, prompt management, compliance evidence, and cold archive usage.

### Responsive behavior

- Student dashboard, professor upload, director dashboard, and administrator retention were checked at 390 × 844.
- No page-level horizontal overflow was detected, but the mobile navigation has an accessibility defect described below.

## Defects

### QA-001 — P0 — Production frontend cannot authenticate or enter the product

**Evidence:** Production browser, reproduced twice including a reload.

**Steps**

1. Open the public frontend URL.
2. Wait for initialization.
3. Reload once.

**Actual:** The only usable control is `Recargar`. The page says `No se pudo verificar tu identidad.` No login redirect or persona page is offered.

**Expected:** An unauthenticated user should be offered or redirected to Microsoft-account sign-in. After successful sign-in, a verified email present in the server-side allowlist should enter its mapped dashboard; an email absent from the allowlist should receive a clear access-denied page with sign-out/retry controls.

**Likely cause:** `frontend/public/staticwebapp.config.json` only defines a `/login` redirect and does not protect the application or redirect unauthenticated traffic. `auth.initAuth()` returns `false` when `/.auth/me` has no principal, and `bootstrap()` renders a dead-end error instead of starting a supported login flow (`frontend/src/services/auth.js:369-423`, `frontend/src/main.js:166-171`).

**Recommended fix:** Implement Microsoft-account sign-in plus server-side allowlist lookup and role/scope resolution as defined in the agreed MVP model above. Add an explicit sign-in CTA/redirect and access-denied state. Add production smoke tests that cover an allowed account, an unlisted account, and unauthenticated access instead of checking only HTTP 200.

### QA-002 — P0 — RAG returns sources from another subject/class

**Evidence:** End-to-end browser query through the production Azure Functions backend.

**Steps**

1. Use the student persona.
2. Confirm active subject `Arquitectura de Software 2026 (2026-1)`.
3. Open chat scoped to `Clase 1` only.
4. Ask `¿Qué es la arquitectura hexagonal?`.

**Actual:** The answer cited:

- `DASI Cronograma dia Jueves_1C2023_ejemplo.docx`
- `Clase 01 Introduccion al estudio de sistemas.pptx`

The Class 1 detail also exposed unrelated/test content, including DASI/Tidio material, an Econometría II test transcript, `trigger check`, and `retry old doc`.

**Expected:** Every retrieved source and rendered class artifact must belong to `subjectId=arq-software-2026` and `classId=class-01`.

**Risk:** Cross-course disclosure, academically incorrect answers, invalid citations, and violation of the project's primary RAG isolation requirement.

**Likely cause:** The request and backend code both apply subject/class filters (`frontend/src/components/ChatWidget.js:377-381`, `backend/src/functions/rag-query.js:123-143`, `281-355`). The production vector/state data therefore likely contains incorrect `subjectId`/`classId` metadata or stale vectors from a previous migration. The response is strong evidence that code-only filter tests are insufficient.

**Recommended fix:** Quarantine the affected index, inspect metadata for the returned material IDs, remove/reindex incorrectly tagged vectors from authoritative material records, and add a deployed canary test that asserts every returned source metadata object matches the requested subject and selected class.

### QA-003 — P1 — Accepting AI terms does not unlock chat until reload

**Evidence:** Manual browser flow and code-confirmed root cause.

**Steps**

1. Open student dashboard without stored AI consent.
2. Click `Aceptar términos`.
3. Check the consent checkbox and click `Continuar`.

**Actual:** The modal closes, but the dashboard still shows `Aceptá los términos para usar el chat`. A manual reload unlocks chat and starts onboarding.

**Expected:** Chat should render immediately after successful consent.

**Cause:** `PrivacyModal.js` removes `modalOverlay` and then only invokes `onAccepted` if `document.body.contains(modalOverlay)` is still true. That condition is necessarily false after removal (`frontend/src/components/PrivacyModal.js:61-69`).

**Recommended fix:** Invoke `onAccepted()` before removal or remove the impossible containment condition. Add an E2E assertion that chat becomes usable without navigation/reload.

### QA-004 — P1 — Director dashboard `Cumplimiento` link is dead

**Evidence:** Manual browser click and route-table inspection.

**Steps**

1. Enter Director dashboard.
2. Click `Cumplimiento →`.

**Actual:** The hash briefly targets `#/director/compliance`, then the app returns to `#/director/dashboard`.

**Expected:** Open the compliance evidence page or omit the link for this role.

**Cause:** The dashboard links to `#/director/compliance` (`frontend/src/pages/director/Dashboard.js:230-235`), but only `/admin/compliance` is registered (`frontend/src/main.js:43-50`).

### QA-005 — P1 — Administrator settings report false success without persistence

**Evidence:** Browser UI and code-confirmed behavior.

Affected pages:

- `Configuración Técnica`
- `Configuración del Modelo de IA`
- `Políticas de Retención`

**Actual:** `Guardar Configuración` / `Guardar Cambios` show success toasts, but the handlers do not call an API or persist the entered values. Reloading restores hard-coded defaults.

**Expected:** Values must be loaded from a source of truth, validated, saved, and read back; otherwise controls should be clearly labeled as a non-functional prototype and disabled.

**Code evidence:**

- `frontend/src/pages/admin/Settings.js:60-62`
- `frontend/src/pages/admin/ModelConfig.js:82-84`
- `frontend/src/pages/admin/Retention.js:108-110`

### QA-006 — P1 — Retention defaults are internally contradictory

**Evidence:** Admin browser page and code.

**Actual defaults:**

- Cold archive after **730 days**.
- Permanent deletion after **365 days**.
- Automatic deletion enabled.

This deletes eligible data one year before it can reach cold archive. The same page labels two-year cold-archive policies as active and shows a success toast for changes that are not persisted.

**Expected:** Permanent deletion must occur after archival, with cross-field validation and alignment to the actual IaC/storage policy.

**Code evidence:** `frontend/src/pages/admin/Retention.js:65-84`.

### QA-007 — P1 — Several core production-backed views are unavailable or partial

**Evidence:** Local UI against production Azure Functions via `/api` proxy.

- Professor `Analítica`: `Analítica no disponible` and backend endpoint warning.
- Administrator `Gestión de Prompts`: `Gestión de Prompts no disponible`.
- Professor `Reportes de Calidad IA`: warns that some data could not load and may be incomplete.
- Student notification stream repeatedly receives HTTP 403 and reconnects with exponential backoff.

**Expected:** Authorized personas should receive complete data or a specific, actionable authorization/configuration error.

**Boundary:** These calls used the development mock-auth path against the production backend. Reconfirm after QA-001 is fixed with real Microsoft identities resolved through the MVP allowlist before assigning a final backend root cause.

### QA-008 — P1 — Browser regression suite is red

**Evidence:** `npm run test:e2e -- --reporter=line`, 46 tests.

**Result:** 42 passed, 4 failed in approximately 1.6 minutes.

Failures:

1. `api-rate-limit.spec.js`: chat input not found, so the 429/cooldown flow never starts.
2. `class-view-tracking.spec.js`: onboarding overlay intercepts the class click until the test times out.
3. `processing-notifications.spec.js`: expected `Procesamiento completado` toast never appears when invalid persisted jobs coexist with a valid job.
4. `teacher-alerts.spec.js`: `#teacher-alerts-card` is absent on analytics.

At least the onboarding failure reproduces a real integration conflict: an automatic first-run overlay can block the primary class interaction.

### QA-009 — P1 — Deployment smoke test permits a completely broken release

**Evidence:** CI configuration and live production result.

**Actual:** Production smoke testing only checks that the Function `/api/hello` and SWA root return HTTP 200 (`.github/workflows/deploy-production.yml:116-138`). The frontend currently passes that check while presenting only an auth error.

**Expected:** The smoke test should assert the expected auth redirect/identity endpoint and a real application-state marker after authentication.

### QA-010 — P2 — Mobile bottom navigation links have no accessible names

**Evidence:** 390 × 844 browser accessibility snapshot for student and director.

**Actual:** Mobile navigation links appear as unnamed links. CSS hides every label with `.mobile-bottom-link span { display: none !important; }`, while the links have no `aria-label` (`frontend/src/components/Sidebar.js:215-225`, `frontend/src/styles/pages.css:5160-5162`).

**Expected:** Every icon-only mobile navigation item should retain an accessible name through `aria-label` or visually hidden text.

### QA-011 — P2 — Demo role/student switcher is always rendered

**Evidence:** Browser persona switching and source inspection.

**Actual:** The profile menu always renders `Cambiar Rol (Demo)` and five mock students; the handler calls `mockLoginAs()` without a DEV/feature-flag guard (`frontend/src/components/Sidebar.js:184-201`, `284-299`).

**Expected:** Demo identities and role simulation must never be exposed in the production UI. Gate the markup and handlers with an explicit development-only flag.

### QA-012 — P2 — Admin API endpoint display is wrong

**Evidence:** Admin Settings browser page and code.

**Actual:** `URL Base de la API` displays the frontend origin (`window.location.origin`), e.g. `http://127.0.0.1:5173`, rather than the configured API base/proxy path (`frontend/src/pages/admin/Settings.js:30-36`).

**Expected:** Display the effective `BASE_URL` or a server-reported endpoint, with environment-safe redaction if necessary.

### QA-013 — P2 — Production bundle emits diagnostic environment logging

**Evidence:** Production console.

**Actual:** Every load logs `Diagnostic: BASE_URL check`, `import.meta.env`, and `VITE_API_BASE_URL` from `frontend/src/diagnostic.js:1-4`.

**Expected:** Remove diagnostic logging from production builds. It adds noise and can expose deployment configuration.

### QA-014 — P2 — Visible pilot data contains stale/test artifacts

**Evidence:** Student/professor browser pages using production-backed data.

Examples:

- Deadline title `Test deadlinr`.
- Several duplicate recent chats named `Que es un sistema?`.
- Transcript markers at `0s`.
- Class 1 transcript snippets `trigger check`, `retry old doc`, and an Econometría II E2E test sentence.

**Expected:** Seed/test fixtures should be isolated from pilot subjects and accounts. Add environment tags and a cleanup/reseed procedure.

### QA-015 — P3 — Invalid correction detail has a weaker error recovery path

**Evidence:** Dynamic route test with a nonexistent ID.

**Actual:** `#/teacher/correction/nonexistent` shows only `Error cargando corrección. Intentá de nuevo.` with no back/retry control. The analogous transcription-correction page says `Sugerencia no encontrada` and provides `← Volver`.

**Expected:** Consistent not-found handling with a back link and retry only for retryable errors.

## What worked in the tested build

- Client-side role guards redirected cross-role routes correctly.
- Student class selection enabled chat; the streamed response completed and restored the input.
- Chat displayed the active model and clickable source chips.
- Student assistant preferences showed a success toast and remained locally available during the session.
- Student onboarding steps were coherent and could be completed.
- Class detail loaded summary, conceptual map, transcript timeline, transcript sections, and material list.
- Student tasks, reports, calendar, notifications page, and settings rendered without page crashes.
- Professor class, upload, materials, glossary, transcription-correction, RAG sandbox, and editor surfaces rendered.
- Director KPI, SAT, interventions, class, and subject surfaces rendered.
- Administrator dashboard, users, retention, compliance, and archive surfaces rendered.
- Desktop route guard behavior and mobile layouts did not create page-level horizontal overflow.

## Recommended treatment order

1. **Stop/rollback the release or place it behind maintenance messaging** until QA-001 is fixed.
2. **Quarantine and audit RAG data** for QA-002 before allowing student use.
3. Fix consent state transition (QA-003) and director routing (QA-004).
4. Remove deceptive admin save controls or implement real persisted configuration with readback (QA-005/006/012).
5. Restore failing API-backed views under real Microsoft identities resolved through the MVP allowlist (QA-007).
6. Make the full E2E suite green and strengthen production smoke coverage (QA-008/009).
7. Address mobile accessibility, demo leakage, diagnostics, and stale data (QA-010/011/013/014).

## Suggested acceptance gates for the next verification

- Public root offers or redirects to Microsoft-account sign-in; an allowed account reaches only its mapped persona and subject/class scope.
- An unlisted Microsoft account is denied with a clear message and sign-out/retry path.
- Protected APIs independently resolve the verified email against the server-side allowlist; client-side role or email tampering cannot elevate access.
- Allowlist matching is case-insensitive and fails closed for missing, unverified, duplicate, or conflicting identities.
- Every configured role (`student`, `teacher`, `director`, and `admin`) has at least one production smoke-test identity, with credentials kept outside the repository.
- A deployed RAG canary asserts every source has the requested `subjectId` and selected `classId`.
- Consent unlocks chat without reload.
- Director compliance navigation resolves to a registered/authorized page.
- Admin save operations survive reload and return a server revision/readback.
- Retention validation rejects `deleteDays <= archiveDays` when archive is enabled.
- Professor analytics, prompt management, correction inbox, and notifications work under real identities.
- All 46 existing browser tests pass, plus new tests for production auth, consent transition, dead links, config persistence, source isolation, and accessible mobile names.
