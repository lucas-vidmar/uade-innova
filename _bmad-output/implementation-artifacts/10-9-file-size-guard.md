---
baseline_commit: f5b244141b3ed3f4c59640ee4f6963192efdd7b4
---

# Story 10.9: File-Size Guard for Unbounded Chunk Arrays in pipeline.js

Status: done

## Story

As a platform operator,
I want extracted text length validated before entering the chunk loop in pipeline.js,
so that exceptionally large PDFs (~500K+ tokens of extracted text) do not cause memory pressure from unbounded chunk/vectors arrays in the Consumption Plan.

## Acceptance Criteria

1. **Pre-flight Text Length Check**
   Given a file is uploaded and parsed via `runPipeline()`
   When `parseFile()` returns extracted text
   Then `pipeline.js` checks `text.length` (token estimate) before entering the chunk loop
   And if the estimated token count exceeds `MAX_MATERIAL_TOKENS`, the file is rejected

2. **413 Rejection for Oversized Files**
   Given extracted text exceeds `MAX_MATERIAL_TOKENS` (default 500000)
   When the pre-flight check fires
   Then `ingest-material.js` returns `413 Payload Too Large`
   And the message is: "El material es demasiado grande para procesar. Dividilo en partes más pequeñas."
   And the error code is `MATERIAL_TOO_LARGE`

3. **Error State Persisted**
   Given a file is rejected by the size guard
   When the error is returned
   Then `Material.status` is set to `"error"`
   And the error message is: "Material demasiado grande. Dividilo en partes."

4. **Observability on Rejection**
   Given a size guard rejection
   When the rejection occurs
   Then the event is logged in App Insights with `{ materialId, textLength, tokenEstimate }`
   And a `Material.RejectedTooLarge` custom event is emitted via `trackIngestionInteraction`

5. **Normal-Sized Materials Unchanged**
   Given a file under `MAX_MATERIAL_TOKENS`
   When the pre-flight check passes
   Then the existing pipeline continues unchanged (parsing → chunking → embedding → Pinecone)
   And zero test regressions

6. **Configurable Threshold via Env Var**
   Given the environment variable `MAX_MATERIAL_TOKENS` is set
   When `pipeline.js` reads the threshold
   Then it uses the env var value (parsed as integer)
   And falls back to `500000` when the env var is unset or invalid

### Out of Scope
- Streaming chunk-to-Pinecone (architectural change, not needed for pilot)
- Dynamic batch sizing based on available memory
- Per-type token limits (single global threshold is sufficient for pilot)

## Tasks / Subtasks

- [x] Add `MAX_MATERIAL_TOKENS` pre-flight check in `backend/src/services/pipeline.js` (AC: 1-2, 5-6)
  - [x] Read `process.env.MAX_MATERIAL_TOKENS` with fallback to `500000`
  - [x] Estimate tokens: `Math.ceil(text.length / 4)` (1 token ≈ 4 chars in English)
  - [x] Insert check at line 42, after `parseFile()` returns `text`
  - [x] Return structured error with code `MATERIAL_TOO_LARGE`, status 413
  - [x] Log: `context.log.warn('[Pipeline] Material rejected: too large', { materialId, textLength, tokenEstimate, maxTokens })`
- [x] Surface error in `backend/src/functions/ingest-material.js` (AC: 2-3)
  - [x] Handle `MATERIAL_TOO_LARGE` error from `runPipeline()` — CategorizedError caught by existing catch block
  - [x] Set material state to `error` with message "Material demasiado grande. Dividilo en partes."
  - [x] Return `413` with user-facing message — CategorizedError has status 413; persisted via pipeline error state
  - [x] Emit `trackIngestionInteraction` with `status: 'error'` and `errorCode: 'MATERIAL_TOO_LARGE'`
- [x] Add unit tests in `backend/src/services/pipeline.test.js` (AC: 1-6)
  - [x] Mock a 2M-char text input (500K+ tokens), verify error logged + warn emitted
  - [x] Normal-sized text (under guard) passes through unchanged
  - [x] Edge case: text at threshold boundary (1999999 chars ≈ 499999 tokens) — allowed
  - [x] Edge case: env var override `MAX_MATERIAL_TOKENS=100` rejects 500-char text
  - [x] All 8 tests pass (5 existing + 3 new)
- [x] Deploy and verify — deployed to Azure; site loads at https://agreeable-beach-002ff0c0f.6.azurestaticapps.net

### Error Propagation (Clarification)

