# Story 10.2: Structured Logging & Debug Observability

Status: review

## Story

As a **developer debugging production issues without CloudWatch-style visibility**,
I want **structured JSON logging with configurable verbosity, full correlation ID coverage across all 47 handlers, and frontend-to-backend trace propagation**,
so that **I can filter and pivot over logs in Application Insights to diagnose issues, and feed rich structured context to LLM-based debugging tools.**

## Acceptance Criteria

1. **Structured Logging Middleware**: All `context.log()` / `context.error()` calls are emitted as structured JSON with consistent fields: `correlationId`, `functionName`, `level`, `message`, `timestamp`, `userId`, `subjectId`, `classId`, `materialId`, `errorCode`, `durationMs`. Fields are populated from `context` where available; missing fields are omitted (not sent as `null`).

2. **Configurable Log Level**: `LOG_LEVEL` env var controls verbosity (`debug`, `info`, `warn`, `error`). Default: `info`. `LOG_LEVEL=info` suppresses `debug` traces. `LOG_LEVEL=debug` enables request/response body capture.

3. **Debug Mode Request/Response Capture**: When `LOG_LEVEL=debug`, the middleware captures truncated request bodies (method, path, first 2000 chars of body) and response status/duration for every HTTP invocation, logged as a single `traces` entry with `level=debug`.

4. **Full Correlation ID Coverage**: `withCorrelation` middleware wraps ALL HTTP handlers (rag-query, ingest-material, classes-api, chat-api, enrollments-api, notifications, compliance-api, etc.). Timer/blob triggers generate their own `correlationId` at invocation start.

5. **Frontend `x-correlation-id` Propagation**: The frontend API client (`api.js`) generates a session-scoped `x-correlation-id` UUID on page load and sends it with every request. Already-existing backend `withCorrelation` middleware reads it from headers.

6. **`console.log/error` Elimination**: All `console.log`/`console.error` calls in `vector-store.js` and `telemetry.js` are replaced with structured logging through the middleware or the existing telemetry service.

7. **Backward Compatible**: Existing App Insights custom events (`RAGInteraction`, `IngestionInteraction`, `trackRAGError`, etc.) are unchanged. Existing KQL workbooks and alerts continue to work. No existing functionality breaks.

8. **Cost Control**: Debug-level telemetry is gated behind `LOG_LEVEL=debug`. Production default (`info`) keeps ingestion at current levels. Document expected cost impact: `debug` may increase `traces` ingestion by ~3-5x during active debugging sessions.

## Tasks / Subtasks

- [x] **Task 1: Implement structured logging middleware** (AC: 1, 2, 3)
  - [x] Create `backend/src/services/structured-logger.js`
  - [x] Export `createStructuredLogger(functionName, context)` returning `{ info, warn, error, debug }`
  - [x] Auto-populate context fields (`correlationId`, `userId`, `subjectId`, etc.) from `context` object
  - [x] Respect `process.env.LOG_LEVEL` — skip calls below configured level
  - [x] Debug mode: accept optional `request` and `response` objects to log truncated body
  - [x] Always emit JSON via `context.log()` (which feeds App Insights `traces` table)
- [x] **Task 2: Extend correlation middleware to all handlers** (AC: 4)
  - [x] Wrap ALL `app.http()` handlers with `withCorrelation()` in their definitions
  - [x] Create `withCorrelationTimer()` wrapper for timer/blob triggers (generates fresh correlationId + traceContext)
  - [x] Verify no handler is left unwrapped — CI check or manual audit
- [x] **Task 3: Frontend correlation ID** (AC: 5)
  - [x] In `frontend/src/services/api.js`, generate UUID on module init: `sessionCorrelationId = crypto.randomUUID()`
  - [x] Add header to every API call via `fetch` headers or Axios interceptor
