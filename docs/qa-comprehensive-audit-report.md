# Comprehensive QA Audit & Testing Report
**Product:** Dashboard Educativo Inteligente (UADE Innova Pilot)  
**Testing Date:** 2026-08-16 / 2026-08-17  
**Test Environment:** Deployed Azure Architecture (`RG_UADE_INNOVA_DEV`) & Local Dev (`http://127.0.0.1:5173`)  
**Tested Viewports:** Desktop (1440 × 900) & Mobile (390 × 844)  
**Personas Evaluated:** Public/Unauthenticated, Student, Professor/Teacher, Director, Technical Administrator  

---

## Executive Summary & Product Readiness

| Metric | Result | Status |
|---|---|---|
| **Total Test Suites Executed** | 35 Automated + Interactive Flows | ✅ Completed |
| **Pass Rate** | 82.8% (29 passed, 6 defects/UX items) | 🟡 Actionable |
| **Role-Based Access Control (RBAC)** | 100% Enforced (Zero cross-role route leaks) | 🛡️ Secure |
| **Mobile Accessibility (390×844)** | Bottom navigation active, touch-friendly | 📱 Passed |
| **MVP Hard-coded Allowlist** | Architected via `ALLOWED_USERS_JSON` / `services/allowlist.js` | 🔑 Operational |

---

## 1. Persona Inventory & Core Functionalities

### 1.1 Public & Unauthenticated Persona
- **Microsoft Sign-in (`/#/login`):** Public sign-in card providing direct institutional AAD authentication.
- **Access Denied (`/#/access-denied`):** Informative 403 screen explaining that only authorized university accounts on the allowlist can access the pilot, with clear "Reintentar" and "Cerrar sesión" actions.
- **Session Auto-Routing:** Unauthenticated users are routed to Microsoft login; authenticated users are directed straight to their role-specific dashboard.

### 1.2 Student Persona (`student` — Lucas Vidmar, María González, Carlos Mendoza, Sofía Ramírez, Tomás Herrera)
- **Interactive Chat & RAG:** Contextual academic query assistant with active class multi-selection chips.
- **Source Attribution:** Real-time citations linking answers to class transcripts, presentation slides, notes, and bibliography.
- **Feedback & Discrepancy Reporting:** Thumbs-up/down controls and a detailed modal to report AI hallucinations or source mismatches.
- **Autoevaluación:** Interactive quiz modal testing comprehension of class materials with instant scoring.
- **Academic Tasks & Grades (SGA):** Overview of upcoming homework, exam submissions, grades, and priority flags.
- **Academic Calendar:** Schedule of lectures, assignments, and exams with `.ics` export.
- **Notification Center:** Real-time notifications filtered by categories (*Nota*, *Resumen*, *Deadline*, *Material*).
- **Personalized AI Preferences:** Configurable assistant tone (*formal*, *pedagógica*, *concisa*), response length, source citations toggle, and reminder cadences.
- **AI Consent & Privacy:** Explicit toggle to accept or revoke AI processing consent in compliance with data privacy regulations.
- **Global Academic Search:** Full-text and vector search across course materials and lectures.
- **Class Detail View:** Class syllabus, timeline, slides, summaries, and key concepts.
- **Onboarding Guided Tour:** Step-by-step interactive walkthrough for first-time students.

### 1.3 Professor / Teacher Persona (`teacher` — Profesor Xavier)
- **Cátedras Dashboard:** High-level overview of assigned courses, class readiness, and pending review queues.
- **Class Schedule Manager:** Visual syllabus planner to create, edit, and organize lectures, dates, and topics.
- **Material Ingestion Dropzone:** Upload support for `.vtt`/`.txt` transcripts, `.pptx` presentations, and `.pdf` notes/bibliography.
- **Master Source Tagging:** Checkbox flag marking authoritative bibliography as the primary ground truth for RAG.
- **Material Repository:** Management table displaying Pinecone vectorization status (*ready*, *processing*, *error*), re-process actions, and deletions.
- **Correction Inbox:** Central queue reviewing student hallucination reports and discrepancy flags.
- **Correction Detail Inspector:** In-depth review of student query, generated response, cited chunk, and corrective resolution tools.
- **Transcription Correction Workflow:** Speech-to-text accuracy review with diff viewer to fix transcribed audio text.
- **Domain Glossary Manager:** Curated dictionary of academic acronyms and technical definitions to boost vector retrieval.
- **RAG Sandbox:** Teacher testing playground to simulate student queries, inspect retrieved chunks, and view cosine similarity scores.
- **Pedagogical Analytics:** Analytics dashboard illustrating frequently asked concepts, confusion patterns, and material engagement.
- **Material Weights:** Weight tuning for relative importance between transcripts and bibliography.

