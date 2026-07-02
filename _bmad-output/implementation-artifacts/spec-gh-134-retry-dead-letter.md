---
title: 'Implement retry and dead-letter strategy for notification persistence'
type: 'feature'
created: '2026-06-20'
baseline_commit: 'c216e6b2e79d4f6fe34bbc3b6f22c1af295a88b0'
status: 'done'
context:
  - '{project-root}/backend/src/services/notification-store.js'
  - '{project-root}/backend/src/services/storage.js'
  - '{project-root}/backend/src/functions/post-class-summary-dispatcher.js'
  - '{project-root}/backend/src/functions/deadline-proximity-dispatcher.js'
  - '{project-root}/backend/src/services/telemetry.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The notification store calls `saveJson` directly with no retry mechanism. Transient Blob Storage failures (throttling, network blips) silently drop notification payloads with no recovery path.

**Approach:** Wrap all `saveJson` calls in notification-store.js with exponential backoff retry. After max retries, write the failed payload to a dead-letter container for later replay. Dispatchers report retry counts and dead-letter writes in their run results.

## Boundaries & Constraints

**Always:**
- Retry uses exponential backoff: 200ms, 400ms, 800ms (max 3 attempts, ~1.4s total)
- Dead-letter blobs go to `dead-letter/notifications/{subjectId}/{timestamp}-{id}.json`
- Dead-letter payload includes the original notification object plus `_dlMeta` with `originalError`, `retryCount`, `failedAt`
- Dispatcher run result includes `retryAttempts` and `deadLetterWrites` alongside existing `dispatched`/`errors`/`skipped`
- A `scripts/replay-dead-letter.js` script reads dead-letter blobs and re-ingests them

**Ask First:**
- Whether to share the retry utility via storage.js or keep it private to notification-store.js
- Whether to add a `trackDeadLetterWrite` telemetry event in telemetry.js

**Never:**
- Do not add retry to every `saveJson` call in the codebase — scope is notification persistence only
- Do not modify the public signature of `saveJson` / `loadJson` in storage.js
- Do not create a Typescript migration or new npm packages for this story

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | saveJson succeeds on first try | Notification persisted, retryAttempts=0, deadLetterWrites=0 | N/A |
| RETRY_OK | saveJson fails twice, succeeds on 3rd | Retried with backoff, notification persisted, retryAttempts=2 | Transient failure logged |
| DEAD_LETTER | saveJson fails all 3 retries | Payload written to dead-letter container, retryAttempts=3, deadLetterWrites=1 | Original error logged, notification not persisted but recoverable |
| DEAD_LETTER_WRITE_FAILS | saveJson fails AND dead-letter write fails | Both failures logged, retryAttempts=3, deadLetterWrites=0, error count incremented | console.error plus context.error |

</frozen-after-approval>

## Code Map