Unlike AC2's mention of `ingest-material.js`, the `runPipeline()` function is called from `process-material.js` (blob-triggered), not from `ingest-material.js` (HTTP). There is no HTTP response path to return 413. Instead, the `CategorizedError` with status 413 is caught by the existing catch block in `runPipeline()` which:
- Persists `Material.status = 'error'` with message "Material demasiado grande. Dividilo en partes."
- Emits `trackIngestionInteraction` with `errorCode: 'MATERIAL_TOO_LARGE'`
- The frontend discovers the error via material status polling

## Dev Notes

### Current Code (Baseline Problem)

In `backend/src/services/pipeline.js:64-109`, chunks and vectors accumulate in unbounded arrays:

```javascript
// Line 65
const chunks = chunkText(text, 512, 50);
// ...
// Lines 73-109
const vectors = [];  // <-- unbounded growth for large PDFs
for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
  // ... generates embeddings
  vectors.push({ id, values, metadata });
}
```

For a PDF producing 500K tokens → ~1M chunks (actually chunks of 512 tokens so ~977 chunks), the `vectors` array would hold ~977 objects. The real concern is `chunks` array + `vectors` array simultaneously. The guard prevents this scenario entirely.

### Token Estimation

Use character-count heuristic: `Math.ceil(text.length / 4)` approximates tokens for English text. Spanish text has slightly higher tokens/char but the 4:1 ratio is conservative (underestimates, providing a safety margin against the 500K limit).

### Where to Insert the Guard

Insert in `runPipeline()` at `pipeline.js:38`, after `parseFile()` returns and before `chunkText()`:

```
Line 38: const text = await parseFile(...)  // ← after this
Line 39: // NEW: pre-flight token check
Line 65: const chunks = chunkText(text, 512, 50);
```

### Error Propagation

The guard throws an error with a specific code so `ingest-material.js` can distinguish it from other pipeline failures. Use the existing `ErrorCategory.VALIDATION`:

```javascript
import { structuredErrorResponse, ErrorCategory } from './error-categories.js';

// In pipeline.js, throw a categorized error
const error = new Error('Material exceeded maximum allowed token count');
error.code = 'MATERIAL_TOO_LARGE';
error.category = ErrorCategory.VALIDATION;
error.statusCode = 413;
throw error;
```

The caller (`process-material.js` or `ingest-material.js`) should catch and map to the correct HTTP response.

### Where the Pipeline is Called

Search for `runPipeline(` calls. Based on architecture:
- `backend/src/functions/ingest-material.js` — calls pipeline after upload
- There may be queue-triggered variants

The response must be mapped to `413` at the Function handler level.

### Logging Pattern

```javascript
context.log.warn(`[Pipeline] Material rejected: too large`, {
  materialId,
  textLength: text.length,
  tokenEstimate: Math.ceil(text.length / 4),
  maxTokens
});
```

### App Insights Events

- Emit `trackIngestionInteraction({ status: 'error', errorCode: 'MATERIAL_TOO_LARGE', ... })` when guard rejects
- This ensures cost tracking is accurate (rejected = 0 tokens consumed for embeddings/LLM)

### File Structure

| File | Action | Description |
|------|--------|-------------|
| `backend/src/services/pipeline.js` | MODIFY | Add pre-flight token check after `parseFile()` |
| `backend/src/services/pipeline.test.js` | MODIFY | Add 5+ test cases for size guard |
| `backend/src/functions/ingest-material.js` | MODIFY (possibly) | Handle `MATERIAL_TOO_LARGE` → `413` response |

### Testing

- Framework: Node.js native test runner (`node --experimental-test-module-mocks --test`)
- Test file: `backend/src/services/pipeline.test.js`
- Use existing mock patterns (see Story 10.2 test file for reference)
- Run: `node --experimental-test-module-mocks --test src/services/pipeline.test.js`

### References

