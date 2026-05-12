# Story 2.156: Reindex historical vectors with new classId metadata

Status: done
Story Key: 2-156-reindex-historical-vectors-with-new-classid-metadata
GitHub Issue: #156 (lucas-vidmar/uade-innova)
Epic: Epic 2 — Material Ingestion & Transcription Correction

---

## Story

As a Developer,
I want a reindex/migration utility for legacy Pinecone vector documents,
so that historical chunks also include the new `classId` metadata field and future exact-classId filtering (Issue #160) works correctly across all indexed content.

## Description

The ingestion pipeline (`backend/src/services/pipeline.js`) currently writes BOTH `classId` (single, first class) and `classIds` (array) into every new vector's metadata. However, vectors created **before** this dual-field schema was introduced only contain `classIds` (or in early cases, neither field). Issue #160 (exact classId retrieval filter path) will rely on the `classId` field being present for single-class exact-match filtering. This migration ensures backward data compatibility without requiring a full re-ingestion of all historical materials.

## Acceptance Criteria

1. **Identification:** A migration script can identify all vectors in Pinecone missing the `classId` metadata field.
2. **Correction:** Legacy vectors are updated in-place (metadata-only upsert) with `classId` set to `classIds[0]` (or looked up from Table Storage if `classIds` is also missing) without data loss.
3. **Dry-run mode:** The script supports a `--dry-run` flag (or `DRY_RUN=true` env var) that logs what would be updated without performing any upserts.
4. **Observability:** The script logs counts of scanned vectors, updated vectors, failed lookups, and elapsed time.
5. **Safety:** The script is documented with rollback instructions (re-upsert original metadata from backup if needed) and safety notes.
6. **Test coverage:** The migration logic is covered by unit tests for main and edge cases (missing classId, missing classIds, Table Storage lookup failure, dry-run behavior).

## Tasks / Subtasks

- [x] **Task 1: Add Pinecone list/fetch helpers to vector-store service** (AC: #1, #2)
  - [x] Subtask 1.1: Implement `listVectorIds({ limit, paginationToken, prefix?, namespace? })` using Pinecone `/vectors/list` REST API
  - [x] Subtask 1.2: Implement `fetchVectorsByIds(ids[])` using Pinecone `/vectors/fetch` REST API
  - [x] Subtask 1.3: Add tests for both helpers in `backend/src/services/vector-store.telemetry.test.js` or a new `vector-store.test.js`
- [x] **Task 2: Create migration script** (AC: #1, #2, #3, #4)
  - [x] Subtask 2.1: Create `backend/scripts/reindex-vector-classid.js`
  - [x] Subtask 2.2: Implement paginated vector listing via `listVectorIds`
  - [x] Subtask 2.3: Batch-fetch metadata via `fetchVectorsByIds`
  - [x] Subtask 2.4: Detect vectors missing `classId`; resolve `classId = metadata.classIds?.[0]` or fallback to Table Storage `materials` lookup by `materialId`
  - [x] Subtask 2.5: Support dry-run mode (log only, skip `upsertChunks`)
  - [x] Subtask 2.6: Print summary report: scanned, updated, skipped (already have classId), failed, durationMs
- [x] **Task 3: Safety & rollback documentation** (AC: #5)
  - [x] Subtask 3.1: Add header comment in migration script with usage examples and rollback note
  - [x] Subtask 3.2: Add `docs/reindex-vector-classid-migration.md` with runbook (pre-reqs, execution, verification, rollback)
- [x] **Task 4: Unit tests for migration logic** (AC: #6)
  - [x] Subtask 4.1: Create `backend/scripts/reindex-vector-classid.test.js`
  - [x] Subtask 4.2: Test dry-run flag prevents upserts
  - [x] Subtask 4.3: Test classId resolution from classIds array
  - [x] Subtask 4.4: Test Table Storage fallback when classIds is missing
  - [x] Subtask 4.5: Test pagination handling across multiple list batches
  - [x] Subtask 4.6: Test error handling when Pinecone list/fetch fails

---

## Dev Notes

### Architecture & Technical Context

**Pinecone API usage in this project:**
- The project uses **raw Pinecone REST API** (NOT the official SDK). All calls go through `pineconeRequest(path, payload)` in `backend/src/services/vector-store.js`.
- Existing endpoints wrapped: `/vectors/upsert`, `/query`, `/vectors/delete`, `/describe_index_stats`.
- You MUST add `/vectors/list` and `/vectors/fetch` wrappers following the exact same pattern ( AbortController timeout, error handling, `namespace` support).
- Host resolution: uses `PINECONE_HOST` env var (preferred) or legacy `PINECONE_ENVIRONMENT` fallback.

**Current vector metadata schema (as written by `pipeline.js` lines 61-72):**
```javascript
metadata: {
  subjectId,
  classId: classIds?.[0] || null,      // ← NEW field, may be missing in legacy
  classIds,                             // ← Array, exists in most vectors
  materialId,
  materialType,
  materialPriority: getMaterialPriority(materialType),
  chunkIndex,
  sourceFilename,
  lectureDate,
  text: currentBatch[index],
}
```

**Vector ID format:** `${materialId}-chunk-${chunkIndex}` (string). This stable format allows material-level grouping if needed.

**Table Storage fallback:**
- Materials are stored in Azure Table Storage table `materials` (partitionKey = `subjectId`, rowKey = `materialId`).
- Use `backend/src/services/state-store.js` → `getMaterialState(subjectId, materialId)` or `listMaterialsBySubject(subjectId)` for lookups.
- The `classIds` field in Table Storage is JSON-stringified; `fromMaterialEntity` handles parsing.

**Existing migration pattern:**
- Reference: `backend/scripts/migrate-state-to-tables.js`
- Pattern: ES modules (`import`), async `main()`, catches and logs errors, exits with code 1 on failure.
- This script reads from Blob Storage and writes to Table Storage. Your script will read from Pinecone and write back to Pinecone.

### Files to Create / Modify

**NEW files:**
- `backend/scripts/reindex-vector-classid.js` — Main migration script (CLI runnable via `node backend/scripts/reindex-vector-classid.js`)
- `backend/scripts/reindex-vector-classid.test.js` — Unit tests for migration logic
- `docs/reindex-vector-classid-migration.md` — Runbook documentation

**UPDATE files:**
- `backend/src/services/vector-store.js` — Add `listVectorIds()` and `fetchVectorsByIds()` exports
- `backend/src/services/vector-store.telemetry.test.js` — OR create `backend/src/services/vector-store.test.js` for the new helpers

### Implementation Guardrails

1. **Do NOT reinvent Pinecone HTTP logic.** Reuse `pineconeRequest()` from `vector-store.js`. If you need GET parameters for `/vectors/list`, extend `pineconeRequest` to support optional `method` and `queryParams`, or create a lightweight wrapper. The simplest approach: `pineconeRequest('/vectors/list', { limit: 100, paginationToken: '...' })` — Pinecone accepts POST for list as well.
2. **Batch size discipline:** Use `BATCH_SIZE = 100` for list operations and `BATCH_SIZE = 100` for fetch/upsert, matching existing conventions in `vector-store.js`.
3. **Namespace handling:** Respect `getNamespace()` exactly as `upsertChunks` and `querySimilar` do. If a namespace is configured, pass it in list/fetch payloads.
4. **Table Storage lookup must be fault-tolerant:** If `getMaterialState` throws or returns null, log the materialId as failed and continue. Do NOT fail the entire migration.
5. **Dry-run must be a no-op at the Pinecone level:** In dry-run mode, calculate the corrected vectors but do NOT call `upsertChunks`. Log the count instead.
6. **Preserve all existing metadata:** When upserting corrected vectors, keep `values` and all existing metadata fields intact. Only add/modify `classId`.
7. **Do not hardcode secrets:** Use existing env vars (`PINECONE_API_KEY`, `PINECONE_HOST`, `AZURE_STORAGE_ACCOUNT_NAME`, etc.). The script should be runnable in any environment where the backend Functions run.

### Testing Standards

- Use `node:test` and `node:assert` (project standard, no Jest/Mocha).
- Mock `global.fetch` to simulate Pinecone REST responses, following the pattern in `vector-store.telemetry.test.js`.
- Mock Table Storage calls by mocking `state-store.js` exports.
- Test cases must cover:
  - Vector with missing `classId` but existing `classIds`
  - Vector with missing both `classId` and `classIds` → Table Storage fallback
  - Vector already having `classId` → skipped
  - Dry-run mode → no fetch/upsert calls
  - Pagination across multiple list batches
  - Pinecone API failure → logged, not crashed

### Performance Considerations

- Pinecone Serverless `/vectors/list` returns up to 100 IDs per call. For an index with ~10K vectors, that's ~100 list calls.
- `/vectors/fetch` can retrieve up to 1000 vectors per call. Batch fetched IDs accordingly.
- The migration should complete in under 5 minutes for the pilot's current vector count (~5K-15K vectors).

---

## Previous Story Intelligence

**Story 2.98 (Deduplicate processing toasts for multi-class uploads) — #98:**
- Introduced frontend polling deduplication logic using materialId as the stable key.
- Pattern established: `materialId` is the primary identifier across frontend, backend, and Pinecone.

**Story 2.154 (Teacher Override for Material Priority) — #154:**
- Added `priority` field to `materials` Table Storage and `materialPriority` to vector metadata.
- Demonstrated that vector metadata updates require re-upsert of the full vector (Pinecone does not support partial metadata updates).
- Established pattern: keep Table Storage as source-of-truth for mutable attributes, upsert to Pinecone when they change.

**Story 2.155 (Backfill Material Priority for Existing Vectors) — #155:**
- Similar backfill pattern to this story. If documentation exists in the repo, consult it for patterns.
- (Note: #155 was implemented just before this story and is now closed.)

### Git Intelligence

Recent commits relevant to this story:
- `9bab387` — "feat: implement teacher-driven material priority overrides in RAG pipeline" (adds `materialPriority` to metadata, shows how to upsert corrected metadata)
- `6d0e1c0` — "fix: resolve auth reference error and ensure material priority persistence in API response" (shows Table Storage + vector upsert interaction)
- `f8df698` — "feat(security): implement enrollment-based access control for critical endpoints (fixes #106)" (shows backend endpoint patterns)

Code conventions observed:
- ES modules throughout (`import`/`export`)
- Azure Functions v4 programming model (`app.http(...)`)
- Context logging: `context.log()`, `context.error()`, `context.warn()`
- Error handling: `CategorizedError` from `error-categories.js` for operational errors
- Telemetry: `trackVectorSearchDependency` for external dependency tracking

---

## Project Context Reference

**Relevant AGENTS.md sections:**
- §3: Architecture (4 Capas) — Pinecone is the vector store, Table Storage is the state store
- §6: Comandos de Referencia — `func start` for local testing
- §7: Infraestructura como Código — Do NOT create resources manually; this script operates on existing Pinecone index
- §10: Modelos de Datos — `PineconeMetadata` interface defines the expected metadata shape
- §12: Variables de Entorno — `PINECONE_HOST`, `PINECONE_INDEX_NAME`, `PINECONE_API_KEY`, `AZURE_STORAGE_ACCOUNT_NAME`
- §13: Convenciones de Código — TypeScript preferred but Node.js 20 with ES modules is current standard; chunking uses 512 tokens / 50 overlap

**Relevant Architecture Review (`docs/architecture-review.md`):**
- §2: Azure Table Storage is the state store for domain entities (materials/classes)
- §4: Pinecone Serverless (free tier) is the active vector store; Azure Cognitive Search removed

**Relevant existing docs:**
- `docs/us60-material-status-endpoint-implementation-plan.md` — Shows backend Function patterns and Table Storage usage

---

## Dev Agent Record

### Agent Model Used

deepseek-v4-pro

### Debug Log References

- Task 1: `vector-store.test.js` — 9 tests pass (list, fetch, pagination, namespaces, error handling)
- Task 2: `reindex-vector-classid.js` — full migration script with dry-run, Table Storage fallback, summary output
- Task 4: `reindex-vector-classid.test.js` — 16 tests pass (classId resolution, dry-run detection, material lookup, pagination, fetch handling)

### Completion Notes List

✅ **Task 1** — Added `listVectorIds()`, `fetchVectorsByIds()`, `listAllVectorIds()` to `vector-store.js`. Added `pineconeGetRequest()` internal helper for GET-based endpoints. All follow existing patterns (AbortController timeout, namespace support, error handling). 9 unit tests pass.

✅ **Task 2** — Created migration script at `backend/scripts/reindex-vector-classid.js`. Implements two-pass approach: (1) list all IDs, fetch vectors, resolve simple classId from classIds[0]; (2) for vectors missing both fields, query Table Storage via `getMaterialState()`. Dry-run mode skips upserts. Summary reports scanned/updated/skipped/failed/duration. Null-safe lookup handling.

✅ **Task 3** — Header comment with usage, rollback, safety notes in migration script. Full runbook at `docs/reindex-vector-classid-migration.md` with prerequisites, dry-run step, live execution, verification, rollback, troubleshooting table.

✅ **Task 4** — 16 unit tests covering: classId resolution (existing, classIds[0], table-storage, null/empty lookup), dry-run flag/env detection, migration skip logic, material lookup building, Pinecone fetch/list integration.

### File List

- `backend/src/services/vector-store.js` — MODIFIED: Added `pineconeGetRequest()`, `listVectorIds()`, `fetchVectorsByIds()`, `listAllVectorIds()`
- `backend/src/services/vector-store.test.js` — NEW: 9 tests for list/fetch helpers
- `backend/scripts/reindex-vector-classid.js` — NEW: Main migration script
- `backend/scripts/reindex-vector-classid.test.js` — NEW: 16 tests for migration logic
- `docs/reindex-vector-classid-migration.md` — NEW: Migration runbook

### Change Log

- Added Pinecone list/fetch wrappers with GET support (`pineconeGetRequest`)
- Created idempotent classId backfill migration with dry-run support
- All 25 new tests pass (9 vector-store + 16 migration logic)
- No regressions in existing tests (confirmed parser, telemetry, vector-store.telemetry tests pass)

---

*Ultimate context engine analysis completed — comprehensive developer guide created*
*Generated: 2026-05-11*

---

### Review Findings

- [x] [Review][Patch] **`_resolved` field leaked into Pinecone** — `_resolved: false` from internal tracking pollutes vector metadata on Table Storage path. Destructure before upsert. [`backend/scripts/reindex-vector-classid.js:148`]
- [x] [Review][Patch] **Stale metadata overwrite in second pass** — Second pass refetches vectors but only uses `values`, discarding fresh `metadata`. Merge fresh metadata with resolved `classId`. [`backend/scripts/reindex-vector-classid.js:157-168`]
- [x] [Review][Patch] **Pseudo-null `classIds[0]` accepted as valid classId** — `resolveClassId` returns `null`, `undefined`, or `""` from `classIds[0]` without truthiness check. Add guard. [`backend/scripts/reindex-vector-classid.js:43-44`]
- [x] [Review][Patch] **Fragile vectorId reconstruction from metadata fields** — `${meta.materialId}-chunk-${meta.chunkIndex}` may not match actual Pinecone IDs. Preserve original `id` from first-pass fetch. [`backend/scripts/reindex-vector-classid.js:162`]
- [x] [Review][Patch] **`listAllVectorIds` no max iteration guard** — `while(paginationToken)` loop has no bound; infinite loop risk on bad pagination data. Add `MAX_PAGES` limit. [`backend/src/services/vector-store.js:371`]
- [x] [Review][Patch] **N+1 refetch in second pass** — Resolves Table Storage vectors one-at-a-time instead of batching. Batch or save values from first pass. [`backend/scripts/reindex-vector-classid.js:157`]
- [x] [Review][Patch] **`fetchVectorsByIds` no batch-size enforcement** — No limit on IDs; Pinecone max is 1000. Add validation or auto-chunk. [`backend/src/services/vector-store.js:338-357`]
- [x] [Review][Patch] **`pineconeGetRequest` appends falsy query params** — Empty strings pass `!== null && !== undefined` guard. Add `&& value !== ''`. [`backend/src/services/vector-store.js:257`]
- [x] [Review][Patch] **`pineconeGetRequest` missing error logging** — No `console.error` on failure, unlike `pineconeRequest` consumers. Add before re-throw. [`backend/src/services/vector-store.js:286`]
- [x] [Review][Patch] **Dry-run missing per-vector logs in first pass** — Simple-resolution vectors silently added to `correctedVectors` in dry-run. Add log. [`backend/scripts/reindex-vector-classid.js:114-124`]
- [x] [Review][Patch] **`Number(options.limit) \|\| 100` coerces falsy 0** — Intentional `limit: 0` falls through to default 100. Use null coalescing. [`backend/src/services/vector-store.js:268`]
- [x] [Review][Patch] **`fetchVectorsByIds` passes non-string IDs** — `String(obj)` passes for objects. Add `typeof id === 'string'` check. [`backend/src/services/vector-store.js:319`]
- [x] [Review][Patch] **No `process.exit(0)` on success** — Migration script may hang if async operations linger. Add `.then(() => process.exit(0))`. [`backend/scripts/reindex-vector-classid.js:202`]
- [x] [Review][Patch] **Env var name mismatch in docs** — Runbook says `AZURE_STORAGE_ACCOUNT_KEY` but code uses `AZURE_STORAGE_ACCESS_KEY`. [`docs/reindex-vector-classid-migration.md:17`]
- [x] [Review][Defer] **`listAllVectorIds` memory exhaustion on large index** — Not applicable for pilot scale (~5-15K vectors). Deferred. [`backend/src/services/vector-store.js:366`]
- [x] [Review][Defer] **Zero telemetry in new list/fetch functions** — Consistent with existing non-query Pinecone operations (e.g. `upsertChunks`). Enhancement for future. [`backend/src/services/vector-store.js`]
- [x] [Review][Defer] **`fetchVectorsByIds` silently drops missing IDs** — Pinecone fetch API design; not an error condition. Enhancement for future. [`backend/src/services/vector-store.js:338`]
- [x] [Review][Defer] **No retry logic for transient Pinecone failures** — Existing migration scripts also lack retry. Enhancement. [`backend/scripts/reindex-vector-classid.js`]
- [x] [Review][Defer] **No checkpointing/resume capability** — Enhancement for large-scale migrations. Not needed at pilot scale. [`backend/scripts/reindex-vector-classid.js`]
- [x] [Review][Defer] **No concurrency guard against ingestion pipeline** — Operational procedure: pause ingestion during migration. Documented in runbook. [`backend/scripts/reindex-vector-classid.js`]
- [x] [Review][Defer] **`upsertChunks` silently passes empty values** — Pre-existing pattern in `vector-store.js:139`. Not introduced by this change. [`backend/src/services/vector-store.js:139`]
- [x] [Review][Defer] **`pineconeGetRequest` duplicates HTTP logic** — Acceptable duplication for GET vs POST. Refactor if pattern grows. [`backend/src/services/vector-store.js:250`]
- [x] [Review][Defer] **No integration test for `main()`** — Helper functions are unit-tested. Integration test deferred. [`backend/scripts/reindex-vector-classid.test.js`]
- [x] [Review][Defer] **`new URL()` unhandled synchronous throw** — Already protected by `assertConfiguration()`. Low risk. [`backend/src/services/vector-store.js:255`]
- [x] [Review][Defer] **Falsy pagination token handling** — Pinecone API never returns `0` or `""` as pagination tokens per spec. [`backend/src/services/vector-store.js:310`]
- [x] [Review][Defer] **`JSON.stringify` for Set deduplication** — Object property order is deterministic for this case. Lower risk. [`backend/scripts/reindex-vector-classid.js:60`]
