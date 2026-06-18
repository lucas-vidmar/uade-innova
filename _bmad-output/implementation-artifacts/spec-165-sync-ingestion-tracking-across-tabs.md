---
title: 'Sync Ingestion Tracking State Across Browser Tabs'
type: 'feature'
created: '2026-06-18'
status: 'done'
baseline_commit: 'fe49060ae9bdde17e1995faaf4c32cf376d165f6'
context:
  - '_bmad-output/implementation-artifacts/2-98-deduplicate-processing-toasts-for-multi-.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a teacher has multiple browser tabs open on the dashboard, each tab runs its own independent polling loop for material processing status. This causes duplicate toasts (both tabs show "Procesamiento completado" for the same material), inconsistent UI state (one tab may show a job as done while another still shows it as processing), and wasted API calls.

**Approach:** Add cross-tab coordination via `BroadcastChannel` API so that:
1. When one tab detects a terminal status, it broadcasts the event to all other tabs
2. Receiving tabs remove the job from their local tracking, show the toast (deduplicated), and update UI badges
3. A `storage` event listener serves as fallback for environments where `BroadcastChannel` is unavailable

## Boundaries & Constraints

**Always:**
- Use `BroadcastChannel` with channel name `uade-processing-sync` as primary mechanism
- Register a `storage` event listener as fallback (covers Safari <16.4, older iOS WebViews)
- Every `material-status-terminal` broadcast includes: `materialId`, `subjectId`, `classIds`, `filename`, `terminal` status, and a unique `broadcastId`
- Receiving tabs must deduplicate by `broadcastId` to prevent re-processing the same broadcast from `storage` event + `BroadcastChannel`
- All existing polling, toast, and persistence behavior must remain intact for single-tab usage
- Listeners (`notifyListeners()`) must fire in all tabs — the broadcast must inform subscribers across tabs too
- The `init()` method must register channel listeners; broadcast sync stays alive for the page lifetime (teardown on page unload only)

**Ask First:**
- TTL for completed `broadcastId`s in memory — propose 60s default, ask user to confirm
- Whether to persist completed `broadcastId`s across page reloads (via `sessionStorage`) — propose yes, so reloaded tabs don't re-process stale broadcasts

