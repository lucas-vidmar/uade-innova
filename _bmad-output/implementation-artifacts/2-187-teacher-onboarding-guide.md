---
baseline_commit: 7c4e059b7af8a54b7f51e48aebda59ec9d7fcfb3
---

# Story 2.187: Teacher Onboarding Guide

Status: done

## Story

As a teacher using the platform for the first time,
I want a guided tour of the upload, correction, glossary, and priority features,
so that I can confidently prepare materials for my class without confusion.

## Acceptance Criteria

### AC1: First-Login Detection
- **Given** I am a teacher logging in for the first time
- **When** the teacher dashboard finishes rendering
- **Then** the system checks localStorage key `onboarding-teacher-completed`
- **And** if absent or `false`, the onboarding overlay is triggered

### AC2: Step-by-Step Overlay
- **Given** onboarding is triggered
- **When** the overlay appears
- **Then** it shows 4 sequential steps with a progress indicator (1/4, 2/4, etc.):
  1. "Acá podés ver tus materias y clases. Cada clase muestra el estado de sus materiales."
     - Arrow pointing to the cronograma section / class list area
  2. "Clickeá 'Cargar materiales' para subir transcripciones, presentaciones, apuntes o bibliografía."
     - Arrow pointing to the "Cargar Materiales" sidebar link or upload button
  3. "Revisá las transcripciones automáticas en 'Correcciones de Transcripción'. El sistema sugiere correcciones basadas en el glosario técnico."
     - Arrow pointing to the transcription corrections sidebar link
  4. "Configurá la prioridad de tus materiales desde 'Gestión de Materiales' para que el chat use primero los mejores recursos."
     - Arrow pointing to materials management section
- **And** each step has a "Siguiente" button, except the last which has "Entendido"

### AC3: Overlay Interaction
- **Given** I am viewing step N of the onboarding
- **When** I click "Siguiente"
- **Then** the overlay transitions to step N+1 with a fade animation (0.2s cubic-bezier)
- **Given** I click "Entendido" on the final step
- **When** the overlay closes
- **Then** `localStorage.setItem('onboarding-teacher-completed', 'true')` is set
- **And** the tour does not appear on subsequent logins

### AC4: Skip & Dismiss
- **Given** the onboarding overlay is visible
- **When** I click a close (X) button or press Escape
- **Then** the overlay closes immediately
- **And** `localStorage.setItem('onboarding-teacher-completed', 'true')` is NOT set (can be re-triggered)
- **And** a toast message appears: "Podés volver a ver esta guía desde el menú de ayuda."

### AC5: Manual Re-Trigger
- **Given** I have completed or dismissed onboarding
- **When** I click "Ayuda" → "Guía de inicio" in the sidebar or header
- **Then** the onboarding overlay re-appears from step 1
- **And** completing it again sets the localStorage flag again

### AC6: Responsive Layout
- **Given** the onboarding overlay is visible on mobile (< 640px width)
- **When** I view it
- **Then** the overlay takes full screen with the step content centered
- **And** arrows are replaced with highlighted section names (no positional arrows on mobile)
- **Given** the onboarding overlay is visible on desktop (> 1024px width)
- **When** I view it
- **Then** the overlay is a centered modal with semi-transparent backdrop
- **And** each step includes a positional arrow pointing to the relevant UI element

## Tasks / Subtasks

### Phase 1: Onboarding Engine (Shared Service)
- [x] Create `frontend/src/services/onboarding.js` — reusable onboarding engine with step management, progress tracking, localStorage persistence (AC1, AC3, AC4, AC5)
  - `startOnboarding(role, steps, onComplete)` — initiates tour for any role
  - `isOnboardingCompleted(role)` — checks localStorage flag
  - `markOnboardingCompleted(role)` — persists flag
  - `resetOnboarding(role)` — clears flag for re-trigger
  - `dismissOnboarding(role)` — dismisses without marking complete
  - Steps array: `{ id, title, description, targetSelector?, position? }`

### Phase 2: Teacher-Specific Steps
- [x] Define the 4-step teacher onboarding sequence in `frontend/src/pages/teacher/OnboardingSteps.js` (AC2)
  - Step 1: target `#teacher-dashboard` → cronograma section
  - Step 2: target `#teacher-upload` → sidebar upload link
  - Step 3: target `#teacher-transcription-corrections` → sidebar corrections link
  - Step 4: target `#teacher-materials` → sidebar materials link
