# Acceptance Auditor Review — Story 3.3 Report Incorrect RAG Response

You have the diff, the spec file (`_bmad-output/implementation-artifacts/spec-3-3-report-incorrect-response.md`), and read access to the project at `/Users/lucasvidmar/Documents/azure-educational-dashboard/`.

## Spec Requirements

**Acceptance Criteria (Given/When/Then):**
1. Given a student has received an AI response, when they click "Reportar respuesta incorrecta", then a modal appears showing their question (read-only), the AI response (read-only), and a "¿Qué esperabas?" textarea
2. Given the student types fewer than 10 characters, when they click "Enviar reporte", then an inline error message appears and the report is not submitted
3. Given the student types 10+ characters, when they click "Enviar reporte", then the modal closes, the button changes to "✅ Reportado", and a success toast appears
4. Given the student clicks "Cancelar" or presses Escape, when the modal is open, then the modal closes without submitting
5. Given a message was already reported, when the student views it, then the button is disabled with "✅ Reportado" text

**Boundaries & Constraints:**
- Modal must show question (read-only) and AI response (read-only)
- Textarea labeled "¿Qué esperabas?" (required, min 10 chars)
- Submit + cancel buttons
- On submit: call `api.reportChatIssue({ messageId, subjectId, issueDetail })`
- Must work in both static render and streaming metadata handler

**Never:**
- Do NOT modify backend POST /api/chat-report-issue
- Do NOT modify api.reportChatIssue()
- Do NOT modify Dialog.js

## Verify
Check each AC against the diff. Report any violations.
