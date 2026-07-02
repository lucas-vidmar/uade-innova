---
title: 'Actionable Error Handling'
type: 'feature'
created: '2026-06-17'
baseline_commit: '7c4e0592868c0e327870054b4af53f11de5f9ea3'
status: 'done'
context:
  - '_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a material fails processing, teachers see only a red "Error" badge with no explanation of what went wrong, and have no way to retry.

**Approach:** Surface the error message from Table Storage in the MaterialManager table, classify errors into user-facing Spanish messages, and add a "Reintentar" button that resets status to pending and re-triggers processing.

## Boundaries & Constraints

**Always:**
- Error messages must be in Spanish, user-facing, and specific per failure type
- "Reintentar" must reset status to `pending` and trigger reprocessing via the existing blob trigger
- Must preserve partial Pinecone vectors cleanup before retry (delete vectors by materialId)
- Error messages already stored in Table Storage (`errorMessage` field) must be exposed in the material-status API response

**Ask First:**
- Error message taxonomy: the ACs define 3 canned messages, but the pipeline can fail in many ways — whether to map all errors to these 3 categories or show the raw `error.message` as fallback

**Never:**
- No new Blob Storage containers or Table Storage tables
- No changes to the processing pipeline logic itself (pipeline.js, parser.js)
- No new UI pages — only modifications to existing MaterialManager, FileUpload, and processing-notifications

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Single material error in table | status=error, errorMessage="PDF escaneado..." | Table shows red badge + error message text inline | N/A |
| Retry failed material | Click "Reintentar" on errored material | Status resets to pending, reprocessing triggered, polling picks it up | If reprocess fails, show toast with error |
| Retry while already processing | Click "Reintentar" on processing material | Button disabled, toast "El material ya está siendo procesado" | N/A |
| Batch poll discovers error | Poll returns status=error | Show error toast with specific errorMessage, not generic message | If errorMessage is empty, fallback to generic "Error al procesar" |
| Multiple errors in batch | Several materials with different errors | Each shows its own error message inline, independent retry buttons | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/functions/classes-api.js` — Add `POST /api/materials/{materialId}/reprocess` endpoint; expose `errorMessage` in material status responses
- `backend/src/services/state-store.js` — Ensure `errorMessage` is consistently read/written
- `backend/src/services/vector-store.js` — Add `deleteVectorsByMaterialId(materialId)` for cleanup before retry
- `frontend/src/pages/teacher/MaterialManager.js` — Show error message in table row; add "Reintentar" button
- `frontend/src/components/FileUpload.js` — Add retry button on errored file items
- `frontend/src/services/api.js` — Add `reprocessMaterial(materialId)` API method
- `frontend/src/services/processing-notifications.js` — Surface errorMessage in poll results
- `backend/src/functions/material-status.test.js` — Add tests for reprocess endpoint

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/vector-store.js` -- Add `deleteVectorsByMaterialId()` to clean up Pinecone vectors for a given materialId before retry
- [x] `backend/src/functions/classes-api.js` -- Add `POST /api/materials/{materialId}/reprocess` endpoint that: validates material exists & has status=error, deletes existing vectors, deletes processed blob, resets status to pending, re-uploads original blob to trigger blob trigger; expose `errorMessage` in GET material-status responses
- [x] `frontend/src/services/api.js` -- Add `reprocessMaterial(materialId)` method
- [x] `frontend/src/pages/teacher/MaterialManager.js` -- Show `errorMessage` text next to error badge; add "Reintentar" button in actions column (disabled unless status=error); wire to reprocessMaterial API; show toast on success/error
- [x] `frontend/src/services/processing-notifications.js` -- Surface `errorMessage` in terminal poll results so the error toast shows specific message
- [x] `backend/src/functions/material-status.test.js` -- Add tests: reprocess valid error material, reprocess non-error material (should fail), reprocess nonexistent material (should fail)

**Acceptance Criteria:**
- Given a material failed processing, when I view the MaterialManager table, then I see the specific error message next to the error badge
- Given a material failed processing, when I click "Reintentar", then the material re-enters processing queue and status changes to pending
- Given a material is currently processing, when I click "Reintentar", then the button is disabled and a toast explains it's already processing

## Spec Change Log



## Design Notes

Error message mapping (from pipeline failures):
- PDF parse error with "scan" or "image" in message → "PDF escaneado sin texto seleccionable. Convertilo a DOCX o usá un PDF con texto."
- Parse error with "corrupt", "damaged", "not supported" → "Archivo corrupto o formato no soportado. Verificá el archivo e intentá de nuevo."
- File size on upload → handled client-side already; pipeline should reject oversized files with "Archivo mayor a 50MB. Comprimilo o dividilo en partes."
- All other errors → show the raw errorMessage as fallback

## Verification

**Commands:**
- `cd backend && npm test` -- expected: material-status tests pass including new reprocess tests

**Manual checks:**
- Upload a file that fails processing → confirm specific error message appears in MaterialManager table
- Click "Reintentar" → confirm status changes to pending and file re-processes
- Try retrying a successful material → confirm button is disabled or action is rejected

## Suggested Review Order

**Backend — reprocess endpoint**

- New POST endpoint re-triggers pipeline for errored materials
  [`classes-api.js:1290`](../../backend/src/functions/classes-api.js#L1290)

- Validates material exists and is in error state before proceeding
  [`classes-api.js:1313`](../../backend/src/functions/classes-api.js#L1313)

- Deletes existing Pinecone vectors before re-processing to avoid duplicates
  [`classes-api.js:1323`](../../backend/src/functions/classes-api.js#L1323)

- Re-submits original blob to trigger the ingestion pipeline
  [`classes-api.js:1337`](../../backend/src/functions/classes-api.js#L1337)

- Clears processed state and resets to pending
  [`classes-api.js:1357`](../../backend/src/functions/classes-api.js#L1357)

**Backend — vector cleanup**

- New helper deletes all vectors filtered by materialId
  [`vector-store.js:225`](../../backend/src/services/vector-store.js#L225)

**Frontend — error display & retry**

- Error message shown inline below status badge in material table
  [`MaterialManager.js:166`](../../frontend/src/pages/teacher/MaterialManager.js#L166)

- Reintentar button with disabled state for non-error materials
  [`MaterialManager.js:178`](../../frontend/src/pages/teacher/MaterialManager.js#L178)

- Click handler with confirmation dialog and API wiring
  [`MaterialManager.js:494`](../../frontend/src/pages/teacher/MaterialManager.js#L494)

- Frontend API client for reprocess endpoint with error handling
  [`api.js:850`](../../frontend/src/services/api.js#L850)

**Frontend — processing notifications**

- Poll results surface specific errorMessage in toasts
  [`processing-notifications.js:44`](../../frontend/src/services/processing-notifications.js#L44)

**Tests**

- Covers missing subjectId, nonexistent material, non-error material, and happy path
  [`material-status.test.js:187`](../../backend/src/functions/material-status.test.js#L187)
