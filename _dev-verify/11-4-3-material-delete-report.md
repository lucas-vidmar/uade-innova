# Epic 11 / Story 11.4.3 — Material Delete Confirmation and Cascade

**GitHub issue:** #279 (`feat(teacher): Soft-delete material blobs to deleted/ container (30-day retention)`) — CLOSED.
**Branch (worktree):** `lucas-vidmar/w11-4-3-material-delete` (unmerged, for coordinator review).

## What was implemented

The delete confirmation dialog + cascade (Pinecone vectors + state + blob) was already shipped under
#224. This story closes the remaining gap and hardens the UX to match the ACs.

### Backend — soft-delete to `deleted/` (30-day retention)
- `backend/src/services/storage.js`: new `moveBlob(sourceContainer, sourceBlobName, destContainer, destBlobName)`
  — copies the blob (preserving content-type + metadata) to the destination, then deletes the source.
  Returns `false` when the source blob does not exist (no-op).
- `backend/src/functions/classes-api.js` (`delete-material` handler):
  - Looks up the material state for `chunkCount`, attribution (quota release), and blob location.
  - **Moves** the original file blob (`class-materials/{subjectId}/{materialId}{ext}`) to `deleted/`.
  - **Moves** the processed JSON (`processed/{materialId}.json`) to `deleted/` (previously hard-deleted).
  - Derives the original blob name from `blobUrl` or falls back to the pipeline pattern `{subjectId}/{materialId}{ext}`.
  - Still deletes Pinecone vectors (`deleteVectorsByFilter materialId`) + material state, and releases the teacher's upload quota.
  - Returns `{ success, softDeleted: [...], chunkCount }` so the frontend can show the removed chunk count.

### Infra — `deleted/` container + 30-day lifecycle
- `infra/modules/storage.bicep`: new `deleted` container + lifecycle rule `DeleteDeletedMaterialsAfter30Days`
  (purge blobs under `deleted/` after 30 days). Applied **live** to `stdashboardq47bia47kk3na`.

### Frontend — confirmation dialog with required checkbox
- `frontend/src/components/Dialog.js`: `showConfirmDialog` gains `confirmCheckbox` support — an optional
  checkbox that, when present, keeps the danger confirm button `disabled` until checked.
- `frontend/src/pages/teacher/MaterialManager.js`: delete dialog now shows
  - filename, material type (label), associated classes (by title, not ID), status,
  - exact warning: `Se eliminarán [N] chunks del índice vectorial. Los alumnos perderán acceso a este contenido.`
  - note that the file moves to a 30-day retention zone (soft-delete),
  - buttons `Cancelar` / `Eliminar definitivamente` (red, requires the confirmation checkbox).
  - Fetches a fresh `chunkCount` via `getMaterialStatus` when possible; shows the removed count in the success toast.
- `frontend/src/styles/design-system.css`: `.dialog-checkbox-row` + `.dialog-checkbox-label` styles.

## Verification

### Tests
- Backend `npm test` → **830 / 830 pass**, including 3 new tests:
  - `classes-api.test.js`: soft-delete moves blobs to `deleted/` and reports `chunkCount` (12).
  - `classes-api.test.js`: legacy fallback derives blob name from `subjectId/materialId + ext`.
  - `storage.moveblob.test.js`: copies content+metadata, deletes source; returns `false` when missing.
- Frontend `vite build` → OK (no lint/typecheck script defined beyond build).

### Deployed (live on Azure)
- Backend: Function App `func-dashboard-ingest-q47bia47kk3na` updated via run-from-package
  (zip uploaded to `function-releases/`, `WEBSITE_RUN_FROM_PACKAGE` pointed at the serving URL, app restarted).
  Host is up (401 on `/api/hello` = auth-gated, expected). The new `delete-material` handler is confirmed
  live: a teacher-authorized DELETE reaches the soft-delete storage path.
- Frontend: SWA `agreeable-beach-002ff0c0f.6.azurestaticapps.net` deployed via SWA CLI. Confirmed the deployed
  `MaterialManager` bundle contains the new strings (`Eliminar definitivamente`,
  `Entiendo que los alumnos perderán acceso a este contenido al confirmar la eliminación`, `Se eliminarán`,
  `retención de 30 días`, `soft-delete`).
- Infra: `deleted/` container created + 30-day lifecycle rule applied to the storage account.

## Limitations / blockers (reported honestly, not faked)

1. **E2E browser verification blocked by SSO.** The deployed SWA redirects to Microsoft Entra sign-in
   (`login.microsoftonline.com`). No smoke credentials are available in this environment, so the full
   delete flow could not be exercised in the live browser.
2. **RBAC storage permission blocked.** The Function App's SystemAssigned Managed Identity
   (`77509617-9887-41f6-b99b-7a5a03f5f9e0`) has **no role assignments** — UADE has not granted
   `Storage Blob Data Contributor` (documented blocker, `docs/secrets-inventory.md` AC #8). Live
   `moveBlob`/storage operations fail with 403 until UADE grants the role. This is a pre-existing
   environment constraint, not a code defect; the code is unit-tested and deployed.

## Files modified
- backend/src/functions/classes-api.js
- backend/src/functions/classes-api.test.js
- backend/src/functions/classes-api.update-material-text.test.js
- backend/src/functions/material-status.test.js
- backend/src/services/storage.js
- backend/src/services/storage.moveblob.test.js (new)
- frontend/src/components/Dialog.js
- frontend/src/pages/teacher/MaterialManager.js
- frontend/src/styles/design-system.css
- infra/modules/storage.bicep
