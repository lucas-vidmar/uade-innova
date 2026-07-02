---
title: 'Story 3.3 — Report Incorrect RAG Response'
type: 'feature'
created: '2026-06-18'
status: 'done'
baseline_commit: 'b93ac9bef66c3010d7633bfe95d0c704c92c5b6a'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students can report a bad AI answer, but the current UI uses a bare input dialog with no context of the original question or AI response, and the report button uses English text.

**Approach:** Replace the report dialog with a proper modal showing the original question (read-only) and AI response (read-only) before the student writes their feedback in a required textarea (min 10 chars). Update button labels to Spanish.

## Boundaries & Constraints

**Always:**
- Modal appears when student clicks "Reportar respuesta incorrecta" below any assistant message
- Modal shows: question (read-only), AI response (read-only), textarea labeled "¿Qué esperabas?" (required, min 10 chars), submit + cancel buttons
- Report button text: "Reportar respuesta incorrecta" (unreported state), "✅ Reportado" (reported state)
- Validation: textarea must be >= 10 chars before submit is enabled
- On submit: call existing `api.reportChatIssue({ messageId, subjectId, issueDetail })` — no new API fields
- On success: disable button, show "✅ Reportado", fire success toast
- Modal is keyboard-accessible (Escape closes, Enter submits after validation)
- Same modal pattern in both static render and streaming metadata handler

**Ask First:** None expected.

**Never:**
- Do NOT modify the backend `POST /api/chat-report-issue` function — already complete
- Do NOT modify `api.reportChatIssue()` — already complete
- Do NOT modify `showPromptDialog` in Dialog.js
- Do NOT change the correction/alert storage flow
- Do NOT add Teams notification — handled by teacher dashboard polling

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open modal | Click "Reportar respuesta incorrecta" | Modal renders with question, AI response, empty textarea | N/A |
| Submit with < 10 chars | Textarea has 3 chars, click "Enviar reporte" | Inline error: "Debe tener al menos 10 caracteres" | N/A |
| Submit valid report | Textarea has 15+ chars, click "Enviar reporte" | Button becomes "✅ Reportado", disabled, success toast | API error shown in error toast |
| Cancel report | Click "Cancelar" or X or backdrop | Modal closes, no action taken | N/A |
| Re-report after success | Already reported message | Button is disabled with "✅ Reportado" text | N/A |
| Modal close with Escape | Press Escape | Modal closes, no action | N/A |

</frozen-after-approval>

## Code Map

- `frontend/src/components/ChatWidget.js` — Replace report button text, replace `bindReportIssueEvents` with modal dialog showing question + answer context
- `frontend/src/components/Dialog.js` — No changes (use existing escapeHtml helper)

## Tasks & Acceptance

**Execution:**
- [x] `frontend/src/components/ChatWidget.js` — Change button text `⚠️ Report Issue` → `Reportar respuesta incorrecta` in `renderMessage()` and metadata handler
- [x] `frontend/src/components/ChatWidget.js` — Rewrite `bindReportIssueEvents()` with a proper modal showing question + answer context, required textarea (min 10 chars), on submit call `api.reportChatIssue()`
- [x] `frontend/src/components/ChatWidget.js` — Add min 10 chars validation with inline error, enable submit only when valid
- [x] `frontend/src/components/ChatWidget.js` — Replace inline report handler in `bindChatEvents` with `bindReportIssueEvents(container)` call

**Acceptance Criteria:**
- Given a student has received an AI response, when they click "Reportar respuesta incorrecta", then a modal appears showing their question (read-only), the AI response (read-only), and a "¿Qué esperabas?" textarea
- Given the student types fewer than 10 characters, when they click "Enviar reporte", then an inline error message appears and the report is not submitted
- Given the student types 10+ characters, when they click "Enviar reporte", then the modal closes, the button changes to "✅ Reportado", and a success toast appears
- Given the student clicks "Cancelar" or presses Escape, when the modal is open, then the modal closes without submitting
- Given a message was already reported, when the student views it, then the button is disabled with "✅ Reportado" text

## Verification

**Commands:**
- No CLI verification available — no linter configured

**Manual checks:**
- Open chat, send a message, click "Reportar respuesta incorrecta" — verify modal shows question + answer context
- Submit with short text (<10 chars) — verify validation error
- Submit valid report — verify button changes to "✅ Reportado" and toast appears
- Cancel — verify modal closes

## Suggested Review Order

**Modal UI component**

- New promise-based modal with read-only question/answer context and required textarea (min 10 chars)
  [`ChatWidget.js:440`](../../frontend/src/components/ChatWidget.js#L440)

- Min 10 chars validation with live submit toggle and inline error on failed submit
  [`ChatWidget.js:487`](../../frontend/src/components/ChatWidget.js#L487)

**Report button binding**

- Finds the assistant message and its preceding user question from `messages[]` to populate modal context
  [`ChatWidget.js:519`](../../frontend/src/components/ChatWidget.js#L519)

- Click handler calls `api.reportChatIssue()` and marks message as reported on success
  [`ChatWidget.js:522`](../../frontend/src/components/ChatWidget.js#L522)

- Inline duplicate handler replaced with shared `bindReportIssueEvents(container)` call
  [`ChatWidget.js:236`](../../frontend/src/components/ChatWidget.js#L236)

**Button label changes**

- Static render: `⚠️ Report Issue` → `Reportar respuesta incorrecta`
  [`ChatWidget.js:175`](../../frontend/src/components/ChatWidget.js#L175)

- Streaming metadata handler: same label change
  [`ChatWidget.js:352`](../../frontend/src/components/ChatWidget.js#L352)
