---
status: done
story_key: 7-173-scheduled-backup-windows
epic: 7
story_num: 173
title: "Scheduled backup windows with approval-gated cleanup"
baseline_commit: 5ea197c04fc7512b6e84ff754a48060181529378
---

# Spec: Scheduled Backup Windows with Approval-Gated Cleanup

## Goal

As an Operations Lead, I want automated backup windows and approval-gated cleanup, so that lifecycle operations are predictable and safe.

## Background

There is an existing `POST /api/vector-backup` HTTP endpoint that supports `backup-only` and `backup+cleanup` modes via the `vector-backup.js` service. This spec adds a **timer-triggered backup function** that runs at configurable windows, and an **approval-gating mechanism** that prevents automated cleanup from executing unless an explicit approval flag has been set.

The existing `vector-backup.js` service already emits `VectorBackupRun` telemetry with runId, mode, durationMs, vectorCount, and success status.

## Acceptance Criteria

### AC1: Scheduled backup runs at configured windows

**Given** a cron schedule is configured via env var `VECTOR_BACKUP_WINDOW_CRON`
**When** the timer fires
**Then** a new timer function `vector-backup-scheduler` triggers `runVectorBackup({ mode: 'backup-only' })`
**And** the backup is saved to Blob Storage container `vector-backups/`
**And** a `VectorBackupRun` telemetry event is emitted

### AC2: Cleanup requires explicit approval flag

**Given** an approval exists (stored in Blob Storage: `backup-approvals/{subjectId}.json` with `{ approved: true, approvedBy: "...", approvedAt: "..." }`)
**When** the timer fires for cleanup
**Then** the function checks for a valid, non-expired approval file
**And** if no valid approval exists, cleanup is skipped and a warning is logged
**And** only `backup-only` runs in that cycle

### AC3: Failed backups block cleanup

**Given** the previous backup run failed (tracked via telemetry or a status blob)
**When** the scheduler starts a new cycle
**Then** if the most recent backup failed, cleanup is blocked
**And** an operational alert is raised (logged as error + App Insights event `VectorBackupCleanupBlocked`)

### AC4: Execution logs include run ID, scope, duration, and document counts

**Given** a backup run completes
**When** the scheduler finishes
**Then** the execution log contains:
- `runId`: UUID of the run
- `scope`: subject scope (or 'all')
- `durationMs`: execution wall-clock time
- `vectorCount`: number of vectors backed up
- `mode`: 'backup-only' or 'backup+cleanup'
- `lastBackupRunId`: ID of the last successful backup run

## Implementation Tasks

### Task 1: Create approval store service [x]

**File:** `backend/src/services/backup-approval.js` (new)

- `saveApproval({ subjectId, approvedBy })` → writes `backup-approvals/{subjectId}.json` with `{ approved: true, approvedBy, approvedAt: ISO timestamp, expiresAt: ISO timestamp (24h from now) }`
- `getApproval({ subjectId })` → reads `backup-approvals/{subjectId}.json`, returns null if missing or expired
- `revokeApproval({ subjectId })` → deletes the approval blob
- `listActiveApprovals()` → lists all valid (non-expired) approvals in `backup-approvals/` container

### Task 2: Create timer-triggered backup scheduler function [x]

**File:** `backend/src/functions/vector-backup-scheduler.js` (new)

- Timer trigger at schedule from `VECTOR_BACKUP_WINDOW_CRON` (default: `0 0 3 * * *` = daily 3 AM)
- On each tick:
  1. Log run start with `runId`, timestamp
  2. Check `listActiveApprovals()` — get all subject IDs with valid approvals
  3. If approvals exist → run `backup+cleanup` for each approved subject (backup first, then cleanup)
  4. If no approvals → run `backup-only` (no cleanup)
  5. Track the last backup status blob at `backup-status/last-run.json` with `{ runId, mode, success, durationMs, vectorCount }`
  6. If last run failed → block cleanup on next cycle → emit `VectorBackupCleanupBlocked` event
  7. Emit `VectorBackupScheduler.Executed` telemetry with: `runId`, `scope`, `durationMs`, `vectorCount`, `mode`, `lastBackupRunId`

