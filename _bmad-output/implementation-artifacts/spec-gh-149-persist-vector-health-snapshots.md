---
title: 'Persist Vector Health Snapshots for Trend Analysis'
type: 'feature'
created: '2026-06-20'
status: 'frozen'
baseline_commit: e78944069d6bb9ed3d42a1bf4f20a8bbb3c6c7d2
specLoopIteration: 2
context:
  - AGENTS.md
  - backend/src/services/vector-store.js
  - backend/src/services/storage.js
  - backend/src/functions/vector-health-monitor.js
---

<frozen-after-approval>

## Intent

**Problem:** Vector health data (index fullness, vector count) is only available in real-time via the `/api/vector-health` endpoint and the 15-min monitor's anomaly detection. There is no persistent historical record, so directors and ops teams cannot analyze capacity or growth trends over time.

**Approach:** Add a timer-triggered Function that periodically captures Pinecone index stats, persists each snapshot as a JSON blob in a date-partitioned Blob Storage container, and provides query endpoints supporting configurable time windows. A retention policy deletes snapshots older than a configurable period.

## Boundaries & Constraints

**Always:**
- Snapshots must include: provider, indexName, totalVectorCount, indexFullness, and timestamp.
- Snapshots are stored as JSON blobs in a `vector-snapshots` container, partitioned by date (`{yyyy-mm-dd}/{timestamp}.json`).
- The snapshot schedule is configurable via env var (default: every 15 minutes, aligned with existing monitor).
- A `GET /api/vector-health-snapshots` endpoint returns snapshots filtered by `?days=7|30|90` (default 7), restricted to Docente and Director roles only.
- Retention enforcement runs as part of the snapshot Function (delete blobs older than retention window), independently of whether the snapshot capture succeeds.
- A Bicep lifecycle management rule deletes `vector-snapshots/` blobs older than 730 days as a safety-net fallback.

**Ask First:**
- If the default retention period (90 days) needs to be different.
- If snapshot data should also be written to Table Storage for more efficient querying.

**Never:**
- Do not create a separate database or service for snapshot storage.
- Do not modify the existing `vector-health-monitor.js` anomaly detection logic.
- Do not store PII or user-level data in snapshots.
- Do not expose raw error messages in API responses.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Timer fires, Pinecone responds | Snapshot JSON written to `vector-snapshots/{date}/{ts}.json`; retention cleanup also runs | N/A |
| PINECONE_DOWN | Timer fires, Pinecone returns error | No snapshot written; error logged; retention cleanup still runs independently | `context.log` error; retention errors logged as warnings |
| QUERY_7_DAYS | GET /api/vector-health-snapshots?days=7 | `{ success: true, data: [...], count: N }` with snapshots from last 7 days sorted desc | Return empty `data` array if none found |
| QUERY_NO_PARAM | GET /api/vector-health-snapshots | `{ success: true, data: [...], count: N }` with 7-day default window | Return empty `data` array if none found |
| QUERY_OVER_MAX | GET /api/vector-health-snapshots?days=400 | 400 Bad Request: `days` must be between 1 and 365 | Return error JSON |
| QUERY_INVALID_DAYS | GET /api/vector-health-snapshots?days=-1 | 400 Bad Request: `days` must be a positive integer | Return error JSON |
| RETENTION_CLEANUP | Snapshot Function runs, finds blobs older than 90 days | Old blobs deleted before new snapshot written; log count of deleted blobs | Log warning if delete fails, continue execution |
| RETENTION_FAILURE_PINECONE | Timer fires, Pinecone returns error | No snapshot written; retention cleanup still runs and deletes old blobs | Each path logged independently |
| EMPTY_SNAPSHOT | First run, no prior snapshots | Snapshot written; retention cleanup skipped (nothing to delete) | N/A |
| UNAUTHORIZED_ROLE | Student user calls GET /api/vector-health-snapshots | 403 Forbidden | Return error JSON |

</frozen-after-approval>

## Code Map

