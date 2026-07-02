# Blind Hunter Review — spec-7-173-scheduled-backup-windows

## Diff (changes from baseline 5ea197c)

### Modified files:

**backend/src/index.js** — added 2 imports:
```js
import './functions/vector-backup-scheduler.js';
import './functions/backup-approval-api.js';
```

**infra/modules/functions.bicep** — added app setting:
```bicep
{
  name: 'VECTOR_BACKUP_WINDOW_CRON'
  value: '0 0 3 * * *'
}
```

### New files:

**backend/src/services/backup-approval.js** — approval store service using Blob Storage JSON blobs in `backup-approvals/` container. Exports:
- `saveApproval({ subjectId, approvedBy })` — creates approval with 24h TTL
- `getApproval({ subjectId })` — reads approval, returns null if expired/missing
- `revokeApproval({ subjectId })` — deletes approval blob
- `listActiveApprovals()` — lists all non-expired approvals

**backend/src/functions/vector-backup-scheduler.js** — timer-triggered function (default: daily 3 AM via `VECTOR_BACKUP_WINDOW_CRON`). On each tick:
1. Lists active approvals
2. Checks last run status blob (`backup-status/last-run.json`)
3. If approvals exist AND last run succeeded → runs `backup+cleanup` per approved subject
4. If no approvals → runs `backup-only` for all vectors
5. If last run failed → skips cleanup, emits `VectorBackupCleanupBlocked` error, runs backup-only
6. Saves last run status with runId, mode, success, durationMs, vectorCount

**backend/src/functions/backup-approval-api.js** — HTTP API for approval management:
- `POST /api/backup-approval` — create approval (Director role only)
- `GET /api/backup-approval?subjectId=X` — get single approval
- `GET /api/backup-approval` — list all active approvals
- `DELETE /api/backup-approval?subjectId=X` — revoke approval

All API endpoints validate Front Door ID and Director role.
