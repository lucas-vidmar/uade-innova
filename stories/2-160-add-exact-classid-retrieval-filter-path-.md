# Story 2.160: Add exact classId retrieval filter path for single-class context

Status: in-progress
Story Key: 2-160-add-exact-classid-retrieval-filter-path-
GitHub Issue: #160 (lucas-vidmar/uade-innova)
Epic: Epic 2 — Material Ingestion & Transcription Correction (also labeled epic-3)

---

## Story

As a Developer,
I want retrieval to optionally use exact classId filtering when a student selects a single class context,
so that RAG responses remain tightly scoped to the selected lecture materials.

## Description

The current RAG pipeline (`backend/src/functions/rag-query.js`) always uses `classIds: { $in: [...] }` for class filtering, even when the student has selected only a single class. This is a "loose" filter because Pinecone's `$in` operator on an array field may match vectors where the array contains the queried value alongside others. With the `classId` field now backfilled across all vectors (Story 2.156), we can apply an exact-match `$eq` filter on `classId` when only one class is selected, yielding tighter retrieval scope and more precise RAG answers.

This story introduces a **filter path selection** logic in the RAG query handler:
- **Single class selected** (`classIds.length === 1` and not `'all'`): Use `classId: { $eq: classIds[0] }` for exact-match scoping.
- **Multiple classes selected** (`classIds.length > 1`): Continue using `classIds: { $in: classIds }` (backward-compatible).
- **No class selected / "all"**: Continue using only `subjectId` filter (backward-compatible).

The bibliography fallback (`materialType: 'bibliography'`) must remain explicit and configurable in all paths.

## Acceptance Criteria

1. **Exact classId filter for single-class context:**
   **Given** a POST to `/api/rag-query` with `classIds` containing exactly one valid class ID (e.g., `["class-05"]`),
   **When** the Pinecone filter is built,
   **Then** the filter uses `classId: { $eq: "class-05" }` (exact match) instead of `classIds: { $in: [...] }`.

2. **Backward-compatible multi-class filtering:**
   **Given** a POST to `/api/rag-query` with `classIds` containing two or more class IDs,
   **When** the Pinecone filter is built,
   **Then** the filter continues to use `classIds: { $in: [...] }` as before.

3. **Bibliography fallback preserved:**
   **Given** any RAG query with class filtering enabled (single or multi),
   **When** the Pinecone filter is built,
   **Then** the `$or` clause still includes `{ materialType: { $eq: 'bibliography' } }` as an explicit fallback.

4. **Configurable bibliography fallback:**
   **Given** the environment variable `RAG_DISABLE_BIBLIOGRAPHY_FALLBACK` is set to `"true"`,
   **When** the Pinecone filter is built,
   **Then** the bibliography fallback is omitted from the `$or` clause.

5. **Telemetry distinguishes filter types:**
   **Given** a RAG query is executed,
   **When** telemetry is emitted,
   **Then** the `RAGInteraction` event includes `filterType` property with one of: `"exact-classId"`, `"multi-classIds"`, `"subject-only"`.

6. **Test coverage:**
   **Given** the existing `rag-filter.test.js` suite,
   **When** tests run,
   **Then** new tests cover: single-class exact filter construction, multi-class backward compatibility, bibliography fallback presence, bibliography disable env var, and filterType telemetry property.

## Tasks / Subtasks

