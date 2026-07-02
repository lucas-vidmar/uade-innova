---
title: 'Centralize correlation handling in shared backend middleware'
type: 'refactor'
created: '2026-06-20'
status: 'done'
baseline_commit: '78184a237220b4078da6c40e240bbb1396e15b4c'
context:
  - 'backend/src/services/correlation.js'
  - 'backend/src/services/correlation.test.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Correlation ID resolution, trace context parsing, outbound dependency headers, and response header injection are duplicated across the 4 functions that implement them (`rag-query`, `global-search`, `audio-api`, `consent-api`), while ~45 other HTTP functions have no correlation handling at all. Each new function must reimplement the same 4 imports and calls.

**Approach:** Create a `withCorrelation` higher-order function that wraps any Azure Functions V4 HTTP handler, automatically resolving correlation ID, parsing W3C trace context, injecting dependency headers into `context`, and attaching correlation response headers to every response. Migrate the 4 existing functions to use it. Add usage docs for new functions.

## Boundaries & Constraints

**Always:**
- Created in `backend/src/middleware/with-correlation.js` as a single exported `withCorrelation(handler)` function
- Wrapper attaches `correlationId`, `traceContext`, and `dependencyHeaders` to the Azure Functions `context` object
- Every response from the wrapped handler receives correlation and trace response headers
- Legacy 2-arg pattern `withCorrelationResponseHeaders(cid, baseHeaders)` remains supported in `correlation.js`
- Existing behavior and tests for `rag-query`, `global-search`, `audio-api`, `consent-api` must pass with no regressions after migration

**Ask First:**
- Whether to also add a convenience `response(headers, body)` helper alongside the middleware

**Never:**
- No Express/Koa/Fastify dependency — must use native Azure Functions V4 programming model
- No changes to non-HTTP triggers (blob/timer triggers don't need correlation middleware)
- No changes to `correlation.js` API — the existing exports must remain unchanged and backward compatible

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Handler returns standard response object | `{ status, headers, body }` | Correlation headers merged into response | N/A |
| Handler throws | Handler throws an error | Middleware does not catch — error propagates naturally to Azure Functions runtime | N/A |
| Handler returns null/undefined | Handler returns `undefined` | Middleware skips header injection and returns as-is | N/A |
| No inbound correlation header | Request has no `x-correlation-id` | Middleware generates UUID, sets it on context and response | N/A |
| With inbound correlation header | Request has `x-correlation-id: abc-123` | Middleware preserves it, propagates to context, dependency headers, and response | N/A |
| Handler sets extra custom headers | Handler returns `{ headers: { 'x-custom': 'val' } }` | Custom headers preserved and merged with correlation headers | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/middleware/with-correlation.js` — new file: `withCorrelation(handler)` higher-order function
- `backend/src/middleware/with-correlation.test.js` — new file: unit tests for the wrapper
- `backend/src/functions/rag-query.js` — migrate to use `withCorrelation`
- `backend/src/functions/global-search.js` — migrate to use `withCorrelation`
- `backend/src/functions/audio-api.js` — migrate to use `withCorrelation`
- `backend/src/functions/consent-api.js` — migrate to use `withCorrelation`
- `docs/correlation-middleware.md` — new file: usage guide for developers adding new functions

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/middleware/with-correlation.js` — create middleware that wraps HTTP handlers, resolves correlation, injects into context, adds response headers
- [x] `backend/src/middleware/with-correlation.test.js` — unit test the wrapper for: happy path, missing header, handler custom headers, handler error passthrough, no handler return
- [x] `backend/src/functions/rag-query.js` — replace manual `resolveCorrelationId`/`resolveTraceContext`/`buildDependencyHeaders`/`withCorrelationResponseHeaders` with `withCorrelation` wrapper; simplify `jsonResponse` helper
- [x] `backend/src/functions/global-search.js` — replace manual correlation pattern with `withCorrelation` wrapper
- [x] `backend/src/functions/audio-api.js` — replace manual correlation pattern with `withCorrelation` wrapper
- [x] `backend/src/functions/consent-api.js` — replace manual correlation pattern with `withCorrelation` wrapper
- [x] `docs/correlation-middleware.md` — document middleware usage with a new function template

**Acceptance Criteria:**
- Given the correlation middleware, when a wrapped handler returns a response, then `x-correlation-id` is present in the response headers
- Given the correlation middleware with an inbound `x-correlation-id`, when the handler accesses `context.correlationId`, then it equals the inbound value
- Given the correlation middleware, when the handler accesses `context.dependencyHeaders`, then it contains `x-correlation-id` and optional `traceparent` for downstream calls
- Given the correlation middleware, when a handler throws, then the error propagates normally (no silent swallow)
- Given the 4 migrated functions, when their existing test suites run, then all tests pass with no regressions (including correlation ID propagation assertions)

## Verification

**Commands:**
- `node --experimental-vm-modules node_modules/.bin/node --test backend/src/middleware/with-correlation.test.js` — expected: all tests pass
- `node --experimental-vm-modules node_modules/.bin/node --test backend/src/functions/rag-query.test.js` — expected: 0 failures
- `node --experimental-vm-modules node_modules/.bin/node --test backend/src/functions/global-search.test.js` — expected: 0 failures

**Manual checks (if no CLI):**
- Verify `rag-query.js` no longer imports `resolveCorrelationId`, `resolveTraceContext`, `buildDependencyHeaders` directly
- Verify each migrated function's handler is wrapped as `withCorrelation(async (request, context) => { ... })`

## Suggested Review Order

**Middleware design**

- New HOF that auto-resolves correlation/trace, injects into context, and attaches response headers
  [`with-correlation.js:3`](../../backend/src/middleware/with-correlation.js#L3)

- Unit tests covering all edge cases (6 tests, 0 failures)
  [`with-correlation.test.js:44`](../../backend/src/middleware/with-correlation.test.js#L44)

**rag-query migration (largest blast radius — 21 tests, 0 failures)**

- Handler wrapped, boilerplate removed, correlation read from context
  [`rag-query.js:321`](../../backend/src/functions/rag-query.js#L321)

- `jsonResponse` and `handleErrorResponse` simplified — middleware handles headers
  [`rag-query.js:231`](../../backend/src/functions/rag-query.js#L231)

- `openAiHeaders` → `dependencyHeaders` reference (embedding, chat, rewrite)
  [`rag-query.js:386`](../../backend/src/functions/rag-query.js#L386)

- Streaming responses no longer manually spread correlation headers
  [`rag-query.js:730`](../../backend/src/functions/rag-query.js#L730)

**global-search migration (4 tests, 0 failures)**

- Handler wrapped, all manual correlation calls removed
  [`global-search.js:47`](../../backend/src/functions/global-search.js#L47)

**audio-api migration**

- Handler wrapped, 10 manual `withCorrelationResponseHeaders` calls removed
  [`audio-api.js:15`](../../backend/src/functions/audio-api.js#L15)

**consent-api migration (3 handlers migrated)**

- Three separate handlers (`consent-get`, `consent-post`, `terms-get`) wrapped
  [`consent-api.js:45`](../../backend/src/functions/consent-api.js#L45)

- Shared `jsonResponse` helper simplified — no longer passes correlationId
  [`consent-api.js:11`](../../backend/src/functions/consent-api.js#L11)

**Developer docs**

- Usage guide with template for new functions
  [`correlation-middleware.md:1`](../../docs/correlation-middleware.md#L1)