### 1.4 Director Persona (`director` — Joaquín García)
- **Executive KPI Dashboard:** Macro-level adoption rate tracking (against the 60% semester target), active students/teachers, query volume, and sentiment trends.
- **SAT by Prompt Analytics:** Student satisfaction ratings broken down by prompt category and subject.
- **Early Warning & Interventions Panel:** Automated detection of at-risk students (>14 days inactivity, low quiz scores) with an intervention log.
- **Cross-Faculty Class Oversight:** Unified view of course progress and material validation across faculties.
- **Subject & Faculty Management:** Course catalog administration, professor assignment, and enrollment quotas.
- **AI Ethics & Compliance Audit:** Audit trail tracking student AI consent acceptance rates and data retention compliance.
- **System Prompt Governance:** Supervision of safety filters, institutional guardrails, and tone guidelines.
- **Cold Storage Archive Usage:** Telemetry on vector pruning, compressed storage savings, and archive restorations.

### 1.5 Technical Administrator Persona (`admin` — Admin Técnico)
- **System Health & Observability:** Real-time monitoring of API latencies, token usage per model, Pinecone vector index counts, and estimated cost per student (<$1.50/month).
- **User Allowlist Directory (`/#/admin/users`):** Directory of authorized pilot accounts with assigned roles (`student`, `teacher`, `director`, `admin`) and subject scopes.
- **Cloud Configuration & Key Vault:** Inspection of Azure Key Vault references, Pinecone host parameters, and feature toggles.
- **AI Model Selection & Tuning:** Selector for DeepSeek V4 Flash vs GPT-4o mini, temperature slider, and max token limits.
- **Data Retention Policies:** Enforcing compliance purge schedules for chat transcripts, telemetry, and inactive embeddings.
- **Prompt Management:** Global editor for system prompt templates and RAG augmentation formats.
- **Cold Storage Management:** Archive usage monitoring and vector database maintenance.

---

## 2. Detailed Findings & Curated Defect Report

### 🚨 Critical / High Priority Defect List

#### [DEFECT-01] Empty Subject State Blocks Student & Teacher Navigation
- **Location:** `frontend/src/services/auth.js`, `frontend/src/pages/student/Dashboard.js`, `frontend/src/pages/teacher/UploadMaterials.js`
- **Observed Behavior:** If the backend `/api/subjects` endpoint encounters a cold start or returns an empty list, `auth.getUser().subjects` defaults to `[]`, setting `activeSubjectId` to `null`. This replaces the entire Student Dashboard and Teacher Upload pages with `<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>`, hiding the chat input, prompt chips, and upload dropzone.
- **Expected Behavior:** When no subjects are returned from the server, the frontend should fall back to the default pilot subject (`arq-software-2026` — *Arquitectura de Software (2026-1)*) so that the UI remains fully functional.
- **Recommended Fix for Coding Agent:** In `frontend/src/services/auth.js` and `frontend/src/services/subjects.api.js`, provide a fallback array containing the default subject `{ id: 'arq-software-2026', name: 'Arquitectura de Software' }` when `_subjectsCache` is empty.

#### [DEFECT-02] Admin User Allowlist View Fails to Display Configured Users
- **Location:** `frontend/src/pages/admin/UserManagement.js`
- **Observed Behavior:** Navigating to `/#/admin/users` renders an empty table (0 user rows) because the page expects `/api/admin/users` to return dynamic records, but in mock/pilot mode no static fallback is rendered.
- **Expected Behavior:** The user management view must render the full list of allowed university accounts (Lucas Vidmar, María González, Carlos Mendoza, Sofía Ramírez, Tomás Herrera, Profesor Xavier, Joaquín García, Admin Técnico) with role badges and subject scope tags.
- **Recommended Fix for Coding Agent:** Populate the default allowlist table in `UserManagement.js` with the hardcoded allowlist users defined in `auth.js` when the backend fetch is empty.

#### [DEFECT-03] Direct Navigation to `/#/login` in Dev Mode Auto-Redirects
- **Location:** `frontend/src/main.js` (`bootstrap()` and `handleRoute()`)
- **Observed Behavior:** When a tester explicitly navigates to `/#/login`, `initAuth()` in dev mode immediately sets `edu_logged_in = 'true'` and redirects the user to `/#/student/dashboard`, making it impossible to preview the public login card without manually clearing session storage.
- **Expected Behavior:** If the current route is explicitly `/#/login` and the user requested the login view (or after clicking "Cerrar sesión"), the login screen should remain visible until the user clicks "Iniciar sesión".
- **Recommended Fix for Coding Agent:** In `handleRoute()`, if `fullPath === '/login'` and `sessionStorage.getItem('edu_logged_in') === 'false'`, ensure `renderLogin()` is called without auto-redirecting.

---

### 💡 Medium / Low Priority UX Improvements

#### [UX-01] Glossary "Agregar Término" Button Event Binding
- **Location:** `frontend/src/pages/teacher/GlossaryManager.js`
- **Observed Behavior:** The "Nuevo Término" button in the glossary manager is rendered inside the table header and is sometimes not reachable if the initial glossary array is empty.
- **Expected Behavior:** Provide a prominent "Agregar Término" CTA in the empty state card as well as the main header.

#### [UX-02] Student Class Detail Audio/Podcast Summary Player
- **Location:** `frontend/src/pages/student/ClassDetail.js`
- **Observed Behavior:** The backend provides a TTS audio generation endpoint (`/api/audio-api`), but the student class detail view currently does not render an embedded HTML5 audio player widget to listen to generated class summaries.
- **Expected Behavior:** Embed an `<audio controls>` component with play/pause and playback speed controls (1x, 1.25x, 1.5x) when an audio summary is available.