- `backend/src/services/notification-store.js` -- add `saveJsonWithRetry` wrapper; replace direct `saveJson` calls in `upsertNotificationForSubject` and `markNotificationReadForUser`; return retry/dead-letter metrics from public functions
- `backend/src/functions/post-class-summary-dispatcher.js` -- capture retry/dead-letter metrics from `upsertNotificationForSubject` and include in DispatcherRun telemetry
- `backend/src/functions/deadline-proximity-dispatcher.js` -- same instrumentation as post-class-summary-dispatcher
- `backend/src/services/telemetry.js` -- add `trackDeadLetterWrite` event if approved
- `scripts/replay-dead-letter.js` -- new script to iterate dead-letter blobs and re-ingest via `upsertNotificationForSubject`
- `backend/src/services/notification-store.test.js` -- add test cases for retry success, retry exhaustion, retry exhaustion with dead-letter write failure

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/notification-store.js` -- add `saveJsonWithRetry` with exponential backoff (200/400/800ms, 3 attempts); wrap `upsertNotificationForSubject` saveJson and dead-letter on exhaustion; wrap `markNotificationReadForUser` saveJson similarly; return `{ retryAttempts, deadLetterWrites }` from both public functions
- [x] `backend/src/functions/post-class-summary-dispatcher.js` -- destructure retry/dead-letter from `upsertNotificationForSubject` calls; aggregate into run metrics; include in `trackDispatcherRun` call
- [x] `backend/src/functions/deadline-proximity-dispatcher.js` -- same retry/dead-letter instrumentation
- [x] `backend/src/services/telemetry.js` -- add `trackDeadLetterWrite` event for visibility in App Insights
- [x] `scripts/replay-dead-letter.js` -- read `dead-letter/notifications/{subjectId}/*.json`, call `upsertNotificationForSubject` for each, delete blob after success
- [x] `backend/src/services/notification-store.test.js` -- mock saveJson to simulate transient failures; verify retry exhaustion writes dead-letter; verify happy path with 0 retries

**Acceptance Criteria:**
- Given a transient storage failure, when the notification store calls saveJson, then it retries up to 3 times with exponential backoff
- Given all retries are exhausted, when the notification cannot be persisted, then the payload is written to `dead-letter/notifications/{subjectId}/{timestamp}-{id}.json`
- Given a dispatcher run with retries or dead-letter writes, when the run completes, then the `DispatcherRun` telemetry event includes `retryAttempts` and `deadLetterWrites` measurements
- Given a dead-letter blob exists, when `replay-dead-letter.js` runs, then the notification is re-persisted and the dead-letter blob is deleted

## Design Notes

**Retry helper shape (in notification-store.js):**

```js
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

async function saveJsonWithRetry(container, blobName, data) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await saveJson(container, blobName, data);
      return { retryAttempts: attempt - 1, deadLetterWritten: false };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1));
      }
    }
  }
  // Dead-letter
  const dlBlobName = `dead-letter/notifications/${data.subjectId || 'unknown'}/${Date.now()}-${data.id || 'unknown'}.json`;
  const dlPayload = { originalPayload: data, _dlMeta: { originalError: lastError.message, retryCount: MAX_RETRIES, failedAt: new Date().toISOString() } };
  try {
    await saveJson('class-materials', dlBlobName, dlPayload);
    return { retryAttempts: MAX_RETRIES, deadLetterWritten: true };
  } catch (dlErr) {
    throw new Error(`saveJson failed after ${MAX_RETRIES} retries and dead-letter write also failed: ${lastError.message} | dl: ${dlErr.message}`);
  }
}
```

**Replay script usage:**

```bash
node scripts/replay-dead-letter.js [--subject <subjectId>] [--dry-run]
```

## Suggested Review Order

**Retry core logic**

- Exponential backoff wrapper with dead-letter fallback — the heart of the change
  [`notification-store.js:14`](../../backend/src/services/notification-store.js#L14)

- Public API now returns `{ success, retryAttempts, deadLetterWrites }` instead of bare boolean
  [`notification-store.js:91`](../../backend/src/services/notification-store.js#L91)

**Dispatcher instrumentation**

- Post-class-summary dispatcher captures and reports retry/dead-letter metrics in telemetry
  [`post-class-summary-dispatcher.js:73`](../../backend/src/functions/post-class-summary-dispatcher.js#L73)

- Deadline-proximity dispatcher gets same treatment + adds missing `trackDispatcherRun` telemetry
  [`deadline-proximity-dispatcher.js:162`](../../backend/src/functions/deadline-proximity-dispatcher.js#L162)

**Caller adaptations**

- mark-notification-read HTTP handler checks `success` from new return shape
  [`notifications.js:211`](../../backend/src/functions/notifications.js#L211)

- Bulk mark-read handler also adapted
  [`notifications.js:389`](../../backend/src/functions/notifications.js#L389)

**Telemetry**

- New `trackDeadLetterWrite` custom event + retryAttempts/deadLetterWrites added to DispatcherRun
  [`telemetry.js:259`](../../backend/src/services/telemetry.js#L259)

**Replay script**

- CLI script to re-ingest dead-letter blobs with dry-run support
  [`replay-dead-letter.js`](../../scripts/replay-dead-letter.js)

**Tests**

- Retry success, exhaustion, dead-letter write, and read-with-retry scenarios
  [`notification-store.test.js:85`](../../backend/src/services/notification-store.test.js#L85)

- Notification HTTP handler tests adapted to new return shape
  [`notifications.test.js:12`](../../backend/src/functions/notifications.test.js#L12)

## Verification

**Commands:**
- `node --experimental-test-module-mocks --test backend/src/services/notification-store.test.js` -- expected: all tests pass
