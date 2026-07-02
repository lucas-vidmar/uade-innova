# Edge Case Hunter Review — Story 3.5 Source Transparency

Review the following diff changes with read access to the project. Walk every branching path and boundary condition. Report only unhandled edge cases — report the unhandled inputs/state, the observed behavior risk, and why it matters.

## Diff Summary

**6 files changed** (+148/-6):

1. **`backend/src/prompts/v1-baseline.md` + `v2-empathetic.md`**: Replaced "No cites fuentes" with citation instruction.

2. **`backend/src/functions/rag-query.js`**: 
   - Context builder enumerates chunks with `[${n}]` prefix. The `indice` attribute now uses the enumeration index (1-based) instead of the original `chunkIndex`.
   - Sources include `text` (chunk content) and `materialId`.

3. **`backend/src/functions/material-download.js`**: New function. Gets material state, checks status, generates SAS URL from blob URL.

4. **`frontend/src/services/api.js`**: New `getMaterialDownloadUrl(subjectId, materialId)` method.

5. **`frontend/src/components/ChatWidget.js`**: 
   - `renderMarkdown()`: `[N]` → `<sup class="citation-ref">`
   - `renderMessage()`: Conditionally adds "Fuentes" section when content has `[N]` markers and sources exist
   - `showCitationModal()`: Modal with chunk text, download button
   - Citation click: Event delegation on `.citation-ref` → finds parent message → looks up source
   - Stream handler: On `done` event, dynamically adds Fuentes section

## Context Files to Read

- `_bmad-output/implementation-artifacts/spec-3-191-source-transparency-in-rag-responses.md`
- `_bmad-output/implementation-artifacts/epic-3-context.md`
- `frontend/src/components/ChatWidget.js` (full file)
- `backend/src/functions/rag-query.js` (full file)
- `backend/src/functions/material-download.js`
- `frontend/src/services/api.js` (methods)
- `backend/src/services/state-store.js` (getMaterialState)
