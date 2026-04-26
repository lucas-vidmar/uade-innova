## US96 — Material status endpoint by materialId (batch polling)

### Context
- **Issue**: #96
- **Goal**: Allow frontend polling to query multiple `materialId` values in one request, avoiding repeated scans over all classes.
- **Current baseline**: Existing endpoint `GET /api/material-status/{materialId}?subjectId=...` supports single-item polling with legacy blob fallback.

### Functional mapping (Hito 1 alignment)
- Fits **Capa de Presentación** polling needs for teacher upload UX.
- Uses **Capa de Conocimiento** material state persisted in Table Storage (`materials`) and legacy `processed` blob fallback.
- Preserves existing route and behavior for backward compatibility.

### Edge cases and constraints
1. Missing `subjectId` → return `400`.
2. Missing/empty `materialIds` → return `400`.
3. Excessive `materialIds` payload (guardrail) → return `400` when over 50 IDs.
4. Unknown status values in persisted state (legacy/invalid) → normalize to `pending`.
5. Missing material by ID → per-item not-found semantics via `{ found:false, httpStatus:404 }`.
6. State Store read failure → keep legacy blob fallback to preserve availability.
7. Frontend fallback resiliency → keep class-scan fallback when batch/single status calls cannot conclusively determine terminal state.

### Architecture and implementation approach
#### Backend
- Add new endpoint:
  - `GET /api/material-status?subjectId=...&materialIds=id1,id2,...`
- Reuse shared lookup path for both single and batch routes:
  - Table Storage lookup (`getMaterialState`).
  - Legacy blob lookup (`processed/{materialId}.json`) fallback.
- Normalize all response statuses to:
  - `pending | processing | ready | error`.
- Return batch payload:
  - `{ subjectId, results: [{ materialId, found, httpStatus, status?, material? }] }`.

#### Frontend
- Add `api.getMaterialStatusBatch(subjectId, materialIds)`.
- Update processing notification polling to:
  1. Group tracked jobs by `subjectId`.
  2. Fetch statuses in batch per subject.
  3. Resolve ready/error terminal states directly.
  4. Fall back to existing single-item + class-scan logic only when needed.

### RAG pipeline impact
- No chunking/embedding/retrieval changes.
- This story affects processing-status observability path only.

### Security and zero-trust
- No secrets added.
- Existing Front Door validation remains enforced (`validateFrontDoorId`).
- No hardcoded credentials introduced.

### Environment variables
- No new environment variables required.

### Azure resources affected
- No infrastructure changes.
- No RBAC or Managed Identity changes.
- No Key Vault changes.

### Verification plan
1. Backend unit tests for:
   - single endpoint status normalization
   - batch endpoint per-item found/not-found semantics
2. Manual API check:
   - call batch endpoint with mixed IDs and verify normalized statuses + per-item 404 semantics.
3. Frontend sanity:
   - upload flow keeps polling behavior and emits terminal notifications without class list scanning as primary path.