- `backend/src/functions/vector-health-snapshotter.js` — Timer-triggered Function: fetches index stats, persists snapshot, enforces retention
- `backend/src/services/vector-health-snapshots.js` — Snapshot CRUD service: save, list, query by time window, delete old snapshots
- `backend/src/functions/vector-health-snapshots-api.js` — HTTP GET endpoint for querying snapshots by time window
- `infra/modules/storage.bicep` — Add `vector-snapshots` container declaration

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/vector-health-snapshots.js` — Create snapshot service with `saveSnapshot(stats)`, `listSnapshots({ days })`, `deleteOlderThan(retentionDays)` using Blob Storage JSON blobs in date-partitioned paths
- [x] `backend/src/functions/vector-health-snapshotter.js` — Create timer-triggered Function (every 15 min by default, configurable via `VECTOR_SNAPSHOT_CRON`) that calls `getIndexStats()` and `saveSnapshot()`, then calls `deleteOlderThan(env.RETENTION_DAYS || 90)`
- [x] `backend/src/functions/vector-health-snapshots-api.js` — Create HTTP GET Function at route `vector-health-snapshots` with `?days=` query param validation, returns snapshot array sorted desc by timestamp
- [x] `infra/modules/storage.bicep` — Add `vector-snapshots` to the Blob container list
- [x] Unit tests for snapshot service (save, list by time window, retention delete, edge cases)

**Acceptance Criteria:**
- Given the snapshot timer fires, when Pinecone returns valid stats, then a JSON blob is written to `vector-snapshots/{yyyy-mm-dd}/{timestamp}.json` containing provider, indexName, totalVectorCount, indexFullness, and timestamp, and retention cleanup also runs
- Given snapshots exist across multiple dates, when GET `/api/vector-health-snapshots?days=30` is called, then only snapshots from the last 30 days are returned in `{ success, data, count }` envelope
- Given blobs exist older than the retention period, when the timer fires, then those blobs are deleted before the new snapshot is written
- Given Pinecone is unavailable during a snapshot tick, when the timer fires, then retention cleanup still runs independently

## Spec Change Log

| Iteration | Finding | Change | Avoids |
|-----------|---------|--------|--------|
| 1 | intent_gap (no lifecycle rule) | Added Bicep 730-day lifecycle rule as safety net | Infinite blob accumulation if timer fails |
| 1 | intent_gap (auth scope) | Restricted API to Docente/Director roles | Student exposure of infra internals |
| 1 | bad_spec (filename format) | AC1: `{uuid}.json` → `{timestamp}.json` | Self-contradiction between AC and Design Notes |
| 1 | bad_spec (response envelope) | I/O matrix updated to reflect `{ success, data, count }` wrapper | Misalignment between spec and code |
| 1 | bad_spec (retention on failure) | Retention cleanup runs independently of capture success | Snapshots not accumulating during Pinecone outages |
| 1 | patch (days ceiling) | Added max 365 validation on days param | Resource exhaustion via large time windows |
| 1 | patch (error sanitization) | Raw error messages no longer leaked in API responses | Information disclosure |


## Design Notes

**Snapshot blob structure:**
```json
{
  "provider": "pinecone",
  "indexName": "dashboard-edu-pilot",
  "totalVectorCount": 15234,
  "indexFullness": 0.45,
  "namespaces": { "arq-software-2026": { "vectorCount": 15234 } },
  "timestamp": "2026-06-20T10:00:00.000Z"
}
```

**Blob path convention:** `vector-snapshots/2026-06-20/2026-06-20T10-00-00-000Z.json` — date prefix enables efficient prefix-based listing for time-window queries.

**Env vars:**
- `VECTOR_SNAPSHOT_CRON` — cron schedule (default `0 */15 * * * *`)
- `VECTOR_SNAPSHOT_RETENTION_DAYS` — retention period (default `90`)

## Verification

**Commands:**
- `npm run test:unit -- --grep "vector-health-snapshot"` — all snapshot service tests pass
- `npm run lint` — no lint errors in new files