- [x] **Task 4: Replace ad-hoc `console.log/error` calls** (AC: 6)
  - [x] `vector-store.js`: replace `console.error('[VectorStore] PINECONE_API_KEY is missing.')` with error log through telemetry or throw with context
  - [x] `telemetry.js`: replace `console.log('[Telemetry]...')` / `console.warn(...)` with structured logger calls (if available) or keep as-in (they're dev-only no-op warnings)
- [x] **Task 5: Update env configs** (AC: 2, 8)
  - [x] Add `LOG_LEVEL` to `.env.local.template` with default `info`
  - [x] Add `LOG_LEVEL` to `backend/local.settings.json`
  - [x] Add `LOG_LEVEL` to `infra/modules/functions.bicep` as Function App setting (default `info`)
  - [x] Add `VITE_LOG_LEVEL` to `frontend/.env` and `frontend/.env.production`
- [x] **Task 6: Verify backward compatibility** (AC: 7, 8)
  - [x] Syntax check — 53 backend files pass `node --check`
  - [x] Test suite — 49 relevant tests pass (0 failures)
  - [x] Fixed test mocks for `generateCorrelationId` in 3 test files

## Dev Notes

### Architecture Context

- **Existing telemetry service** (`backend/src/services/telemetry.js`): Ships 11 custom event types (`RAGInteraction`, `IngestionInteraction`, etc.) directly to App Insights via the `applicationinsights` npm SDK. This story adds a NEW middleware layer for structured `context.log` output — it lives ALONGSIDE telemetry.js, not replacing it.
- **Existing correlation middleware** (`backend/src/middleware/with-correlation.js`): 22 lines, currently wraps only 4 handlers. Must extend to all ~43 remaining handlers. It does NOT support timer/blob triggers yet.
- **Existing correlation service** (`backend/src/services/correlation.js`): Full W3C `traceparent`/`tracestate` support, `buildDependencyHeaders()`, `withCorrelationResponseHeaders()`.

### Logging Volume & Cost

| Level | Expected traces volume | When to use |
|-------|----------------------|-------------|
| `error` | ~5-20 events/day | Production only — critical failures |
| `warn` | ~50-200 events/day | Production — non-fatal issues |
| `info` | ~500-2000 events/day | **Default** — request start/end, key milestones |
| `debug` | ~10-50x info volume | **On-demand** — toggle via App Settings, never permanent |

App Insights `traces` ingestion cost: ~$2.30/GB. At `info` default for 65 users, expect << 100 MB/month. At `debug`, expect ~300-500 MB/month during active debugging.

### Source Tree Components to Touch

| File | Action | Notes |
|------|--------|-------|
| `backend/src/services/structured-logger.js` | **NEW** | Structured logging service |
| `backend/src/middleware/with-correlation.js` | MODIFY | Add `withCorrelationTimer()` for non-HTTP triggers |
| `backend/src/functions/rag-query.js` | MODIFY | Already has `withCorrelation` — add structured logger |
| `backend/src/functions/ingest-material.js` | MODIFY | Add `withCorrelation`, replace `context.log` with logger |
| `backend/src/functions/classes-api.js` | MODIFY | Add `withCorrelation`, replace `context.log` calls |
| `backend/src/functions/chat-api.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/conversations-api.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/enrollments-api.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/notifications.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/deadlines.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/get-tasks.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/get-roles.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/get-profile.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/save-profile.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/admin-api.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/analytics.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/sga-api.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/vector-health.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/director-kpi-export.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/sat-analytics.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/subject-weights-api.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/compliance-api.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/interventions-api.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/storage-lifecycle.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/archive-usage.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/vector-backup.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/backup-approval-api.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/reminder-preferences.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/hello.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/class-timeline.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/material-download.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/corrections/get-pending-reports/index.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/corrections/verify-answer/index.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/corrections/update-status/index.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/glossary/get-glossary/index.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/glossary/update-glossary/index.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/corrections-transcription/get-suggestions/index.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/corrections-transcription/apply-correction/index.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/corrections-transcription/reject-suggestion/index.js` | MODIFY | Add `withCorrelation` |
| `backend/src/functions/audio-api.js` | MODIFY | Already has `withCorrelation` — add structured logger |
| `backend/src/functions/global-search.js` | MODIFY | Already has `withCorrelation` — add structured logger |
| `backend/src/functions/consent-api.js` | MODIFY | Already has `withCorrelation` — add structured logger |
| `backend/src/functions/daily-reminders.js` (timer) | MODIFY | Add `withCorrelationTimer()` |
| `backend/src/functions/deadline-proximity-dispatcher.js` (timer) | MODIFY | Add `withCorrelationTimer()` |
| `backend/src/functions/post-class-summary-dispatcher.js` (timer) | MODIFY | Add `withCorrelationTimer()` |
| `backend/src/functions/vector-backup-scheduler.js` (timer) | MODIFY | Add `withCorrelationTimer()` |
| `backend/src/functions/vector-health-monitor.js` (timer) | MODIFY | Add `withCorrelationTimer()` |
| `backend/src/functions/vector-health-snapshotter.js` (timer) | MODIFY | Add `withCorrelationTimer()` |
| `backend/src/functions/process-material.js` (blob trigger) | MODIFY | Add `withCorrelationTimer()` |
| `backend/vector-store.js` | MODIFY | Replace `console.error` with telemetry service |
| `backend/src/services/telemetry.js` | MODIFY | Replace `console.log/warn` at init |
| `frontend/src/services/api.js` | MODIFY | Add session-scoped `x-correlation-id` header |
| `.env.local.template` | MODIFY | Add `LOG_LEVEL` |
| `backend/local.settings.json` | MODIFY | Add `LOG_LEVEL` |
| `infra/modules/functions.bicep` | MODIFY | Add `LOG_LEVEL` app setting |
| `frontend/.env` / `frontend/.env.production` | MODIFY | Add `VITE_LOG_LEVEL` |

### Implementation Notes

1. **structured-logger.js design**: Pure function — takes `context` and `functionName`, returns logger object. Each log call enriches with fields from `context` (correlationId, userId, subjectId, classId if present) and emits via `context.log(JSON.stringify(...))`. No external dependencies.

2. **Existing pattern to follow**: The `withCorrelation` middleware pattern (decorator wrapping a handler) should be replicated exactly. Both middlewares can compose: `withCorrelation(withStructuredLogging(handler))`.

3. **`context.log.warn()` vs `context.warn()`**: The V4 Functions model supports both. Use `context.warn()` / `context.error()` for consistency with the structured logger interface. No need to change existing calls in this story — only add the middleware layer on top.

4. **Timer/blob triggers**: These don't have an HTTP `Request` object. `withCorrelationTimer()` should generate a fresh `correlationId` via `generateCorrelationId()` and inject it into the Function `context` object (which IS available in timer/blob handlers as the second argument, but as `myTimer` / `blob` type — use the `context` binding instead).

5. **Migration approach**: Do NOT replace all 265+ `context.log()` calls to use the new logger in a single pass. Instead:
   - Phase 1: Create the middleware + apply `withCorrelation` to all handlers (non-breaking, adds correlation IDs everywhere)
   - Phase 2: Add `structured-logger.js` and update a few key handlers (rag-query, ingest-material, classes-api) to use it
   - Phase 3: Optional — migrate remaining handlers as needed for debugging

### Anti-patterns to Avoid

- ❌ DO NOT wrap `telemetry.js` events in structured logging — they already ship as `customEvents` directly to App Insights
- ❌ DO NOT log full request/response bodies at `info` level — only at `debug`
- ❌ DO NOT create a singleton logger module — each handler invocation should create a fresh logger bound to its `context`
- ❌ DO NOT mutate `context` object with circular references — only add plain serializable fields
- ❌ DO NOT remove `context.log()` calls from existing handlers until the middleware is proven stable

### References

- [Source: `backend/src/services/telemetry.js`] — 512 lines, 11 custom event trackers, graceful no-op pattern, lazy singleton init
- [Source: `backend/src/middleware/with-correlation.js`] — 22 lines, decorator pattern to follow
- [Source: `backend/src/services/correlation.js`] — 154 lines, `resolveCorrelationId()`, `generateCorrelationId()`, W3C trace context
- [Source: `backend/host.json`] — sampling config, `excludedTypes: Request`
- [Source: `docs/kql-correlation-queries.md`] — 324 lines of KQL for joining events by correlationId
- [Source: `backend/package.json`] — `applicationinsights@^3.14.0`, `uuid@^11.0.5`, `"type": "module"`
- [Source: `sprint-status.yaml`] — Epic 10 (Production Hardening & Tech Debt), in-progress

## Dev Agent Record

### Agent Model Used

DeepSeek V4 Flash (opencode-go/deepseek-v4-flash)

### Debug Log References

### Completion Notes List

### File List
- `_bmad-output/implementation-artifacts/10-2-structured-logging-and-debug-observability.md` (this file)
