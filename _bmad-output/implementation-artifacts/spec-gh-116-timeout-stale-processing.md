---
title: 'Timeout Handling for Stale Processing Jobs'
type: 'feature'
created: '2026-06-19'
status: 'in-review'
baseline_commit: 'a3182d5844011244fd7726bad429e8a3c6f89b13'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a backend processing job hangs or a material is deleted server-side, the frontend polls indefinitely every 8 seconds for that job. Tracked jobs survive page refreshes (persisted in localStorage) with no expiration mechanism, causing perpetual background polling and never-resolved toast notifications.

**Approach:** Add a TTL (time-to-live) and max retry count per tracked job. When either limit is exceeded, stop polling for that job, show a global warning toast with actionable retry guidance, and remove the expired job from localStorage so it does not reappear across reloads.

## Boundaries & Constraints

**Always:**
- TTL = 30 minutes from `trackedAt`, max retries = 225 attempts (~30 min at 8s interval)
- Expired jobs produce a single `warning`-type toast: "Tiempo de espera agotado para '{filename}'. Revisá el estado del material en la tabla o intentá la carga nuevamente."
- Expired jobs are removed from `trackedJobs` and from localStorage immediately
- Expiration check runs in `pollStatuses()` before each job's status fetch, and also in `init()` so stale jobs from prior sessions get cleaned on page load
- Cross-tab sync must not re-introduce expired jobs (broadcast expiry events for stale removal)

**Ask First:**
- TTL and max retry values — current constants are proposals

**Never:**
- No backend changes (no endpoint for job TTL, no server-side expiry)
- No changes to the toast component or its CSS
- No changes to `FileUpload.js`, `UploadMaterials.js`, or `MaterialManager.js`
- No changes to existing terminal-status toast behavior for jobs that complete normally

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal job completes before TTL | trackedAt=14:00, job finishes at 14:15 | Existing toast behavior — no warning fired | N/A |
| Job exceeds TTL | trackedAt=14:00, poll at 14:31 (TTL=30min) | Warning toast shown, job removed from trackedJobs + localStorage | N/A |
| Job exceeds max retries before TTL | trackedAt=14:00, poll #226 at 14:30 (225 max) | Same as TTL expiry — warning toast, removal | N/A |
| Page load with stale localStorage jobs | localStorage has job with trackedAt=13:00 (current=14:31) | init() detects expiry, removes silently without toast (toast only for active polling) | N/A |
| Cross-tab sync of expired job | Tab A expires a job, Tab B polls same job | Tab B should detect expiry on next poll cycle and stop | BroadcastChannel handles the terminal notify; expiry runs independently per tab |

</frozen-after-approval>

## Code Map

- `frontend/src/services/processing-notifications.js` — Add TTL constant, max-retry constant, `hasJobExpired(job)` helper, expiry checks in `pollStatuses()` and `init()`

## Tasks & Acceptance

**Execution:**
- [x] `frontend/src/services/processing-notifications.js` — Add `JOB_TTL_MS = 30 * 60 * 1000` and `MAX_POLL_RETRIES = 225` constants
- [x] `frontend/src/services/processing-notifications.js` — Add `pollCount` field to tracked job schema (starts at 0, incremented each poll)
- [x] `frontend/src/services/processing-notifications.js` — Add `hasJobExpired(job)` function: returns true if `(Date.now() - new Date(job.trackedAt).getTime()) > JOB_TTL_MS` or `(job.pollCount || 0) >= MAX_POLL_RETRIES`
- [x] `frontend/src/services/processing-notifications.js` — In `pollStatuses()`, before fetching status for each job, check expiry. If expired, skip fetch, emit warning toast, remove job from trackedJobs, notify listeners with `{ type: 'material-status-terminal', terminal: 'expired' }`, continue
- [x] `frontend/src/services/processing-notifications.js` — In `init()`, after loading trackedJobs from localStorage, filter out expired jobs (silently, without toast) and persist the cleaned list

**Acceptance Criteria:**
- Given a tracked job exceeds 30 minutes since `trackedAt`, when the next poll cycle runs, then the job is removed from tracking and a warning toast with actionable guidance is shown
- Given a tracked job has been polled 225+ times, when the next poll cycle runs, then the same expiry behavior occurs
- Given a page load with expired jobs in localStorage, when `init()` runs, then expired jobs are silently removed without toast
- Given a job that completes normally within TTL, when it reaches terminal status, then existing toast behavior is preserved unchanged

## Verification

**Commands:**
- `cd frontend && npm run build` — expected: no build errors

**Manual checks:**
- Upload a material, then manually delete its record from backend Table Storage to prevent resolution → confirm warning toast appears after TTL
- Check localStorage (`uade.processing.tracked-jobs`) after expiry — confirm job is removed
- Reload page with stale jobs — confirm no warning toast on load, jobs are cleaned from localStorage
