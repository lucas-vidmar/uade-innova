# Acceptance Auditor Review — Story 3.5 Source Transparency

Check for violations of acceptance criteria, rules, and principles from the spec and context docs.

## Spec File

Read `_bmad-output/implementation-artifacts/spec-3-191-source-transparency-in-rag-responses.md`

## Context Files

- `_bmad-output/implementation-artifacts/epic-3-context.md`
- `_bmad-output/implementation-artifacts/spec-3-3-report-incorrect-response.md`

## Project Access

Read the changed files:
- `backend/src/prompts/v1-baseline.md`
- `backend/src/prompts/v2-empathetic.md`
- `backend/src/functions/rag-query.js`
- `backend/src/functions/material-download.js`
- `frontend/src/services/api.js`
- `frontend/src/components/ChatWidget.js`

## Acceptance Criteria to Verify

1. **AC1**: Given a student asks a question and receives an answer with sources, when the response renders, then each `[N]` marker in the answer appears as a clickable superscript and a numbered "Fuentes" section lists each source below
2. **AC2**: Given a student clicks a superscript `[N]` or a row in the "Fuentes" list, when the source has chunk text, then a modal opens showing the full chunk text and a download button
3. **AC3**: Given the student clicks "Descargar material completo", when the material status is "ready", then the file downloads
4. **AC4**: Given the material status is not "ready", when the modal renders, then the download button is disabled with a tooltip
5. **AC5**: Given the answer has no `[N]` markers or no sources, when it renders, then no "Fuentes" section appears

## Boundaries & Constraints from Spec

- Answer text must have superscript `[N]` markers
- "Fuentes" section renders below answer listing each source
- Modal shows chunk text and download button (enabled only when status = "ready")
- Backend enumerates context with `[N]` and instructs model to cite
- Backend includes `text` + `materialId` in source objects
- Existing source chips remain
- Do NOT remove existing source chips, do NOT modify Pinecone schema, do NOT modify deduplication logic

Verify each constraint is met in the implementation.