### Task 3: Add approval management API [x]

**Files:**
- `backend/src/functions/backup-approval-api.js` (new)

- `POST /api/backup-approval` — creates/renews an approval for a subject
  - Body: `{ subjectId, approvedBy }`
  - Auth: `Director` role only
  - Returns `{ subjectId, approvedAt, expiresAt }`
- `DELETE /api/backup-approval?subjectId={id}` — revokes an approval
  - Auth: `Director` role only
- `GET /api/backup-approval?subjectId={id}` — gets current approval status
- `GET /api/backup-approval` — lists all active approvals

### Task 4: Register the timer function in the app [x]

**File:** `backend/src/index.js`

- Import and register `vector-backup-scheduler.js`
- Import and register `backup-approval-api.js`

### Task 5: Update Bicep for env vars (if needed) [x]

**File:** `infra/modules/functions.bicep`

- Add `VECTOR_BACKUP_WINDOW_CRON` app setting (default: `0 0 3 * * *`)

## Design Notes

- The approval is a simple JSON blob in the `backup-approvals/` container with a 24-hour expiry. This is intentionally simple — no DB tables needed. An operations lead sets approval when they're ready for cleanup, and it auto-expires in 24h for safety.
- The scheduler always runs backup-only mode as the baseline. Cleanup (deletion) only happens for subjects with active approvals AND a successful prior backup run.
- Failure detection uses the `backup-status/last-run.json` blob. If the last run had `success: false`, the scheduler skips cleanup in the next cycle and emits an alert.
- Telemetry follows the existing pattern: `VectorBackupScheduler.Executed` event with execution metadata.

## Code Map

```
backend/src/services/backup-approval.js     (new)   — approval read/write
backend/src/functions/vector-backup-scheduler.js (new) — timer trigger
backend/src/functions/backup-approval-api.js (new)  — approval CRUD API
backend/src/index.js                        (edit)  — register new functions
infra/modules/functions.bicep               (edit)  — add VECTOR_BACKUP_WINDOW_CRON env var
```

## Suggested Review Order

**Approval service — core data model**

- Blob-backed approval with 24h TTL; simple, no DB needed
  [`backup-approval.js:3`](../../backend/src/services/backup-approval.js#L3)

- Expiry check gates all reads; expired blobs treated as missing
  [`backup-approval.js:10`](../../backend/src/services/backup-approval.js#L10)

**Scheduler — orchestration logic**

- Entry point: timer handler reads approvals, checks prior run, decides mode
  [`vector-backup-scheduler.js:48`](../../backend/src/functions/vector-backup-scheduler.js#L48)

- Failed prior run blocks cleanup; emits VectorBackupCleanupBlocked alert
  [`vector-backup-scheduler.js:74`](../../backend/src/functions/vector-backup-scheduler.js#L74)

- Per-subject cleanup loop: backup first, then delete for each approved subject
  [`vector-backup-scheduler.js:86`](../../backend/src/functions/vector-backup-scheduler.js#L86)

- Fallback: no approvals → backup-only for entire index
  [`vector-backup-scheduler.js:101`](../../backend/src/functions/vector-backup-scheduler.js#L101)

**Approval API — Director-only CRUD**

- POST creates 24h approval; GET/DELETE with subjectId query param
  [`backup-approval-api.js:7`](../../backend/src/functions/backup-approval-api.js#L7)

**Registration and config**

- Two new imports registered
  [`index.js:39`](../../backend/src/index.js#L39)

- Timer cron default (daily 3 AM) as app setting
  [`functions.bicep:270`](../../infra/modules/functions.bicep#L270)
