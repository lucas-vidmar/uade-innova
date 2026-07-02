---
title: 'Story 3.5 — Source Transparency in RAG Responses'
type: 'feature'
created: '2026-06-18'
status: 'done'
baseline_commit: '7aea4ec97d2d0f74a9c30b71b39e0d2b2e20a1f6'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3-report-incorrect-response.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students see source chips below each answer but cannot tell which specific chunk backs each claim. The chunk text itself is invisible, and there is no way to download the full material for verification.

**Approach:** Add superscript citation numbers `[N]` in the answer text linked to a numbered "Fuentes" section below. Clicking a citation opens a modal with the full chunk text and a download button for the source material.

## Boundaries & Constraints

**Always:**
- Answer text must have superscript `[N]` markers where N = 1-based index of the source in the response
- A "Fuentes" section renders below each answer listing `[N] materialType — sourceFilename (chunk N)` with a colored material type badge
- Clicking `[N]` in the answer OR in the Fuentes list opens a modal showing: chunk index, material type, source filename, full chunk text, and a "Descargar material completo" button (enabled only when status = "ready")
- Backend enumerates context chunks with `[N]` labels in the system prompt and instructs the model to cite using those labels
- Backend includes `text` (chunk content) and `materialId` in each source object returned to frontend
- Backend provides `GET /api/materials/{materialId}/download` returning `{ downloadUrl, filename, status }`
- System prompts: replace "No cites fuentes en el texto de la respuesta" with citation instruction
- Existing source chips below the answer remain as a visual supplement
- All UI text in Spanish
- Modal is keyboard-accessible (Escape closes, click outside closes)

**Ask First:**
- Whether to include `text` in the streaming metadata event response (payload size increase of ~5000 tokens per response) or fetch chunk text via a separate endpoint on demand

**Never:**
- Do NOT remove or replace the existing source chips
- Do NOT change the blocking vs streaming mode contract
- Do NOT modify the Pinecone schema or re-index data
- Do NOT modify the source deduplication logic

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Answer has `[1]`, `[2]` markers | Markers rendered as superscript links; Fuentes section shows 2 sources; click opens modal with chunk text | N/A |
| No citations in answer | Answer has no `[N]` markers | No superscript links; "Fuentes" row hidden if no matching sources | N/A |
| No sources returned | Backend returns `sources: []` | No "Fuentes" section; no citation markers expected | N/A |
| Click citation | Click `[1]` in answer or Fuentes list | Modal opens with chunk text, material type, filename, download button | If `text` is empty, modal shows chunk text unavailable |
| Download material | Click "Descargar material completo" | Triggers download via `/api/materials/{id}/download` | Toast on error: "No se pudo descargar el material" |
| Download when status != ready | material status is pending/processing | Download button is disabled with tooltip "Material aún no disponible" | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/prompts/v1-baseline.md` — Replace "No cites fuentes" with citation instruction
- `backend/src/prompts/v2-empathetic.md` — Same update as v1
- `backend/src/functions/rag-query.js` — Enumerate context with `[N]`, add `text` + `materialId` to source objects (stream + blocking)
- `backend/src/functions/material-download.js` — New function: GET `/api/materials/{materialId}/download`
- `frontend/src/components/ChatWidget.js` — Render `[N]` citations as superscript links, add "Fuentes" section, add citation modal with chunk text & download
- `frontend/src/services/api.js` — Add `getMaterialDownloadUrl()` client method

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/prompts/v1-baseline.md` + `v2-empathetic.md` — Replace "No cites fuentes en el texto de la respuesta" with: `- Cita las fuentes usando [N] donde N es el numero del chunk listado en <contexto_rag>.`
- [x] `backend/src/functions/rag-query.js` — In the context builder (line ~454), add `[N]` index to each chunk header: `<chunk indice="1" archivo="..." ...>`
- [x] `backend/src/functions/rag-query.js` — Add `text: m.metadata?.text` and `materialId: m.metadata?.materialId` to source objects in stream (line ~494-502) and blocking (line ~644-652) modes
- [x] `backend/src/functions/material-download.js` — New Azure Function: `GET /api/material-download` that returns `{ downloadUrl, filename, status }` by looking up material in state-store and generating a SAS URL from blob storage
- [x] `frontend/src/services/api.js` — Add `getMaterialDownloadUrl(subjectId, materialId)` calling the new endpoint
- [x] `frontend/src/components/ChatWidget.js` — Update `renderMarkdown()` to parse `[N]` citation markers into `<sup>` clickable links
- [x] `frontend/src/components/ChatWidget.js` — Update `renderMessage()` to append a "Fuentes" section below the answer, hidden when no sources or no citations
- [x] `frontend/src/components/ChatWidget.js` — Implement `showCitationModal(source)` modal with chunk text, material info, and download button; event delegation for `.citation-ref` clicks
- [x] `frontend/src/components/ChatWidget.js` — In stream handler (`sendMessage`), preserve new fields (text, materialId) from metadata sources; add Fuentes section on done event when content has [N] markers

**Acceptance Criteria:**
- Given a student asks a question and receives an answer with sources, when the response renders, then each `[N]` marker in the answer appears as a clickable superscript and a numbered "Fuentes" section lists each source below
- Given a student clicks a superscript `[N]` or a row in the "Fuentes" list, when the source has chunk text, then a modal opens showing the full chunk text and a download button
- Given the student clicks "Descargar material completo", when the material status is "ready", then the file downloads
- Given the material status is not "ready", when the modal renders, then the download button is disabled with a tooltip
- Given the answer has no `[N]` markers or no sources, when it renders, then no "Fuentes" section appears

## Verification

**Manual checks:**
- Open chat, send a question, verify answer has superscript `[N]` links and "Fuentes" section below
- Click each citation — verify modal opens with correct chunk text
- Verify download button state (enabled/disabled) based on material status
- Verify Escape key closes the modal
- Verify no "Fuentes" section when answer has no citations or empty sources
