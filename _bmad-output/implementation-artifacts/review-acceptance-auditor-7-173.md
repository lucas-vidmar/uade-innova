# Acceptance Auditor Review — spec-7-173-scheduled-backup-windows

## Spec File
`spec-7-173-scheduled-backup-windows-with-approval-gated-cleanup.md` in this directory.

## Diff (baseline: 5ea197c)

### Acceptance Criteria to verify:

**AC1: Scheduled backup runs at configured windows**
- [ ] Timer function `vector-backup-scheduler` uses `VECTOR_BACKUP_WINDOW_CRON` env var with default `0 0 3 * * *`
- [ ] Calls `runVectorBackup({ mode: 'backup-only' })` when no approvals
- [ ] Saves backup to `vector-backups/` container (via existing `runVectorBackup`)
- [ ] Emits `VectorBackupRun` telemetry event

**AC2: Cleanup requires explicit approval flag**
- [ ] Approval stored in `backup-approvals/{subjectId}.json` with `approved`, `approvedBy`, `approvedAt`
- [ ] Scheduler checks for valid, non-expired approval before cleanup
- [ ] If no valid approval, runs backup-only and logs warning
- [ ] Approval has 24h expiry

**AC3: Failed backups block cleanup**
- [ ] Scheduler reads `backup-status/last-run.json` to check prior run status
- [ ] If last run failed (`success: false`), cleanup is blocked
- [ ] Emits `VectorBackupCleanupBlocked` operational alert (error log + event)

**AC4: Execution logs include run ID, scope, duration, document counts**
- [ ] `runId` (UUID) present in logs
- [ ] `scope` (subject scope or 'all') in logs
- [ ] `durationMs` in logs
- [ ] `vectorCount` in logs
- [ ] `mode` ('backup-only' or 'backup+cleanup') in logs
- [ ] `lastBackupRunId` referenced in scheduler context logs

### Task Checklist
- [x] Task 1: `backend/src/services/backup-approval.js` created
- [x] Task 2: `backend/src/functions/vector-backup-scheduler.js` created
- [x] Task 3: `backend/src/functions/backup-approval-api.js` created
- [x] Task 4: Functions registered in `backend/src/index.js`
- [x] Task 5: `VECTOR_BACKUP_WINDOW_CRON` added to `infra/modules/functions.bicep`

### Context docs to load:
- `backend/src/services/vector-backup.js`
- `backend/src/services/telemetry.js` (trackVectorBackupRun)
- `backend/src/services/storage.js` (saveJson, loadJson, deleteBlob, listBlobs)
