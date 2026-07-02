# Epic 11 Context: Post-Test Quality Remediation

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Remediate 40 PARTIAL/FAIL items identified in a Playwright audit of 54 use cases across 3 roles (student, teacher, director). Elevate all 31 PARTIAL items to PASS and implement all 9 FAIL items so the full test suite passes.

## Stories (Sub-Epic 11.1 — Chat & Feedback Infrastructure)

- 11.1.1: Persistent AI Consent Across Sessions
- 11.1.2: "Reportar Respuesta Incorrecta" Button in ChatWidget
- 11.1.3: Thumbs-Up/Down Feedback Always Visible
- 11.1.4: Report Material Mismatch / Missing Info from Chat
- 11.1.5: Chat Query About Weekly Deadlines
- 11.1.6: Glossary Lookup from Chat

## Requirements & Constraints

- All chat features must work after the AI consent flow is resolved (11.1.1 is a prerequisite for the sub-epic)
- ChatWidget is the single UI component for student chat interactions
- RAG pipeline uses DeepSeek V4 Flash (via Azure AI Services) with Pinecone vector search
- Backend endpoints are Azure Functions (Node.js 20, Consumption Plan)
- Frontend is vanilla JS/HTML SPA hosted on Azure Static Web Apps
- Dark-first glassmorphism design system (Montserrat, 4px grid)
- All API contracts defined in AGENTS.md §11

## Technical Decisions

- localStorage is used for client-side consent persistence with backend fallback
- ChatWidget renders each message bubble as a self-contained DOM element with its own feedback controls
- Thumbs-up/down and report buttons are rendered inside the assistant message bubble
- The report-incorrect endpoint is `POST /api/report-incorrect`
- Feedback is sent to `POST /api/feedback` (thumbs) and `POST /api/report-missing-info`
- Deadline queries require RAG prompt augmentation with task data from `GET /api/tasks`
- Glossary lookups require a `GET /api/glossary?subjectId={id}&term={term}` endpoint

## UX & Interaction Patterns

- Dark mode default with CSS variables (`--bg-base: #061B2C`)
- Montserrat typography throughout
- Glassmorphism surfaces with backdrop blur
- Micro-animations at 0.2s cubic-bezier
- Toast notifications for feedback confirmation
- Modal dialogs for report forms and consent
- Each assistant response bubble includes: response text, source citations, thumbs-up/down, report buttons

## Cross-Story Dependencies

- 11.1.1 (Consent) must be implemented first — all other chat features depend on consent being resolved
- 11.1.2 (Report button) and 11.1.3 (Thumbs) are independent of each other
- 11.1.5 (Deadline queries) depends on the task API working with the RAG pipeline
- 11.1.6 (Glossary) depends on a glossary data source existing per subject
