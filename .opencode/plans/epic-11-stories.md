# Epic 11 — Post-MVP Feature Completion: Story Files

Story files to be placed in `_bmad/stories/` when permissions allow.

---

## Story 11.210: Apertura de Aula (#211)

**File:** `_bmad/stories/11-210-apertura-de-aula.md`

**Story:** As a Teacher, I want publishing a class to immediately notify enrolled students.

**ACs:**
1. ClassEditor "Aprobar y Publicar" triggers immediate notification to all enrolled students
2. Existing timer-triggered fallback remains
3. Notification includes: class title, summary-ready indicator, direct link
4. Students see notification with correct read/unread state
5. Playwright E2E test covers publish -> notification flow

**Files:** `frontend/src/pages/teacher/ClassEditor.js`, `backend/src/functions/post-class-summary-dispatcher.js`, `backend/src/services/notification-store.js`, `frontend/tests/auto-summary-notification.spec.js`

---

## Story 11.211: Tasa Fallo Seguro (#212)

**File:** `_bmad/stories/11-211-tasa-fallo-seguro.md`

**Story:** As a Director, I want to see "Tasa Fallo Seguro" metric on the dashboard.

**ACs:**
1. `GET /api/safety-rate?subjectId=X` returns aggregated error stats
2. Director dashboard card with % + trend + color-coded status
3. Teacher Analytics simplified version
4. Data from `error-categories.js` + RAG telemetry + 429 counters
5. Playwright test verifies card renders

**Files:** `backend/src/functions/analytics.js`, `backend/src/services/error-categories.js`, `frontend/src/pages/director/Dashboard.js`, `frontend/src/pages/teacher/Analytics.js`

---

## Story 11.212: Vacíos Temáticos Dashboard (#213)

**File:** `_bmad/stories/11-212-vacios-tematicos.md`

**Story:** As a Teacher, I want a dedicated "Vacíos Temáticos" view in analytics.

**ACs:**
1. New card showing intersection of high-friction topics x low coverage x high query volume
2. Color-coded severity (green/yellow/red)
3. Click-to-expand with related student queries
4. Uses existing data only — no new backend endpoint
5. Playwright test verifies gaps card

**Files:** `frontend/src/pages/teacher/Analytics.js`, `frontend/src/styles/pages.css`, `frontend/tests/teacher-alerts.spec.js`

---

## Story 11.213: Bloqueo Abuso API (#214)

**File:** `_bmad/stories/11-213-bloqueo-abuso-api.md`

**Story:** As an Administrator, I want API rate limiting and abuse blocking enforced.

**ACs:**
1. Centralized rate limiter middleware (per-user + per-IP, configurable per endpoint tier)
2. 429 responses include Retry-After header + RATE_LIMIT error category
3. Frontend shows retry countdown timer
4. Azure Front Door WAF rate limiting rule in Bicep
5. Anomalous usage detection (>100 req/hour triggers director alert)
6. Unit tests + E2E test

**Files (NEW):** `backend/src/services/rate-limiter.js`, `frontend/src/services/rag.api.js`, `frontend/src/components/ChatWidget.js`, `infra/modules/frontdoor.bicep`, `backend/src/services/anomalous-usage-alert.js`, `frontend/tests/api-rate-limit.spec.js`

---

## Story 11.214: Autoevaluación (#215)

**File:** `_bmad/stories/11-214-autoevaluacion.md`

**Story:** As a Student, I want AI-generated self-assessment quizzes from class materials.

**ACs:**
1. "Autoevaluación" tab in ClassDetail with "Generar cuestionario" button
2. Backend generates 5-10 MCQ questions from class content
3. After answering: score, correct answers, explanations, weak topics
4. Results saved per student per class (retake-capable)
5. Score >=60% = "Aprobado" with celebration; <60% = "Repasar" with recommendations
6. Playwright E2E test covers full flow

**Files (NEW):** `backend/src/functions/quiz-api.js`, `frontend/src/pages/student/ClassDetail.js`, `backend/src/services/state-store.js`, `backend/src/services/prompts.js`, `frontend/tests/autoevaluacion.spec.js`

---

## Story 11.215: Docente RAG Sandbox (#216)

**File:** `_bmad/stories/11-215-docente-rag-sandbox.md`

**Story:** As a Teacher, I want a RAG sandbox to test queries before publishing.

**ACs:**
1. New `/teacher/sandbox` page with query input, class/material multi-selector, response preview
2. Backend `POST /api/rag-query?sandbox=true` skips enrollment validation
3. "Simular alumno" toggle limits context
4. Query history per session (localStorage)
5. Token consumption warning
6. Playwright E2E test

**Files (NEW):** `frontend/src/pages/teacher/RagSandbox.js`, `frontend/src/main.js`, `backend/src/functions/rag-query.js`, `frontend/tests/rag-sandbox.spec.js`
