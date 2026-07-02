---
baseline_commit: f561a0c28f55f071a6d9d778f0072d0a72a38681
---

# Story 10.2: Validate Content Encoding for Transcript Files (File Spoofing Fix)

Status: done

## Story

As a platform operator,
I want `.txt` and `.vtt` transcript uploads content-validated,
so that an attacker cannot upload a malicious executable disguised as a plain-text transcript.

## Acceptance Criteria

1. **UTF-8 Content Validation**
   Given a file is uploaded with `materialType: "transcript"` and extension `.txt` or `.vtt`
   When `validateFileType(buffer, 'transcript', context)` runs in `ingest-material.js:151`
   Then it does NOT unconditionally return `true`
   And it verifies the first 4 KB decodes as valid UTF-8 with no NUL bytes (`\x00`) and no control characters outside `\t\r\n`

2. **Binary File Rejection**
   Given an attacker uploads `malware.exe` renamed to `transcript.txt`
   When `validateFileType` inspects the buffer
   Then it detects non-printable byte sequences and returns `false`
   And the Function returns `400` with message: `"El archivo no es un texto válido (UTF-8). Verificá el formato."`
   And the rejection is logged in App Insights with the `materialId` and detected byte pattern (sanitized)

3. **UTF-8 BOM Handling**
   Given a legitimate VTT file with UTF-8 BOM is uploaded
   When `validateFileType` runs
   Then the BOM (`EF BB BF`) is recognized and skipped
   And validation passes for the remaining content

4. **UTF-16 Rejection**
   Given a file with UTF-16 BOM (`FF FE` or `FE FF`) is uploaded as transcript
   When `validateFileType` runs
   Then it returns `false`

5. **Extension Allowlist**
   Given any file is uploaded with `materialType: "transcript"`
   When the file extension is not `.txt` or `.vtt`
   Then validation returns `false`

6. **Empty File Handling**
   Given a 0-byte file is uploaded as transcript
   When `validateFileType` runs
   Then it returns `false` (handled by existing `< 4` length check)

## Tasks / Subtasks

- [x] Harden `validateFileType()` `transcript` case in `backend/src/functions/ingest-material.js` (AC: 1-6)
  - [x] Add UTF-8 decode + NUL byte + control char check on first 4 KB
  - [x] Add UTF-8 BOM skip (`EF BB BF`)
  - [x] Reject UTF-16 BOMs (`FF FE`, `FE FF`)
  - [x] Enforce extension allowlist (`.txt`, `.vtt`) via `path.extname()`
  - [x] Log rejected uploads to App Insights with `materialId` + sanitized byte pattern
- [x] Add unit tests in `backend/src/functions/ingest-material.test.js` (AC: 1-5)
  - [x] Legitimate VTT with UTF-8 BOM
  - [x] Legitimate TXT file (ASCII/UTF-8)
  - [x] EXE-disguised-as-TXT (NUL bytes + control chars)
  - [x] UTF-16 file (`FF FE` BOM)
  - [x] Empty file
  - [x] Wrong extension (`.pdf` labeled as transcript)
- [ ] Deploy and verify: upload a binary file as transcript → 400 response

### Code Review Findings

- [x] [Review][Patch] Real UTF-8 validation with TextDecoder (fatal=true) — replaces byte-range heuristics [ingest-material.js:176-188]
- [x] [Review][Patch] materialId logged on rejection — uuidv4() moved before validation, passed to validateFileType, logged in every warn message [ingest-material.js:58-64]
- [x] [Review][Patch] fileName guard — null/undefined/empty fileName rejected before extension check [ingest-material.js:161-165]
- [x] [Review][Patch] Division by zero guard — empty content after BOM skip returns false [ingest-material.js:182-185]
- [x] [Review][Patch] Integer arithmetic for threshold — nonPrintableCount * 100 > content.length replaces FP division [ingest-material.js:195-200]
- [x] [Review][Patch] Invalid UTF-8 rejection — TextDecoder with fatal=true catches overlong encodings, surrogates, truncated sequences [ingest-material.js:187-191]
- [x] [Review][Patch] fileName sanitization in logs — sanitizeFileName() strips control chars, caps at 120 chars [ingest-material.js:151-153]
- [x] [Review][Patch] Optional chaining on context.log.warn — uses context?.log?.warn?.(...) to prevent TypeError [ingest-material.js:156]
- [x] [Review][Defer] Other material types lack content validation — pre-existing, out of scope for story 10.2 [ingest-material.js:196-218]

## Dev Notes

### File to Modify

- `backend/src/functions/ingest-material.js` — `validateFileType()` function at line 151; `transcript` case at line 157

