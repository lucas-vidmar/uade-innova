---
title: 'Director Session Metrics History Filtering by Subject'
type: 'feature'
created: '2026-06-18'
baseline_commit: 922dd9b4cbefbfcdb757caa03c1c92007e6ceb91
status: 'done'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The `GET /api/director/session-metrics-history` endpoint (backlog) returns all session metrics without filtering by subject. Directors need to analyze semester usage per materia — loading all rows forces post-filtering on the client, which is wasteful and exposes data from unrelated subjects.

**Approach:** Add an optional `subjectId` query parameter to the new `GET /api/director/session-metrics-history` endpoint. When provided, results are restricted to rows matching that subject. When omitted, all rows are returned (backward compatible). Follow the existing pattern from `get-director-powerbi-metrics`.

## Boundaries & Constraints

**Always:**
- Director role required (same auth pattern as `get-director-stats`)
- `subjectId` must be an optional query parameter — never required
- Results must remain backward compatible: omitting `subjectId` returns all rows
- Follow existing code patterns: `request.query.get('subjectId')`, `loadSessionMetricsRows()`, post-filter pattern
- Responses are JSON with `Content-Type: application/json`

**Ask First:**
- Changing the response shape beyond adding `subjectId` field to each metric
- Adding pagination support (tracked separately in issue #179)

**Never:**
- Never expose PII (student identifiers) in the response — filter out `userId` from output
- Never modify existing director endpoints (`/director/stats`, `/director/powerbi-metrics`)
- Never change the `computeDirectorMetrics` function signature
- Never introduce a new dependency or storage table

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| All rows (no filter) | No `subjectId` param | Array of all session metric rows from the window (excl. material-upload events) | N/A |
| Filter by valid subject | `subjectId=arq-software-2026` | Array of rows where row.subjectId === 'arq-software-2026' (excl. material-upload) | N/A |
| Filter by non-existent subject | `subjectId=nonexistent` | Empty array `[]` | N/A |
| Material-upload rows in data | Rows with `eventType: 'material-upload'` | Filtered out — never included in response | N/A |
| No session data | Empty SessionMetrics table | Empty array `[]` | N/A |
| Unauthorized request | No Director role | `403` with `{ error: "Forbidden - Director access required" }` | Returns 403 before processing |
| Invalid Front Door ID | Missing/Invalid x-fd-identity-header | `403` with `{ error: "Forbidden - Invalid Front Door ID" }` | Returns 403 before processing |
| subjectId with extra whitespace | `subjectId= arq-software-2026 ` | Trimmed — matches subject correctly | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/functions/classes-api.js` — Add new `get-director-session-metrics-history` HTTP route, reuse `loadSessionMetricsRows()` and existing auth pattern
- `backend/src/functions/classes-api.test.js` — Add tests for the new endpoint following existing mock patterns

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/functions/classes-api.js` — Add `GET /api/director/session-metrics-history` route with optional `subjectId` query param, Director auth, post-filter logic, and safe response shape
- [x] `backend/src/functions/classes-api.test.js` — Add tests: all rows, filter by subject, filter non-existent subject, filter excludes material-uploads, empty data, 403 for non-Director

**Acceptance Criteria:**
- Given a Director-authenticated request to GET /api/director/session-metrics-history with no subjectId, when the endpoint responds, then all session metric rows (excluding material-upload events) are returned
- Given a Director-authenticated request to GET /api/director/session-metrics-history?subjectId=X, when the endpoint responds, then only rows matching subjectId X are returned
- Given a request lacking Director role, when the endpoint is called, then a 403 response is returned
- Given existing session metrics history endpoint consumers, when subjectId is omitted, then the response shape is identical to the unfiltered case

## Verification

**Commands:**
- `node --experimental-test-module-mocks --test src/functions/classes-api.test.js` — expected: all 24 tests pass

## Suggested Review Order

**New endpoint registration**

- Entry point for the entire feature — standard Director auth, optional subjectId filter, material-upload exclusion
  [`classes-api.js:1571`](../../backend/src/functions/classes-api.js#L1571)

**Safe response shape**

- PII-safe output: userId explicitly excluded, token fields normalized to numbers
  [`classes-api.js:1600`](../../backend/src/functions/classes-api.js#L1600)

**Subject filter pattern**

- Post-filter on loaded rows, same pattern as powerbi-metrics; subjectId trimmed on both sides
  [`classes-api.js:1585`](../../backend/src/functions/classes-api.js#L1585)

**Test coverage**

- 8 tests covering: unfiltered, subject filter, non-existent subject, material-upload exclusion, empty data, 403 non-Director, 403 invalid Front Door, whitespace trimming
  [`classes-api.test.js:434`](../../backend/src/functions/classes-api.test.js#L434)