**Never:**
- Do not replace the polling mechanism — each tab still polls independently (the broadcast is a coordination layer, not a replacement)
- Do not use WebSocket, Service Worker, or SharedWorker for cross-tab sync (overkill for this use case)
- Do not modify the backend API — all changes are frontend-only

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two tabs open, material finishes in tab A | Tab A polls, detects `ready`, broadcasts to tab B | Tab A: shows toast, removes job, notifies listeners. Tab B: receives broadcast, removes job from trackedJobs, shows toast, updates UI badges, stops polling if idle | If broadcast fails (channel closed), tab B picks it up on its next poll cycle |
| Tab A broadcasts, tab B also polls and detects same material in same cycle | Both detect terminal at ~same time | Tab B's poll cycle sees the job in trackedJobs; before showing toast, check if `broadcastId` already processed → skip duplicate toast but still notify listeners | Dedup queue prevents double toasts |
| Three tabs open, material errors | Tab A polls, detects error | Tab A shows error toast; broadcasts to B and C; B and C show error toasts (each tab shows its own toast — but deduplicated per tab) | `broadcastId` dedup ensures each tab shows exactly 1 toast |
| Tab A broadcasts, tab B reloads mid-sync | Tab B reloads before receiving broadcast | Tab B loads persisted jobs from localStorage on init (unchanged); the completed job is still in localStorage → tab B will poll and detect it naturally | `broadcastId` in sessionStorage prevents re-processing old broadcasts |
| Tab with broadcast channel closes | Channel closes automatically | Other tabs continue independently; no cleanup needed beyond removing the channel's `message` listener | N/A |
| Safari <16.4 (no BroadcastChannel) | `BroadcastChannel` constructor throws | Catch the error, fall back to `storage` event listener only; behavior is identical except cross-tab sync depends on localStorage writes being visible to other tabs | Wrap `BroadcastChannel` in try-catch; log fallback in dev |
| Mobile Safari (storage events fire on same tab limitation) | `storage` event fires only on *other* tabs | Broadcast channel handles same-tab notifications; storage listener handles cross-tab for Safari; together they cover all cases | N/A |
| `broadcastId` queue exceeds memory limit (e.g., 1000+ after long sessions) | Queue grows with each terminal job | Cap the queue at 100 entries; older entries are evicted (they're only needed for dedup within the TTL window) | Trim on each addition |

</frozen-after-approval>

## Code Map

- `frontend/src/services/processing-notifications.js` — Add `BroadcastChannel` + `storage` event listeners; add `broadcastId` generation; add dedup queue; integrate cross-tab events into `init()`
- `frontend/tests/processing-notifications.spec.js` — Add cross-tab sync tests using mock `BroadcastChannel`

## Tasks & Acceptance

**Execution:**
- [x] `frontend/src/services/processing-notifications.js` — Add `BroadcastChannel` + `storage` event listeners, dedup queue, `broadcastTerminal()` call in `pollStatuses()`, and `initBroadcastSync()` in `init()` — Cross-tab sync layer on top of existing polling
- [ ] `frontend/tests/processing-notifications.spec.js` — Add 2-3 tests covering: cross-tab dedup via broadcast, broadcast + local poll race, storage event fallback — Verify no duplicate toasts and correct cross-tab state

**Acceptance Criteria:**
- Given 2+ tabs open on the teacher dashboard, when a material reaches `ready` in one tab, then all tabs show exactly 1 toast (not duplicated) and the job is removed from trackedJobs in all tabs
- Given a tab receives a broadcast for a terminal status, when the same tab's next poll cycle also detects the same job as terminal, then only 1 toast is shown (dedup by `broadcastId`)
- Given Safari without `BroadcastChannel`, when a material reaches terminal status, then `storage` event fallback delivers the sync to other tabs
- Given a tab is reloaded after receiving a broadcast, when it re-initializes, then it does not re-process stale broadcasts (dedup via `sessionStorage`)

## Design Notes

### Cross-tab communication strategy

```
Tab A                         Tab B
  |                             |
  |-- pollStatuses() --> ready  |
  |   broadcast({               |
  |     materialId,             |
  |     terminal: 'ready',      |
  |     broadcastId: 'ts-7',    |
  |     ...                     |
  |   })                        |
  |                             |-- onBroadcastMessage():
  |   localStorage.setItem(     |     remove from trackedJobs
  |     'uade.processing.*',    |     add broadcastId to dedup Set
  |     updatedJSON             |     show toast
  |   )                         |     notifyListeners()
  |                             |     stopPollingIfIdle()
  |-- storage 'event (fallback) |
```

### Implementation sketch for `processing-notifications.js`

```javascript
const BROADCAST_CHANNEL_NAME = 'uade-processing-sync';
const DEDUP_QUEUE_MAX = 100;
const SESSION_BROADCAST_KEY = 'uade.processing.seen-broadcasts';

let broadcastChannel = null;
let dedupQueue = new Set();
let broadcastCounter = 0;

function initBroadcastSync() {
  // Load dedup queue from sessionStorage
  try {
    const stored = sessionStorage.getItem(SESSION_BROADCAST_KEY);
    if (stored) dedupQueue = new Set(JSON.parse(stored));
  } catch (_) { /* ignore */ }

  // BroadcastChannel (primary)
  try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastChannel.onmessage = (event) => {
      handleBroadcast(event.data);
    };
  } catch (_) {
    console.log('[processing-notifications] BroadcastChannel not available, falling back to storage events');
  }

  // Storage event (fallback for Safari <16.4)
  window.addEventListener('storage', handleStorageEvent);
}

function stopBroadcastSync() {
  if (broadcastChannel) {
    broadcastChannel.close();
    broadcastChannel = null;
  }
  window.removeEventListener('storage', handleStorageEvent);
}

function generateBroadcastId() {
  return `bc-${++broadcastCounter}-${Date.now()}`;
}

function broadcastTerminal(job, terminal) {
  const payload = {
    broadcastId: generateBroadcastId(),
    materialId: job.materialId,
    subjectId: job.subjectId,
    classIds: job.classIds,
    filename: job.filename,
    terminal,
  };
  // Always persist to localStorage (triggers storage event for other tabs)
  // Write is already done by the existing persistTrackedJobs()
  // Broadcast via channel
  if (broadcastChannel) {
    broadcastChannel.postMessage(payload);
  }
  // Process locally
  handleBroadcast(payload);
}

function handleBroadcast(data) {
  const { broadcastId, materialId, terminal } = data;
  if (dedupQueue.has(broadcastId)) return;
  // Add to dedup
  dedupQueue.add(broadcastId);
  trimDedupQueue();
  persistDedupQueue();
  // Remove from trackedJobs (if present)
  const idx = trackedJobs.findIndex(j => j.materialId === materialId);
  if (idx !== -1) {
    const [job] = trackedJobs.splice(idx, 1);
    persistTrackedJobs();
    // Show toast (via toastBuffer + flush or directly)
    // Notify listeners
    notifyListeners({
      type: 'material-status-terminal',
      terminal,
      materialId,
      subjectId: data.subjectId,
      classIds: data.classIds,
      filename: data.filename,
      source: 'cross-tab',
    });
    // Show toast directly (not through buffer — already terminal)
    if (terminal === 'ready') {
      toast('success', 'Procesamiento completado', `"${data.filename}" ya está listo para usar.`);
    } else {
      toast('error', 'Procesamiento con error', `"${data.filename}" terminó con errores.`);
    }
    stopPollingIfIdle();
  }
}

function handleStorageEvent(event) {
  if (event.key === STORAGE_KEY) {
    // Another tab wrote tracked jobs; this tab can check if any
    // of its tracked jobs were removed (meaning another tab handled them)
    // Reconcile: load from storage, diff with in-memory trackedJobs
    reconcileFromStorage(event.newValue);
  }
}

function trimDedupQueue() {
  if (dedupQueue.size > DEDUP_QUEUE_MAX) {
    const entries = [...dedupQueue];
    dedupQueue = new Set(entries.slice(-DEDUP_QUEUE_MAX));
  }
}

function persistDedupQueue() {
  try {
    sessionStorage.setItem(SESSION_BROADCAST_KEY, JSON.stringify([...dedupQueue]));
  } catch (_) { /* ignore quota errors */ }
}
```

### Key integration points in existing code

1. **`init()`** — Already loads jobs from localStorage and starts polling. After that, call `initBroadcastSync()`.
2. **`stopPollingIfIdle()`** — Already checks if `trackedJobs.length === 0` and stops the interval. Broadcast sync stays alive for page lifetime (no teardown needed).
3. **`trackJob()`** — After adding a job, we don't need to broadcast (the job isn't terminal yet).
4. **`pollStatuses()` → terminal detection block** — After a terminal job is detected, instead of just pushing to toastBuffer + notifying listeners, we now also call `broadcastTerminal()`.