### Current Baseline (bug)

```javascript
case 'transcript':
    // TXT, VTT — plain text. No magic bytes, check for printable ASCII / UTF-8.
    return true;
```

The `fileHeader` buffer (up to 8 KB) is already available from the streaming architecture built in Story 10.1 (`parseMultipart()` at line 206, 240-243). Use `buffer.slice(0, 4096)` from the passed-in `fileHeader` for validation. No plumbing changes needed.

### Algorithm

```
1. Check extension via path.extname(fileName) — must be .txt or .vtt, else return false
2. If buffer.length < 4, return false (existing guard)
3. If buffer starts with UTF-16 LE BOM (FF FE) or UTF-16 BE BOM (FE FF), return false
4. If buffer starts with UTF-8 BOM (EF BB BF), advance offset by 3
5. Decode first 4 KB (from offset) as UTF-8; if decode fails, return false
6. Scan for NUL (\x00) — reject if found
7. Scan for control chars outside allowed set (\t, \r, \n) — reject if >1% of bytes
8. Return true
```

### Error Handling Pattern (from architecture.md)

Use existing `structuredErrorResponse()`:
```javascript
return structuredErrorResponse(400, 'El archivo no es un texto válido (UTF-8). Verificá el formato.', ErrorCategory.VALIDATION, 'FILE_CONTENT_INVALID');
```

### Logging Pattern

```javascript
context.log.warn(`[Ingest] File content validation failed for transcript`, {
    materialId,
    fileName,
    reason: 'utf8_decode_failed',  // or 'nul_bytes_detected', 'control_chars_exceeded', etc.
    headerPreview: buffer.slice(0, 16).toString('hex')
});
```

### Testing

Tests should be added to `backend/src/functions/ingest-material.test.js`. Use the existing test setup (mocha/chai pattern from other function tests in the project — see `rag-query.test.js` or `vector-health.test.js`).

Test cases:
1. `valid VTT with UTF-8 BOM` — buffer starts with `EF BB BF` followed by valid UTF-8 text → returns `true`
2. `valid TXT ASCII` — plain ASCII text → returns `true`
3. `EXE disguised as TXT` — `4D 5A 90 00...` (MZ header) first bytes → returns `false`
4. `UTF-16 LE file` — `FF FE` followed by valid UTF-16 → returns `false`
5. `empty file` — buffer.length < 4 → returns `false`
6. `wrong extension` — fileName = `doc.pdf`, materialType = `transcript` → returns `false`

### Out of Scope

- Antivirus scanning (post-MVP, needs Azure Defender for Storage)
- MIME type sniffing via `file-type` library (magic bytes for text are ambiguous by design)

### References

- [Source: GitHub Issue #200](https://github.com/lucas-vidmar/uade-innova/issues/200)
- [Source: `epics.md` §Story 10.2]
- [Source: `architecture.md` §Error Handling]
- [Source: `AGENTS.md` §13 — UTF-8 / file parsing matrix]
- [Source: `sprint-status.yaml` — Epic 10 in-progress]

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash

### Debug Log References

- Current file: `backend/src/functions/ingest-material.js:155-225`
- Calling context: `ingest-material.js:66` — `validateFileType(fileHeader, materialType, fileName, materialId, context)`
- `fileHeader` captured at `ingest-material.js:278-281` (up to 8 KB from stream)
- Error response format at `ingest-material.js:68-74`

### Completion Notes List

- Story 10.1 (stream multipart uploads) already provides `fileHeader` buffer — no need to re-plumb
- Sprint status has a stale `10-2-structured-logging-and-debug-observability: done` entry; this was a different task. The canonical story per GitHub Issues #200 is this one.
- Implemented UTF-8 content validation for transcript files: NUL byte rejection, control char ratio check (<1%), UTF-8 BOM skip, UTF-16 BOM rejection, extension allowlist (.txt/.vtt)
- Added error message "El archivo no es un texto válido (UTF-8). Verificá el formato." and error code `FILE_CONTENT_INVALID`
- Export `validateFileType` for testability
- Code review applied 8 patches: TextDecoder with fatal=true for real UTF-8 validation, materialId logging, fileName guard, integer arithmetic threshold, division-by-zero guard, log sanitization, optional chaining on context.log.warn
- 23 unit tests covering all ACs + extra (invalid UTF-8, null fileName, empty fileName) — all passing

### File List

| File | Action |
|------|--------|
| `backend/src/functions/ingest-material.js` | MODIFY (validateFileType rewrite + materialId moved + sanitizeFileName helper) |
| `backend/src/functions/ingest-material.test.js` | CREATE (23 test cases) |