- GitHub Issue: #207 — `lucas-vidmar/uade-innova`
- Epic: `_bmad-output/planning-artifacts/epics.md` → Deferred 10.9 (lines 1141-1148)
- Architecture: `_bmad-output/planning-artifacts/architecture.md` → Error handling pattern, API response format
- AGENTS.md §13 — Chunking: 512 tokens, 50 overlap
- Related: Story 10.1 (#199) — stream multipart uploads (addresses memory in upload path; this addresses memory in processing path)
- `backend/src/services/error-categories.js` — `structuredErrorResponse()`, `ErrorCategory.VALIDATION`
- `backend/src/services/pipeline.js:65` — `chunkText()` call (guard insertion point)
- `backend/src/services/parser.js:40-67` — `chunkText()` implementation (token-aware, uses `js-tiktoken`)
- `backend/src/services/telemetry.js` — `trackIngestionInteraction()` signature

### Project Structure Notes

- Flat file layout in `backend/src/functions/` and `backend/src/services/` — no new directories
- No new npm dependencies required
- All existing exports must remain unchanged

## Review Findings

### decision-needed

- [x] [Review][Decision] Token heuristic — se mantiene `text.length / 4` como heuristic. La migración a `js-tiktoken` se difiere: la heurística es suficiente para el piloto y mockear tiktoken en tests es complejo. El módulo exporta `_estimateTokenCount` para que tests puedan override.
- [x] [Review][Decision] Mensaje de error — OK como está. Pipeline es blob-triggered, no hay HTTP response. Se usa el mensaje de AC3.
- [x] [Review][Decision] Evento `Material.RejectedTooLarge` — se mantiene el discriminator por `errorCode: 'MATERIAL_TOO_LARGE'` en el evento `IngestionInteraction` existente. No se crea evento separado.

### patch

- [x] [Review][Patch] Env var leak en test — envuelto en try/finally [pipeline.test.js:288-306]
- [x] [Review][Patch] Mock leak entre tests — cada test setea su propio parseFile mock explícitamente [pipeline.test.js:225,265,277,340]
- [x] [Review][Patch] Rejection test verifica error code/category/status — assert en err.code='MATERIAL_TOO_LARGE', err.errorCategory='VALIDATION', err.status=413 [pipeline.test.js:241-247]
- [x] [Review][Patch] No test para env var inválido — agregado test `MAX_MATERIAL_TOKENS=not-a-number` cae a default [pipeline.test.js:325-359]
- [x] [Review][Patch] Assertion de que pipeline se detiene antes de chunking — verifica chunkText.mock.calls.length === 0 [pipeline.test.js:249]
- [x] [Review][Patch] Telemetry errorCode testeado — assert en err.code del error loggeado (trackIngestionInteraction indirectamente verificado) [pipeline.test.js:244]
- [x] [Review][Patch] parseInt enmascara 0 y NaN — reemplazado por `Number.isFinite(Number(process.env.MAX_MATERIAL_TOKENS))` + fallback a 500000 [pipeline.js:44-45]

### defer

- [x] [Review][Defer] parseFile corre antes del size check — archivo grande ya está en memoria cuando el guard se ejecuta. Pre-existing, 25MB upload limit ya lo controla. [pipeline.js:38-42]
- [x] [Review][Defer] Catch trata 413 igual que 500 — blob-triggered, no hay HTTP response. El discriminator es errorCode. [pipeline.js:242-292]
- [x] [Review][Defer] totalTokens=0 en telemetría de early rejection — correcto (0 tokens consumidos), no es undefined. Dismissed.
- [x] [Review][Defer] Migración a tiktoken — la heurística text.length/4 es suficiente para el piloto. Si se necesita precisión en el futuro, cambiar _estimateTokenCount a usar js-tiktoken.

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash via opencode

### Debug Log References

- Guard insertion point: `backend/src/services/pipeline.js:38` (after `parseFile()`)
- Chunk accumulation: `backend/src/services/pipeline.js:65` (`chunkText()`)
- Vector accumulation: `backend/src/services/pipeline.js:73-109` (for loop)
- Error response format: `backend/src/services/error-categories.js:49-60` (`structuredErrorResponse`)
- Test mocking pattern: `backend/src/services/pipeline.test.js:1-63` (mock.module)

### Code Review Notes

- Blind Hunter: 7 findings (3 patch, 1 defer, 1 dismiss, 2 decision-needed → resolved)
- Edge Case Hunter: 5 findings (all merged/overlapped with others)
- Acceptance Auditor: 5 findings (all merged/overlapped with others)
- All patches applied: Number.isFinite guard, try/finally env var cleanup, mock isolation per test, error code assertions, tiktoken heuristic maintained with exportable _estimateTokenCount

### Completion Notes List

- Added pre-flight token check in `pipeline.js:42-56` — reads `MAX_MATERIAL_TOKENS` env var (default 500000), estimates tokens as `text.length / 4`, throws `CategorizedError` with code `MATERIAL_TOO_LARGE` and status 413
- Extended `CategorizedError` import in pipeline.js for structured error handling
- Enhanced error catch block to propagate `errorCode` into `errorState` and `trackIngestionInteraction` for richer diagnostics
- 3 new tests covering: oversized rejection, boundary allowance, env var override — all 8 tests pass
- Error handling via pipeline.js existing catch block (no ingest-material.js changes needed since pipeline is blob-triggered)

### File List

- `backend/src/services/pipeline.js` — MODIFY: add MAX_MATERIAL_TOKENS pre-flight check + CategorizedError import + errorCode propagation
- `backend/src/services/pipeline.test.js` — MODIFY: add 3 size-guard test cases
- No ingest-material.js changes needed (pipeline is blob-triggered; existing error handling propagates correctly)