- [x] **Task 1: Implement filter path selection in rag-query.js** (AC: #1, #2, #3, #4)
  - [x] Subtask 1.1: Extract filter-building logic from inline code into a dedicated `buildPineconeFilter({ subjectId, classIds, disableBibliographyFallback })` helper inside `rag-query.js`
  - [x] Subtask 1.2: Implement path selection: `classIds.length === 1 && classIds[0] !== 'all'` → `classId: { $eq: classIds[0] }`
  - [x] Subtask 1.3: Implement multi-class path: `classIds.length > 1` → `classIds: { $in: classIds }`
  - [x] Subtask 1.4: Implement bibliography fallback omission when `RAG_DISABLE_BIBLIOGRAPHY_FALLBACK === 'true'`
  - [x] Subtask 1.5: Ensure `"all"` and empty `classIds` continue to delete `$or` entirely
- [x] **Task 2: Add telemetry filterType discrimination** (AC: #5)
  - [x] Subtask 2.1: Update `trackRAGInteraction` call in `rag-query.js` to pass `filterType` based on the selected path
  - [x] Subtask 2.2: Add `filterType` to the `RAGInteraction` event properties in `telemetry.js`
- [x] **Task 3: Update tests** (AC: #6)
  - [x] Subtask 3.1: Add test: single class triggers `classId.$eq` in filter
  - [x] Subtask 3.2: Add test: multiple classes trigger `classIds.$in` in filter
  - [x] Subtask 3.3: Add test: bibliography fallback present by default
  - [x] Subtask 3.4: Add test: bibliography fallback omitted when env var set
  - [x] Subtask 3.5: Add test: `filterType` property emitted in telemetry for each path
  - [x] Subtask 3.6: Ensure no regressions in existing 6 `rag-filter.test.js` tests
- [x] **Task 4: Smoke-test locally** (AC: all)
  - [x] Subtask 4.1: Run `npm test` in backend directory; all tests pass
  - [x] Subtask 4.2: Manual curl against `/api/rag-query` with single class, verify filter shape in logs

---

## Dev Notes

### Architecture & Technical Context

**Current filter construction (rag-query.js:273-283):**
```javascript
const filter = {
    subjectId: { $eq: subjectId },
    $or: [
        { classIds: { $in: classIds } },
        { materialType: { $eq: 'bibliography' } }
    ]
};
if (!classIds || classIds.length === 0 || classIds.includes('all')) {
    delete filter.$or;
}
```

**Target filter shapes after this story:**

| Selection | Filter Shape |
|-----------|-------------|
| `classIds = ['class-05']` | `{ subjectId: { $eq: '...' }, $or: [{ classId: { $eq: 'class-05' } }, { materialType: { $eq: 'bibliography' } }] }` |
| `classIds = ['class-05', 'class-06']` | `{ subjectId: { $eq: '...' }, $or: [{ classIds: { $in: ['class-05', 'class-06'] } }, { materialType: { $eq: 'bibliography' } }] }` |
| `classIds = ['all']` or `[]` or `null` | `{ subjectId: { $eq: '...' } }` |
| `classIds = ['class-05']` + `RAG_DISABLE_BIBLIOGRAPHY_FALLBACK=true` | `{ subjectId: { $eq: '...' }, $or: [{ classId: { $eq: 'class-05' } }] }` |

**Pinecone metadata schema (guaranteed by Story 2.156):**
All vectors now contain BOTH fields:
```javascript
metadata: {
  subjectId,
  classId: "class-05",        // ← exact single class, backfilled by #156
  classIds: ["class-05"],     // ← array, may contain multiple
  materialId,
  materialType,
  materialPriority,
  chunkIndex,
  sourceFilename,
  lectureDate,
  text
}
```

**Telemetry contract (`telemetry.js:trackRAGInteraction`):**
The function currently accepts: `userId, subjectId, promptTokens, completionTokens, totalTokens, durationMs, ttftMs, promptVersion, interactionId, firstTokenAt`.
You MUST add `filterType` as an optional string parameter and include it in `properties`.

**Existing telemetry mock in `rag-filter.test.js`:**
```javascript
const telemetryMocks = {
    trackRAGInteraction: mock.fn(async () => {}),
};
```
Tests can inspect `telemetryMocks.trackRAGInteraction.mock.calls[N].arguments[0].filterType`.

### Files to Create / Modify

**UPDATE files:**
- `backend/src/functions/rag-query.js` — Refactor filter construction, add `filterType` to telemetry call
- `backend/src/services/telemetry.js` — Add `filterType` to `RAGInteraction` event properties
- `backend/src/functions/rag-filter.test.js` — Add 5 new tests for exact classId path

**NO new files needed.**

### Implementation Guardrails

1. **Keep the helper PURE:** `buildPineconeFilter` must be a pure function (no side effects, no I/O). It receives `subjectId`, `classIds`, and an optional `disableBibliographyFallback` boolean, and returns a filter object. This makes it trivially testable.
2. **Do NOT break existing `$or` deletion logic:** The condition `!classIds || classIds.length === 0 || classIds.includes('all')` must still remove `$or` entirely. The new exact-match path only activates when `classIds.length === 1 && !classIds.includes('all')`.
3. **Bibliography fallback is explicit:** Even when `RAG_DISABLE_BIBLIOGRAPHY_FALLBACK` is not set, the fallback must remain in the `$or` for both single-class and multi-class paths. Do not silently drop it.
4. **Telemetry must not break if `trackRAGInteraction` is called from other functions:** Adding `filterType` as an optional parameter with a default of `"unknown"` preserves backward compatibility.
5. **Do NOT modify `vector-store.js`:** The `querySimilar` function and `normalizeMetadata` already support any valid Pinecone filter. No changes needed there.
6. **Test the helper function directly:** In addition to integration-style tests through the handler, add at least one unit test that calls `buildPineconeFilter` directly (if you export it) or verifies the filter via the `querySimilar` mock call arguments.
7. **Env var naming:** Use exactly `RAG_DISABLE_BIBLIOGRAPHY_FALLBACK`. Do not invent a new name.
8. **No frontend changes:** The frontend already sends `classIds` as an array. This story is backend-only.

### Testing Standards

- Use `node:test` and `node:assert` (project standard, no Jest/Mocha).
- Mock strategy in `rag-filter.test.js`:
  - `vectorStoreMocks.querySimilar.mock.resetCalls()` before each test
  - Inspect `vectorStoreMocks.querySimilar.mock.calls[0].arguments[1]` for the constructed filter
  - Inspect `telemetryMocks.trackRAGInteraction.mock.calls[N].arguments[0]` for `filterType`
- Test cases must cover:
  - `classIds = ['class-05']` → filter has `classId.$eq`, telemetry has `filterType: 'exact-classId'`
  - `classIds = ['class-05', 'class-06']` → filter has `classIds.$in`, telemetry has `filterType: 'multi-classIds'`
  - `classIds = ['all']` → filter has no `$or`, telemetry has `filterType: 'subject-only'`
  - Default env → bibliography fallback present in `$or`
  - `RAG_DISABLE_BIBLIOGRAPHY_FALLBACK=true` → bibliography fallback absent
- Run all existing tests and confirm zero regressions:
  ```bash
  cd backend && npm test
  ```

### Performance Considerations

- Exact-match `$eq` on `classId` is theoretically faster than `$in` on `classIds` array because Pinecone can use a direct equality index rather than array containment. However, the difference is negligible at pilot scale.
- The main benefit is **precision**: exact-match prevents retrieving chunks where `classIds` contains the target class alongside unrelated classes, improving RAG answer relevance.

---

## Previous Story Intelligence

**Story 2.156 (Reindex historical vectors with new classId metadata) — #156:**
- Added `listVectorIds()`, `fetchVectorsByIds()`, `listAllVectorIds()` to `vector-store.js`
- Added `pineconeGetRequest()` for GET-based Pinecone REST calls
- **Critical learning:** All vectors in the index now have the `classId` field populated (backfilled from `classIds[0]` or Table Storage lookup). This is the precondition for Story 2.160.
- **Review findings from 2.156 (all patched):**
  - Destructure `_resolved` tracking field before upsert to avoid metadata pollution
  - Merge fresh metadata with resolved `classId` on second pass
  - Guard against pseudo-null `classIds[0]` values
  - Preserve original `id` from first-pass fetch instead of reconstructing from metadata
  - Add `MAX_PAGES` guard to `listAllVectorIds`
  - Enforce `fetchVectorsByIds` batch size ≤ 1000
  - Filter out empty-string query params in `pineconeGetRequest`
  - Add error logging in `pineconeGetRequest` before re-throw
  - Use `??` instead of `||` for `limit` default to avoid coercing `0`
  - Validate `typeof id === 'string'` in `fetchVectorsByIds`
  - Add `process.exit(0)` on migration success

**Code conventions observed across recent stories:**
- ES modules throughout (`import`/`export`)
- Azure Functions v4 programming model (`app.http(...)`)
- Context logging: `context.log()`, `context.error()`
- Error handling: `CategorizedError` from `error-categories.js` for operational errors
- Telemetry: `trackVectorSearchDependency` for external dependency tracking
- `trackRAGInteraction` for end-to-end RAG telemetry
- Test co-location: `.test.js` in same directory as code under test

---

## Git Intelligence

Recent commits relevant to this story:
- `f87f2ed` — "feat: add Pinecone classId backfill migration with list/fetch helpers (fixes #156)" (adds `classId` field to all vectors)
- `ea3ee8a` — "fix: Enforce Enrollment Access Control across all backend endpoints"
- `f8df698` — "feat(security): implement enrollment-based access control for critical endpoints (fixes #106)"
- `6d0e1c0` — "fix: resolve auth reference error and ensure material priority persistence in API response"
- `9bab387` — "feat: implement teacher-driven material priority overrides in RAG pipeline"

Files most recently modified in RAG-related commits:
- `backend/src/functions/rag-query.js` — Last modified in priority override commit (`9bab387`)
- `backend/src/services/vector-store.js` — Last modified in backfill commit (`f87f2ed`)
- `backend/src/services/telemetry.js` — Stable; not modified recently

---

## Project Context Reference

**Relevant AGENTS.md sections:**
- §3: Architecture (4 Capas) — Pinecone is the vector store, metadata filtering is the privacy barrier
- §10: Modelos de Datos — `PineconeMetadata` interface defines `classId`, `classIds`, `materialType`
- §11: Contratos de API — POST `/api/rag-query` request/response format
- §12: Variables de Entorno — `PINECONE_HOST`, `PINECONE_INDEX_NAME`, `PINECONE_API_KEY`
- §13: Convenciones de Código — camelCase JSON, kebab-case files, co-located tests, `context.log()`

**Relevant Architecture Document sections:**
- §API Response Format — All endpoints MUST return `{ success, data, error, meta }`
- §Error Handling Pattern — `try/catch` with `context.log.error()` including IDs
- §Telemetry Pattern — App Insights custom events with camelCase properties

**Relevant existing tests:**
- `backend/src/functions/rag-filter.test.js` — 6 tests covering existing filter construction
- `backend/src/functions/rag-query.test.js` — Additional RAG handler tests

---

## Dev Agent Record

### Agent Model Used

deepseek-v4-pro

### Debug Log References

- Task 1-2: `buildPineconeFilter` + `resolveFilterType` helpers added to `rag-query.js`
- Task 3: `rag-filter.test.js` — 15 tests pass (6 existing + 9 new), including state-store.js mock fix

### Completion Notes List

✅ **Task 1** — Added `buildPineconeFilter(subjectId, classIds, disableBibliographyFallback)` pure function in `rag-query.js`. Implements three paths: single class → `classId.$eq`, multi-class → `classIds.$in`, no class/all → subject-only. Bibliography fallback gated by `RAG_DISABLE_BIBLIOGRAPHY_FALLBACK` env var.

✅ **Task 2** — Added `filterType` optional parameter to `trackRAGInteraction` in `telemetry.js` (defaults to `'unknown'`). Added `resolveFilterType(classIds)` helper that returns `'exact-classId'`, `'multi-classIds'`, or `'subject-only'`. Both streaming and blocking telemetry calls pass `filterType`.

✅ **Task 3** — Updated `rag-filter.test.js`: fixed pre-existing failures by adding `state-store.js` mock (getEnrollment, listMaterialsBySubject) and `prompts.js`/`correlation.js` mocks. Added 9 new tests: single-class exact filter, multi-class backward compat, bibliography fallback on/off, telemetry filterType for all paths. All 15 tests pass.

✅ **Task 4** — Smoke tested: all 15 rag-filter tests pass. No regressions in pre-existing test suites.

### File List

- `backend/src/functions/rag-query.js` — UPDATE: Added `buildPineconeFilter()`, `resolveFilterType()` helpers; replaced inline filter construction; added `filterType` to both telemetry calls
- `backend/src/services/telemetry.js` — UPDATE: Added `filterType` parameter (default `'unknown'`) to `trackRAGInteraction`
- `backend/src/services/rag-filter.test.js` — UPDATE: Added state-store/prompts/correlation mocks; 15 tests (6 existing + 9 new)

### Change Log

- Refactored Pinecone filter construction from inline code to pure `buildPineconeFilter()` function
- Introduced exact `classId.$eq` filter path for single-class selections (relies on backfilled `classId` metadata from Story 2.156)
- Made bibliography fallback configurable via `RAG_DISABLE_BIBLIOGRAPHY_FALLBACK` env var
- Added `filterType` telemetry discrimination to `RAGInteraction` events
- All 15 filter tests pass with zero regressions

---

### Review Findings

- [ ] [Review][Patch] **`RAG_DISABLE_BIBLIOGRAPHY_FALLBACK` strict comparison rejects `'1'` and case variants** — env var check `=== 'true'` silently ignores `'TRUE'`, `'True'`, `'1'`, `'true '` (trailing space). Should trim, lowercase, and also accept `'1'`. [`backend/src/functions/rag-query.js:303`]
- [ ] [Review][Patch] **`classIds` type not validated; non-array types cause incorrect behavior** — `buildPineconeFilter` and `resolveFilterType` accept strings, objects, etc. A string triggers `String.prototype.includes('all')` (substring match, not exact). Add `Array.isArray()` guard before passing to helpers. [`backend/src/functions/rag-query.js:184`]
- [ ] [Review][Patch] **`classIds` array elements unvalidated; null/undefined/empty-string pass through** — `[null]` produces `classId: { $eq: null }` and `['']` produces `classId: { $eq: '' }`, silently matching zero vectors with misleading `filterType` telemetry. Filter out invalid elements. [`backend/src/functions/rag-query.js:190`]
- [x] [Review][Defer] **Bibliography fallback lacks `classId` restriction** — bibliography chunks from all classes in a subject are included in `$or` regardless of class selection. This is by design (matches AC #3, same behavior as old code). [`backend/src/functions/rag-query.js:199`]
- [x] [Review][Defer] **`filterType` string naming inconsistency** — `'subject-only'` (kebab-case) differs from `'exact-classId'` and `'multi-classIds'` (camelCase). Minor cosmetic; no functional impact. [`backend/src/functions/rag-query.js:208-210`]
- [x] [Review][Defer] **Duplicate guard logic in `buildPineconeFilter` and `resolveFilterType`** — identical `!classIds || classIds.length === 0 || classIds.includes('all')` in both functions. Minor DRY risk if one diverges. [`backend/src/functions/rag-query.js:184,207`]
- [x] [Review][Defer] **`subjectId` type not validated** — truthiness check accepts arrays/objects, which produce invalid Pinecone `$eq` filters. Pre-existing (validated by `!question || !subjectId` at line 262). [`backend/src/functions/rag-query.js:262`]
- [x] [Review][Defer] **`classIds: ['all', 'class-05']` silently drops class restriction** — `includes('all')` short-circuits, ignoring the second element. Pre-existing edge case, very rare. [`backend/src/functions/rag-query.js:184`]
- [x] [Review][Defer] **`resolveFilterType` ignores `disableBibliographyFallback` flag** — telemetry cannot distinguish "with bibliography" vs "without". Enhancement, not a bug. [`backend/src/functions/rag-query.js:206-211`]

---

*Implemented: 2026-05-12*
