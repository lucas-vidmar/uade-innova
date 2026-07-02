---
title: 'Story 3.6 — Student Onboarding Guide'
type: 'feature'
created: '2026-06-18'
status: 'done'
baseline_commit: '9309705cb434281f6b275c833794c998c109391a'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-191-source-transparency-in-rag-responses.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students accessing the chat for the first time have no guidance on how to use class selection, ask questions, verify sources, or report issues. This leads to confusion and underutilization of the RAG system.

**Approach:** Show a 4-step guided tour overlay when a student opens the chat for the first time. Each step highlights a key UI area with a tooltip. On completion, store a flag in localStorage so the tour does not replay.

## Boundaries & Constraints

**Always:**
- Tour triggers automatically on first chat access (Student Dashboard render) when localStorage key `onboarding-student-completed` is not `"true"`
- 4 steps: (1) Select class via `#global-course-btn`, (2) Write question in `.chat-input`, (3) Check sources in `.chat-sources-bar`, (4) Report issues via `.report-issue-btn`
- Each step renders a semi-transparent overlay + floating tooltip with step indicator, title, description, icon, and navigation buttons
- Last step button reads "Entendido" and marks onboarding as completed
- Onboarding state stored as localStorage `onboarding-student-completed=true` via existing `markOnboardingCompleted('student')`
- Uses existing OnboardingEngine and OnboardingOverlay components
- Uses existing STUDENT_ONBOARDING_STEPS definition (with corrected selectors)
- Tour can be dismissed via Escape key, click-outside backdrop, or close button — marks as dismissed (not completed)
- "Guía de inicio" button in the student sidebar nav allows re-triggering via `resetOnboarding('student')`
- All text in Spanish
- Keyboard accessible: Escape to dismiss, ArrowRight/Enter to advance, ArrowLeft to go back

**Ask First:**
- Whether to add an explicit "Volver a ver guía" button somewhere in the chat area header (in addition to the sidebar)

**Never:**
- Do NOT modify OnboardingEngine or OnboardingOverlay core logic
- Do NOT add backend endpoints or database tables
- Do NOT change teacher onboarding flow
- Do NOT make the tour blocking (user must be able to interact with the underlying UI)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First access — student | `onboarding-student-completed` not in localStorage | 4-step tour starts on next animation frame | N/A |
| Returning student | `onboarding-student-completed=true` in localStorage | No tour overlay appears | N/A |
| Student completes tour | Clicks "Entendido" on step 4 | `markOnboardingCompleted('student')` called, overlay removed, success toast shown | N/A |
| Student dismisses tour | Presses Escape or clicks backdrop | `skip()` called, overlay removed, dismiss toast shown, NOT marked as completed | N/A |
| Tour step target not found | `#global-course-btn`, `.chat-input`, etc. missing from DOM | Tour proceeds to next step gracefully — OnboardingOverlay renders tooltip without highlight | N/A |
| Mobile viewport | Width < 640px | Tooltip renders as bottom sheet (existing mobile behavior) | N/A |
| Student re-triggers | Clicks "Guía de inicio" in sidebar | `resetOnboarding('student')` + new OnboardingEngine starts | N/A |

</frozen-after-approval>

## Code Map

- `frontend/src/pages/student/OnboardingSteps.js` — Fix target selectors for steps 3 and 4 (`.sources-panel` → `.chat-sources-bar`, `.report-btn` → `.report-issue-btn`)
- `frontend/src/pages/student/Dashboard.js` — Import OnboardingEngine and STUDENT_ONBOARDING_STEPS; add trigger after chat widget mounts
- `frontend/src/components/Sidebar.js` — Add "Guía de inicio" button for student role that resets and starts student onboarding

## Tasks & Acceptance

**Execution:**
- [x] `frontend/src/pages/student/OnboardingSteps.js` — Fix step 3 targetSelector from `.sources-panel` to `.chat-sources-bar` and step 4 from `.report-btn` to `.report-issue-btn`
- [x] `frontend/src/pages/student/Dashboard.js` — Import `{ OnboardingEngine, isOnboardingCompleted }` from `../../services/onboarding.js` and `{ STUDENT_ONBOARDING_STEPS }` from `./OnboardingSteps.js`; add `requestAnimationFrame` trigger after chat widget mount (line ~434) following teacher Dashboard.js pattern
- [x] `frontend/src/components/Sidebar.js` — In the student role section, add a "Guía de inicio" nav item that calls `resetOnboarding('student')` and starts a new `OnboardingEngine`

**Acceptance Criteria:**
- Given a student accessing the chat for the first time, when the Student Dashboard renders, then a 4-step guided tour overlay appears
- Given the student advances through all 4 steps, when they click "Entendido" on the last step, then the tour closes and `onboarding-student-completed=true` is stored in localStorage
- Given a returning student with the localStorage flag set, when they access the chat, then no tour appears
- Given a student clicks "Guía de inicio" in the sidebar, when the onboarding was previously completed, then the flag resets and the tour starts again

## Verification

**Commands:**
- `npm run lint:frontend` — expected: no errors
- `npm run build:frontend` — expected: builds successfully

**Manual checks:**
- Clear localStorage, open Student Dashboard, verify 4-step tour appears
- Verify each step highlights the correct UI element (course selector, chat input, sources bar, report button)
- Complete tour, reload page, verify tour does not replay
- Dismiss with Escape, reload, verify tour replays
- Click "Guía de inicio" in sidebar, verify tour restarts

## Suggested Review Order

**Entry point — onboarding trigger**

- Auto-starts the 4-step tour when the student dashboard renders for the first time, guarded by localStorage + AI consent check
  [`Dashboard.js:437`](../../frontend/src/pages/student/Dashboard.js#L437)

**Tour steps definition**

- Fixes step 3 and 4 selectors to match actual DOM classes in the chat widget (`.chat-sources-bar`, `.report-issue-btn`)
  [`OnboardingSteps.js:27`](../../frontend/src/pages/student/OnboardingSteps.js#L27)

**Sidebar re-trigger button**

- Reuses the existing "Guía de inicio" pattern (desktop + mobile nav) for students, with dynamic role-based IDs
  [`Sidebar.js:84`](../../frontend/src/components/Sidebar.js#L84)

- Event binding calls `resetOnboarding('student')` + creates a new `OnboardingEngine` with student steps
  [`Sidebar.js:261`](../../frontend/src/components/Sidebar.js#L261)