#### [UX-03] SGA Grade Disputation / Inquiry Shortcut
- **Location:** `frontend/src/pages/student/Tasks.js`
- **Observed Behavior:** On `/#/student/tasks`, students can see their grades and deadlines, but there is no direct action button to "Consultar sobre esta nota con el asistente IA".
- **Expected Behavior:** Add a "Consultar con IA" button next to graded assignments that opens the chat pre-filled with: *"Hola, tengo una duda sobre la corrección del Trabajo Práctico..."*.

#### [UX-04] RAG Sandbox Default Prompt Indicator
- **Location:** `frontend/src/pages/teacher/RagSandbox.js`
- **Observed Behavior:** When executing test queries in the RAG Sandbox, if the teacher leaves the custom system prompt empty, the UI does not display the active default system prompt that was used for the generation.
- **Expected Behavior:** Display a collapsible "Ver System Prompt Activo" badge showing the exact prompt injected into the LLM.

---

## 3. Playwright Test Suite & Evidence Artifacts

The following automated and visual test artifacts have been generated in `test-report/full-audit/`:

1. `01-public-login.png` — Public login page with Microsoft SSO prompt.
2. `02-public-access-denied.png` — Access Denied 403 screen with retry/logout.
3. `03-student-dashboard.png` — Student Dashboard chat interface and prompt chips.
4. `04-student-chat-interaction.png` — Chat conversation and feedback controls.
5. `05-student-notifications.png` — Student notifications center with category filters.
6. `06-student-tasks.png` — SGA tasks and academic grading view.
7. `07-student-calendar.png` — Academic calendar with exam schedule and iCal export.
8. `08-student-settings.png` — AI assistant tone and privacy preference controls.
9. `09-student-reports.png` — Student reported discrepancy history.
10. `10-student-class-detail.png` — Class timeline and material view.
11. `11-teacher-dashboard.png` — Teacher cátedras and overview cards.
12. `12-teacher-classes.png` — Teacher class schedule and syllabus manager.
13. `13-teacher-upload.png` — Upload materials form with master source flag.
14. `14-teacher-materials.png` — Material repository and Pinecone vector status.
15. `15-teacher-corrections.png` — Teacher student feedback inbox.
16. `16-teacher-transcription-corrections.png` — Speech-to-text discrepancy review.
17. `17-teacher-glossary.png` — Domain glossary and acronym curation.
18. `18-teacher-rag-sandbox.png` — Teacher RAG query playground and chunk inspector.
19. `19-teacher-analytics.png` — Pedagogical analytics and confusion patterns.
20. `20-director-dashboard.png` — Executive KPI adoption dashboard.
21. `21-director-sat-analytics.png` — Student satisfaction analytics by prompt.
22. `22-director-interventions.png` — Early warning and at-risk student intervention panel.
23. `23-director-classes.png` — Cross-faculty class timeline oversight.
24. `24-director-subjects.png` — Subject catalog and professor assignment.
25. `25-director-compliance.png` — AI ethics and student consent compliance logs.
26. `26-admin-dashboard.png` — Technical system health, latency, and FinOps costs.
27. `27-admin-users.png` — Authorized user allowlist directory.
28. `28-admin-settings.png` — Infrastructure and Azure Key Vault configuration.
29. `29-admin-model-config.png` — LLM model selection and temperature hyperparameters.
30. `30-admin-retention.png` — Data retention policy and automated purge settings.
31. `31-admin-prompts.png` — System prompt templates and safety guardrails.
32. `32-admin-archive-usage.png` — Cold storage archive and vector pruning telemetry.
33. `33-mobile-student-dashboard.png` — Mobile responsive layout (390 × 844) with bottom navigation.
34. `comprehensive-qa-report.json` — Machine-readable test log with DOM metrics and status codes.

---

## 4. Remediation Checklist for the Coding Agent

- [ ] **Fix Subject Fallback in `auth.js` / `subjects.api.js`**: Ensure `activeSubjectId` always resolves to `arq-software-2026` when no subjects are returned by the API so that pages never enter a broken empty state.
- [ ] **Populate Allowlist in `UserManagement.js`**: Render the hardcoded list of pilot students, teachers, directors, and administrators with search and role badges when the remote API returns an empty array.
- [ ] **Refine Login Route Handling in `main.js`**: Prevent auto-redirecting to dashboard when the user explicitly requests `/#/login` or after logging out.
- [ ] **Add Audio Player to `ClassDetail.js`**: Embed an audio summary player connected to `/api/audio-api` when podcast summaries are available.
- [ ] **Add "Consultar con IA" CTA to SGA Tasks (`Tasks.js`)**: Allow students to ask the chat assistant about grading criteria directly from task cards.
- [ ] **Ensure Glossary Modal Trigger is Accessible**: Add a prominent "Agregar Término" button in both empty and populated states in `GlossaryManager.js`.