- [x] Each step includes: title, description, target element selector, arrow position (top/bottom/left/right), and optional highlight class

### Phase 3: Onboarding UI Component
- [x] Create `frontend/src/components/OnboardingOverlay.js` — modal overlay with step rendering, progress dots, navigation buttons, arrow indicators (AC2, AC3)
  - Semi-transparent backdrop with z-index above all content
  - Highlighted target element via CSS class (bright border, no pointer events blockage)
  - Step card with title, description, arrow pointing to target
  - Progress indicator: "Paso X de Y" with dot indicators
  - Navigation: "Siguiente" (primary) / "Cerrar" (ghost) / "Entendido" on last step
  - Emits `onboarding:step-changed` and `onboarding:completed` CustomEvents
  - Handles Escape key press for dismiss (AC4)
  - Responsive: full-screen on mobile, modal on desktop (AC6)
  - Animations: fade transition between steps (0.2s cubic-bezier), slide-in entrance
- [x] Create onboarding overlay CSS in `frontend/src/styles/components.css` — overlay, step card, arrow, progress indicators styling
  - Dark backdrop: `rgba(6, 27, 44, 0.85)` with backdrop-filter blur
  - Step card: `--surface-1` background, `--radius-lg`, elevation shadow
  - Arrow: pseudo-element triangle pointing to target
  - Mobile: full screen overlay, no arrows
  - Desktop: centered card with backdrop and calculated arrow position

### Phase 4: Integration in Teacher Dashboard
- [x] `frontend/src/pages/teacher/Dashboard.js` — after dashboard renders, call `startOnboarding('teacher', teacherSteps)` if not completed (AC1)
- [x] Add "Guía de inicio" link in sidebar or teacher header that calls `resetOnboarding('teacher')` and re-triggers the tour (AC5)
- [x] `frontend/src/main.js` — no route changes needed (overlay is dashboard-triggered)

### Phase 5: Styling
- [x] Create onboarding overlay CSS in `frontend/src/styles/components.css` as specified in Phase 3
- [x] Add CSS class `.onboarding-highlight` for target element highlight effect (bright 2px accent border, subtle glow)

### Phase 6: Student Onboarding Preparation
- [x] Define `frontend/src/pages/student/OnboardingSteps.js` with placeholder steps (will be implemented in Story 3.6)
  - 4 steps matching the student journey: class selection, chat, sources, report
- [ ] Export steps array and metadata so student onboarding is ready for hook-in

## Dev Notes

### Relevant Architecture Patterns and Constraints

**Backend (none for this story):**
- This story is 100% frontend — no new Azure Functions, no database changes, no API endpoints
- All state is client-side via `localStorage`

**Frontend:**
- **Stack:** Vanilla JS (no React/Vue/Svelte), Vite 5.4.2, ESM modules
- **Design system:** Dark-first glassmorphism (`--bg-base: #061B2C`, `--surface-1: #0C253B`, etc.)
- **Typography:** Montserrat, 4px grid
- **Component pattern:** Each component is a class/function in its own file, manages its own DOM, emits `CustomEvent`s
- **Navigation:** Hash-based routing (`#/teacher/...`), defined in `frontend/src/main.js`
- **API client:** `frontend/src/services/api.js` — centralized fetch wrapper with auth headers
- **Colors:** `--color-accent: #0077AB`, `--text-primary: #f1f5f9`, `--text-secondary: #94a3b8`
- **Animations:** `all 0.2s cubic-bezier(0.4, 0, 0.2, 1)` default transition
- **Spacing:** 4px base grid, `--space-3` (12px), `--space-4` (16px), `--space-6` (24px)
- **Radii:** `--radius-md` (10px) for buttons, `--radius-lg` (16px) for cards/modals

### Source Tree Components to Touch

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/services/onboarding.js` | **NEW** | Reusable onboarding engine service |
| `frontend/src/pages/teacher/OnboardingSteps.js` | **NEW** | Teacher-specific 4-step definition |
| `frontend/src/pages/student/OnboardingSteps.js` | **NEW** | Placeholder student steps (for Story 3.6) |
| `frontend/src/components/OnboardingOverlay.js` | **NEW** | Modal overlay UI component |
| `frontend/src/pages/teacher/Dashboard.js` | **UPDATE** | Hook onboarding trigger after render |
| `frontend/src/components/Sidebar.js` | **UPDATE** | Add "Guía de inicio" link to teacher nav |
| `frontend/src/styles/components/onboarding-overlay.css` | **NEW** | Overlay, step card, arrow styling |
| `frontend/src/styles/base.css` | **UPDATE** | Add `.onboarding-highlight` utility class |

### Onboarding Engine API Design

```javascript
// onboarding.js
const STORAGE_KEY_PREFIX = 'onboarding-';

