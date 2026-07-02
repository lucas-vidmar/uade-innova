---
title: 'Story 3.169 — Context Selection Guardrail for Large Class Batches'
type: 'feature'
created: '2026-06-18'
status: 'done'
baseline_commit: '31e7425f52969c4cfc806e9c81c3f4a20821d694'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-191-source-transparency-in-rag-responses.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a student selects too many classes (>5), the RAG context becomes diluted across too many chunks, reducing answer precision and increasing token cost per query.

**Approach:** Show a non-blocking inline warning in the class selector when the count exceeds a threshold. Sending remains permitted, but the warning explains potential loss of precision. The warning disappears automatically when selection drops back under the threshold.

## Boundaries & Constraints

**Always:**
- Threshold defaults to 5 selected classes. The constant `MAX_SELECTED_CLASSES = 5` must be defined once at the top of ChatWidget.js
- When `selectedClassIds.length > MAX_SELECTED_CLASSES`, render a `.selection-warning` div below the class chips with an icon and the text: "Seleccionaste muchas clases. La respuesta puede ser menos precisa. Deselectoná algunas para mejorar los resultados."
- Warning is non-blocking — the send button, textarea, and class toggles remain fully functional
- Warning disappears (DOM removed) when selection drops to `<= MAX_SELECTED_CLASSES`
- Warning uses a soft yellow/amber color (`--color-warning` or `#d4a72c` with light background)
- The existing empty-selection hint (`.chat-empty-hint`) is separate — both can be shown or one at a time
- All UI text in Spanish
- The guardrail must NOT modify the `sendMessage()` function behavior — sending is always allowed regardless of selection count

**Ask First:**
- Whether to also show the warning in the class selector area on the student Dashboard sidebar (not just the chat widget)

**Never:**
- Do NOT block or prevent sending when threshold is exceeded
- Do NOT add backend changes or API threshold enforcement
- Do NOT change the `classIds` array sent to the RAG endpoint
- Do NOT modify the existing empty-selection hint behavior

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Below threshold | 3 classes selected, MAX=5 | No warning shown. Normal UI. | N/A |
| Exceeds threshold | 6 classes selected (MAX=5) | Warning text + icon renders below chips. Send still enabled. | N/A |
| Drops back under | 6→4 after deselecting | Warning removed from DOM automatically via re-render | N/A |
| Exactly at threshold | 5 classes selected (MAX=5) | No warning (condition is strictly greater than) | N/A |
| Zero classes | Empty selection | Existing `.chat-empty-hint` shows, no warning shown | N/A |

</frozen-after-approval>

## Code Map

- `frontend/src/components/ChatWidget.js` — Add `MAX_SELECTED_CLASSES` constant, render `selection-warning` in `render()`, add to `selectedClassIds` click handler flow
- `frontend/src/styles/design-system.css` — Add `.selection-warning` styles (amber background, icon + text layout, margin/padding)
- `frontend/src/styles/pages.css` — If needed, add responsive overrides for `.selection-warning` on mobile

## Tasks & Acceptance

**Execution:**
- [x] `frontend/src/components/ChatWidget.js` — Add `CLASS_SELECTION_WARN_THRESHOLD = 5;`, render warning in `render()` between chips and messages, use warning icon SVG
- [x] `frontend/src/styles/design-system.css` — Add `.selection-warning` styles with amber theme using `--color-warning`
- [x] Fix typo "Deselectoná" → "Deseleccioná" (patch from review)
- [x] Rename constant from `MAX_SELECTED_CLASSES` → `CLASS_SELECTION_WARN_THRESHOLD` (clarity from review)

**Acceptance Criteria:**
- Given a student selects 6+ classes in the chat widget, when the render updates, then a non-blocking warning message appears below the class chips explaining precision may be reduced
- Given the warning is shown, when the student deselects classes to 5 or fewer, then the warning disappears from the DOM
- Given the warning is visible, when the student clicks send, then the message is sent normally (no blocking)
- Given a student has fewer than 6 classes total in the subject, when they select all of them, then no warning appears (since they cannot exceed the threshold)

## Suggested Review Order

- Entry point: threshold constant and warning rendered in the `render()` function
  [`ChatWidget.js:11`](../../frontend/src/components/ChatWidget.js#L11)
- Warning renders dynamically when `selectedClassIds.length > CLASS_SELECTION_WARN_THRESHOLD`
  [`ChatWidget.js:80`](../../frontend/src/components/ChatWidget.js#L80)
- Warning CSS with amber theme matching `--color-warning`
  [`design-system.css:268`](../../frontend/src/styles/design-system.css#L268)
