---
title: 'Session Metrics History Pagination for Large Semester Scans'
type: 'feature'
created: '2026-06-18'
status: 'done'
baseline_commit: '08027e6144a445a003150f8bd296f605e4f64dfc'
context:
  - '_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `GET /api/director/session-metrics-history` loads the entire SessionMetrics Azure Table into memory, then filters client-side. On large semesters with thousands of rows this causes memory pressure, slow responses, and potential timeouts. Directors cannot explore historical data without loading everything.

**Approach:** Add cursor-based pagination to the endpoint using Azure Table Storage continuation tokens. Add optional `limit` and `continuationToken` query params. When params are provided, the endpoint returns one page of results with a token for the next page. Server-side OData filtering eliminates material-upload and (optionally) subjectId before pagination.

## Boundaries & Constraints

**Always:**
- Director role required (same auth pattern as existing endpoint)
- `limit` and `continuationToken` must be optional — omitting both defaults to `limit=1000` for backward compat
- `limit` clamped to [1, 1000] (Azure Table Storage maxPageSize ceiling), default 1000
- `continuationToken` is an opaque base64 string, null when no more pages
- `hasMore` boolean must be included in the response
- Server-side OData filter: `eventType ne 'material-upload'`
- When `subjectId` is provided, add OData filter: `subjectId eq '<value>'`
- Response shape is additive — existing fields (`history`, `total`) preserved; `continuationToken` and `hasMore` added
- Follow existing patterns: `normalizeLimit`, request.query.get(), same auth checks

**Ask First:**
- Renaming or removing the `total` field (currently means "total in response", stays as page count)
- Adding a `totalAll` or similar cross-page count field (requires full table scan)
- Changing the `loadSessionMetricsRows` shared function signature (affects `powerbi-metrics` and `stats` endpoints)
- Exposing the raw Azure continuation token instead of base64-encoding it

**Never:**
- Never expose PII (userId) in the response
- Never modify computeDirectorMetrics or get-director-stats endpoints
- Never introduce new storage tables or dependencies
- Never remove existing response fields

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First page (default) | GET /api/director/session-metrics-history | `{ history: [...], total: N, continuationToken: "<token>" | null, hasMore: true | false }` | N/A |
| Paginate to next page | GET /api/director/session-metrics-history?continuationToken=<token>&limit=50 | Same shape, next page of results | Invalid token → 400 `{ error: "Invalid continuation token" }` |
| Last page | Continuation token is null | `{ history: [...], total: N, continuationToken: null, hasMore: false }` | N/A |
| Filter by subjectId | GET /api/director/session-metrics-history?subjectId=arq-software-2026 | Server-side OData filter applied before pagination | N/A |
| No session data | Empty table | `{ history: [], total: 0, continuationToken: null, hasMore: false }` | N/A |
| limit exceeds max | GET /api/director/session-metrics-history?limit=9999 | limit clamped to 1000 | N/A |
| limit is 0 or negative | GET /api/director/session-metrics-history?limit=0 | limit defaulted to 1000 | N/A |
| Unauthorized request | No Director role | 403 `{ error: "Forbidden - Director access required" }` | Returns 403 before processing |
| Malformed continuationToken | GET /api/director/session-metrics-history?continuationToken=not-valid | 400 `{ error: "Invalid continuation token" }` | Returns 400 |

</frozen-after-approval>

## Code Map

- `backend/src/functions/classes-api.js` — Add paginated variant of session-metrics-history handler, create `loadSessionMetricsRowsPaginated()` helper, update existing handler
- `backend/src/functions/classes-api.test.js` — Add tests for pagination scenarios and edge cases

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/functions/classes-api.js` — Add `normalizeLimit()` helper, add `loadSessionMetricsRowsPaginated(context, { limit, continuationToken, subjectId })` using `byPage()` with OData filters, refactor `get-director-session-metrics-history` handler to use it
- [x] `backend/src/functions/classes-api.test.js` — Add tests: first page, next page, last page, subjectId + pagination, invalid token, limit clamping, backward compat (no params = default limit)

**Acceptance Criteria:**
- Given a Director-authenticated request with no pagination params, when the endpoint responds, then the first 1000 rows (excluding material-upload) are returned with a continuationToken
- Given a continuationToken from a previous response, when passed as a query param, then the next page of results is returned
- Given no more pages, when the endpoint responds, then continuationToken is null and hasMore is false
- Given a request with subjectId and pagination, when the endpoint responds, then only matching subjectId rows are returned within that page
- Given a malformed continuationToken, when the endpoint is called, then a 400 response with an error message is returned
- Given a request with limit=0, when the endpoint responds, then the default limit of 1000 is applied

## Verification

**Commands:**
- `node --experimental-test-module-mocks --test src/functions/classes-api.test.js` — expected: all tests pass

**Manual checks (if no CLI):**
- Deploy and verify via browser: call the endpoint with and without pagination params, confirm response shape and token behavior

## Spec Change Log

- Edge case hunter finding #1: limit max 5000 exceeds Azure Table 1000 ceiling. Changed to [1, 1000]. Known-bad state avoided: silent SDK clamping. KEEP: normalizeLimit with secure defaults.
- Acceptance auditor finding #6: normalizeLimit(0) returned 1 instead of fallback 1000. Fixed code. KEEP: normalizeLimit returning fallback for non-positive values.