export function isOnboardingCompleted(role) {
  return localStorage.getItem(`${STORAGE_KEY_PREFIX}${role}-completed`) === 'true';
}

export function markOnboardingCompleted(role) {
  localStorage.setItem(`${STORAGE_KEY_PREFIX}${role}-completed`, 'true');
}

export function dismissOnboarding(role) {
  // does NOT set completion flag — allows re-trigger
}

export function resetOnboarding(role) {
  localStorage.removeItem(`${STORAGE_KEY_PREFIX}${role}-completed`);
}

export function startOnboarding({ role, steps, container }) {
  if (isOnboardingCompleted(role)) return;
  const overlay = new OnboardingOverlay({ steps, container });
  overlay.on('completed', () => markOnboardingCompleted(role));
  overlay.on('dismissed', () => dismissOnboarding(role));
  overlay.start();
}
```

### OnboardingOverlay State Machine

```
IDLE → (startOnboarding) → STEP_1 → (Siguiente) → STEP_2 → ... → STEP_N → (Entendido) → COMPLETED → IDLE
                                                                      → (X / Escape) → DISMISSED → IDLE
```

### Previous Story Intelligence

From story 2-186 (transcription correction):
- **Pattern confirmed:** Co-located tests (`.test.js`) with source code
- **Pattern confirmed:** Vanilla JS with `CustomEvent` for component communication
- **API response format:** All endpoints follow `{ success, data/error, meta }` pattern
- **LocalStorage seeding:** Tests use `page.addInitScript()` for seeded data
- **Toast system:** `frontend/src/components/Toast.js` supports `details` array parameter
- **Callback pattern:** Async/await with try/catch throughout
- **Function registration:** All functions imported statically in `backend/src/index.js`

### Git Intelligence Summary

Recent commits focus on CI pipeline migration (publish profile → azd deploy with RBAC).
No backend changes needed for this story. Frontend development can be verified locally with `npm run dev`.

### Testing Standards

- **Frontend E2E:** Playwright tests for onboarding overlay rendering, step navigation, localStorage state
- **Key test scenarios:**
  - `onboarding-teacher-completed` flag set after completing all 4 steps
  - Onboarding does not appear if flag is set
  - Escape key dismisses without setting flag
  - "Guía de inicio" re-triggers onboarding
  - Responsive: verify overlay is full-screen on mobile viewport
  - 4 steps render in correct order with correct content

### Project Structure Notes

- New files follow kebab-case naming convention
- Onboarding service goes in `frontend/src/services/` (shared service pattern)
- Onboarding steps data goes in `frontend/src/pages/teacher/` (domain-specific)
- Overlay component goes in `frontend/src/components/` (reusable UI)
- CSS follows the pattern used by existing components (one file per component in `frontend/src/styles/components/`)
- The onboarding engine is designed to be reused for student onboarding (Story 3.6) — the role parameter and steps array make it generic

### Placeholder for Student Onboarding (Story 3.6)

```javascript
// frontend/src/pages/student/OnboardingSteps.js
export const STUDENT_ONBOARDING_STEPS = [
  { id: 'select-classes', title: 'Seleccioná tus clases', description: 'Elegí las clases sobre las que querés consultar en el panel lateral.', target: '#class-selector' },
  { id: 'ask-questions', title: 'Preguntá en lenguaje natural', description: 'Escribí tu pregunta como si hablaras con un profesor.', target: '#chat-input' },
  { id: 'check-sources', title: 'Revisá las fuentes', description: 'Cada respuesta incluye referencias al material original.', target: '#source-citations' },
  { id: 'report-issues', title: 'Reportá respuestas incorrectas', description: 'Si una respuesta no es precisa, reportala para que el docente la corrija.', target: '#report-button' },
];
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#story-26] — Story 2.6 ACs (lines 432-450)
- [Source: _bmad-output/planning-artifacts/prd.md#1-authentication--authorization] — FR5 (terms acceptance pattern)
- [Source: _bmad-output/planning-artifacts/ux-design.md#22-typography] — Design tokens for overlay styling
- [Source: _bmad-output/planning-artifacts/ux-design.md#24-motion] — Animation timing (0.2s cubic-bezier)
- [Source: _bmad-output/planning-artifacts/architecture.md#41-new-components-for-correction-workflows] — Component pattern (Vanilla JS, own DOM, CustomEvents)
- [Source: _bmad-output/planning-artifacts/architecture.md#rateg3-loading-states-frontend] — Loading/state management patterns
- [Source: _bmad-output/project-context.md#5-critical-implementation-rules] — Code conventions, naming, CSS variables
- [Source: frontend/src/components/Sidebar.js] — Existing nav link pattern to follow for "Guía de inicio"
- [Source: frontend/src/pages/teacher/Dashboard.js] — Existing teacher dashboard where onboarding triggers
- [Source: frontend/src/services/onboarding.js] — NEW: onboarding engine pattern (designed for reuse)
- [Source: frontend/src/styles/base.css] — Where `.onboarding-highlight` utility class goes

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

- `frontend/src/services/onboarding.js`
- `frontend/src/pages/teacher/OnboardingSteps.js`
- `frontend/src/pages/student/OnboardingSteps.js`
- `frontend/src/components/OnboardingOverlay.js`
- `frontend/src/styles/components/onboarding-overlay.css`
- `frontend/src/pages/teacher/Dashboard.js` (UPDATE)
- `frontend/src/components/Sidebar.js` (UPDATE)
- `frontend/src/styles/base.css` (UPDATE)

## Suggested Review Order

**Onboarding engine — state management & persistence**

- Singleton guard prevents duplicate overlays; role-aware storage keys isolate teacher/student state
  [`onboarding.js:5`](../../frontend/src/services/onboarding.js#L5)
- Toast via direct import (not CustomEvent) ensures AC3/AC4 completion/dismiss messages display reliably
  [`onboarding.js:1`](../../frontend/src/services/onboarding.js#L1)
- try-catch wrapper around localStorage prevents DOMException crashes in restricted browsing modes
  [`onboarding.js:14`](../../frontend/src/services/onboarding.js#L14)
- Debounce guard on next()/prev() prevents race from rapid clicks skipping steps
  [`onboarding.js:62`](../../frontend/src/services/onboarding.js#L62)

**Overlay UI component — step rendering & positioning**

- Step card with progress indicator, navigation buttons, and keyboard (Escape/arrows) support
  [`OnboardingOverlay.js:54`](../../frontend/src/components/OnboardingOverlay.js#L54)
- Viewport-aware tooltip positioning with 4-directional arrow support and mobile-aware target selector
  [`OnboardingOverlay.js:88`](../../frontend/src/components/OnboardingOverlay.js#L88)
- Backdrop click dismisses tour; empty-steps guard prevents orphan tooltips
  [`OnboardingOverlay.js:15`](../../frontend/src/components/OnboardingOverlay.js#L15)
- Mobile target selectors fix element highlight on phones (targetSelectorMobile)
  [`OnboardingOverlay.js:132`](../../frontend/src/components/OnboardingOverlay.js#L132)

**Step definitions — teacher + student tours**

- 4-step teacher onboarding pointing to sidebar nav items with icons and mobile selectors
  [`OnboardingSteps.js:22`](../../frontend/src/pages/teacher/OnboardingSteps.js#L22)
- Placeholder student steps ready for Story 3.6 hook-in
  [`OnboardingSteps.js:4`](../../frontend/src/pages/student/OnboardingSteps.js#L4)

**Dashboard & Sidebar integration — trigger & re-trigger**

- First-login trigger via requestAnimationFrame after dashboard render
  [`Dashboard.js:205`](../../frontend/src/pages/teacher/Dashboard.js#L205)
- "Guía de inicio" button in desktop sidebar and mobile bottom nav with re-trigger
  [`Sidebar.js:259`](../../frontend/src/components/Sidebar.js#L259)

**Styles — overlay, tooltip arrows, highlight**

- Semi-transparent backdrop with blur, tooltip card, step indicator, navigation buttons
  [`components.css:809`](../../frontend/src/styles/components.css#L809)
- Arrow pseudo-elements for 4-directional positioning with responsive breakpoints
  [`components.css:964`](../../frontend/src/styles/components.css#L964)
- `.onboarding-highlight` utility class for target element glow effect
  [`globals.css:332`](../../frontend/src/styles/globals.css#L332)
- `.left-nav-divider` and `.left-nav-link--help` / `.mobile-bottom-link--help` styling
  [`pages.css:134`](../../frontend/src/styles/pages.css#L134)