### Dedup race condition handling

When two tabs both poll at nearly the same time and both detect the same terminal material, both will try to broadcast. The `broadcastId` dedup ensures that within each tab, only the first broadcast for a given job is processed (subsequent broadcasts with a seen `broadcastId` are ignored). Additionally, when a tab receives a broadcast and removes the job from `trackedJobs`, the next poll cycle won't find it anymore. The `handleBroadcast` function also checks if the job still exists in `trackedJobs` before acting — if another tab already removed it, this is a no-op.

## Spec Change Log

- **bad_spec** (review 1): Spec required `stopPollingIfIdle()` to clean up broadcast listeners — amended "Always" to state broadcast sync stays alive for page lifetime. Avoids unnecessary teardown/init churn. KEEP: broadcast sync alive for page lifetime; single `initBroadcastSync()` call in `init()`.
- **patch** changes applied directly without spec change: broadcastId randomness to prevent collision, unique localStorage keys per broadcast (fixes N-job overwrite in Safari fallback), initialized guard for `initBroadcastSync()`, poll snapshot to avoid splice-during-iteration.

## Verification

**Commands:**
- `npm run test -- --project=chromium frontend/tests/processing-notifications.spec.js` — expected: all existing tests pass + new cross-tab tests pass
- `npm run lint` — expected: no new lint errors

**Manual checks (if no CLI):**
- Open two tabs to the teacher upload page with a test subject selected
- Upload a material in tab A
- Verify both tabs show "Procesando" status
- When processing completes, verify exactly 1 toast appears in each tab (not 2)
- Verify UI badge transitions from "Procesando" to "Listo" in both tabs without manual refresh

## Suggested Review Order

**Broadcast architecture (entry point)**

- Cross-tab sync initialized once on module start; dedup queue loaded from sessionStorage for reload resilience
  [`processing-notifications.js:127`](../../frontend/src/services/processing-notifications.js#L127)

- `broadcastId` generation with random suffix prevents collision across tabs
  [`processing-notifications.js:53`](../../frontend/src/services/processing-notifications.js#L53)

- Per-broadcast localStorage keys (not a single key) ensure N-terminal-job fallback works in Safari
  [`processing-notifications.js:112`](../../frontend/src/services/processing-notifications.js#L112)

**Receiving side — broadcast handling**

- Core handler: dedup, remove from trackedJobs + toastBuffer, notify, toast
  [`processing-notifications.js:58`](../../frontend/src/services/processing-notifications.js#L58)

- Storage event fallback with prefixed key matching for Safari <16.4
  [`processing-notifications.js:101`](../../frontend/src/services/processing-notifications.js#L101)

**Sending side — broadcast dispatch**

- Integrated into `pollStatuses()` right after local toast + listener notification
  [`processing-notifications.js:448`](../../frontend/src/services/processing-notifications.js#L448)

- Writes both localStorage and BroadcastChannel; cleanup timeout prevents clutter
  [`processing-notifications.js:107`](../../frontend/src/services/processing-notifications.js#L107)

**Defensive patterns**

- Snapshot iteration prevents splice-during-iteration in poll loop
  [`processing-notifications.js:392`](../../frontend/src/services/processing-notifications.js#L392)

- Dedup queue capped at 100 entries, persisted to sessionStorage, survives reload
  [`processing-notifications.js:44`](../../frontend/src/services/processing-notifications.js#L44)
