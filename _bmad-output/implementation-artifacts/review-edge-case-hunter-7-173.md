# Edge Case Hunter Review — spec-7-173-scheduled-backup-windows

Review the code changes in the project at `/Users/lucasvidmar/Documents/azure-educational-dashboard` against the baseline commit `5ea197c`.

## Changed files to review

### New: `backend/src/services/backup-approval.js`
### New: `backend/src/functions/vector-backup-scheduler.js`
### New: `backend/src/functions/backup-approval-api.js`
### Modified: `backend/src/index.js`
### Modified: `infra/modules/functions.bicep`

## Context files (read to understand patterns)

- `backend/src/services/vector-backup.js` — existing vector backup service
- `backend/src/services/telemetry.js` — `trackVectorBackupRun` function
- `backend/src/services/storage.js` — `saveJson`, `loadJson`, `deleteBlob`, `listBlobs`
- `backend/src/services/auth-utils.js` — `validateFrontDoorId`, `parseClientPrincipal`
- `backend/src/services/error-categories.js` — `CategorizedError`
- `backend/src/functions/daily-reminders.js` — existing timer trigger pattern

Look for:
- Race conditions (timer fires while backup still running)
- Blob Storage concurrency issues (multiple scheduler instances)
- Container not created before first write
- Error handling gaps in async flows
- Edge cases for expired/empty approval lists
- Large approval list iteration performance
- Missing input validation
- Telemetry edge cases
