---
title: 'Persist notification read/unread state per student'
type: 'feature'
created: '2026-06-19'
status: 'done'
baseline_commit: 'ce7d41364b152941491e2a43657ced7fa011a605'
context:
  - '{project-root}/backend/src/functions/notifications.js'
  - '{project-root}/backend/src/services/notification-store.js'
  - '{project-root}/backend/src/functions/notifications.test.js'
  - '{project-root}/backend/src/services/notification-store.test.js'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-105-notification-history-page.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a student marks a seed notification as read, the unread badge shows a stale count after page reload because `GET /api/notifications` merges the persisted Blob data with `MOCK_NOTIFICATIONS` without deduplicating by ID — the original mock entry (without `readByUserIds`) re-injects the unread state every time. There is also no backend coverage for the merge-dedup behavior or for the full read-state persistence flow (seed → persist → verify persisted copy overrides mock).

**Approach:** Deduplicate the persisted + mock merge on the GET and SSE stream endpoints by filtering out `MOCK_NOTIFICATIONS` entries whose IDs already exist in the persisted data. Add backend unit tests that verify: dedup behavior, seed-and-mark-read persistence flow, and that the persisted `readByUserIds` is authoritative even when a mock entry with the same ID exists.

## Boundaries & Constraints

**Always:**
- Dedup only removes MOCK entries whose ID exists in persisted — never the reverse
- `asPublicNotification` stays the sole function computing the `unread` field
- All existing notification endpoints keep their current signatures
- Auth, enrollment-scoping, and telemetry unchanged

**Never:**
- Do not change the Blob JSON schema or notification-store interface
- Do not remove MOCK_NOTIFICATIONS — they provide seed data for subjects with no persisted notifications
- Do not add new endpoints or modify frontend behavior
- Do not change SSE stream behavior beyond the same dedup fix

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| PERSISTED_OVERRIDES_MOCK | `notif-grade-001` exists in both persisted (with `readByUserIds`) and MOCK (without) | Only persisted copy returned; `unread: false` for that user | N/A |
| MOCK_ONLY | Subject has no persisted notifications, only MOCK entries | MOCK entries are returned with `unread` computed from their own fields | N/A |
| PARTIAL_OVERLAP | Some MOCK IDs are persisted, some are not | Persisted IDs deduped; mock-only IDs still included | N/A |
| SEED_THEN_MARK_READ | `ensureSeedNotificationPersisted` seeds a mock, then `markNotificationReadForUser` marks it | Next GET returns only the persisted copy with `readByUserIds` containing the user | If persist fails, error is logged and next GET retries seed |
| STREAM_SNAPSHOT | SSE stream initial snapshot with mixed persisted + mock | Same dedup applied — only unique IDs, persisted wins | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/functions/notifications.js` — Fix dedup in `get-notifications` handler (line 155) and `stream-notifications` handler (line 275)
- `backend/src/functions/notifications.test.js` — Add backend unit tests for merge dedup and full seed→persist→read flow

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/functions/notifications.js` — In `get-notifications` handler, extract persisted IDs into a `Set`, filter `MOCK_NOTIFICATIONS` to only those not in the set, then merge. Apply same fix in `stream-notifications` snapshot construction.
- [x] `backend/src/functions/notifications.test.js` — Add test: notifications with same ID in both persisted and mock return only persisted copy. Add test: seed mock, mark read, verify subsequent GET returns the notification with correct unread state and does not include the mock duplicate.
- [x] `backend/src/functions/notifications.test.js` — Add test: chained seed→mark-read→GET flow verifies persisted `readByUserIds` is authoritative and mock copy is suppressed.

**Acceptance Criteria:**
- Given a notification exists in both persisted Blob and MOCK_NOTIFICATIONS, when the GET endpoint is called, then only the persisted version is returned
- Given a seed notification is marked as read by a user, when the page reloads and GET is called, then the notification shows `unread: false` for that user and the badge count excludes it
- Given a subject has only MOCK_NOTIFICATIONS (no persisted Blob yet), when the GET endpoint is called, then all matching mock entries are returned normally

## Design Notes

The merge dedup is a one-line filter change per endpoint:

```
const persistedIds = new Set(persisted.map((n) => n.id));
const mockOnly = MOCK_NOTIFICATIONS.filter((n) => !persistedIds.has(n.id));
let data = [...persisted, ...mockOnly]
```

This guarantees persisted data is authoritative once a notification has been seeded, while preserving MOCK_NOTIFICATIONS as seed data for subjects with no Blob yet.

## Verification

**Commands:**
- `npm test -- --test-regex notifications` — existing notification tests still pass, new tests pass
- `npm run test:backend` — full backend test suite green

## Suggested Review Order

**Merge dedup logic (both endpoints)**

- Dedup prevents stale unread counts by filtering mock entries once persisted, ensuring `readByUserIds` is authoritative
  [`notifications.js:155`](../../backend/src/functions/notifications.js#L155)

- Same dedup applied to SSE stream snapshot to keep initial state consistent with GET
  [`notifications.js:277`](../../backend/src/functions/notifications.js#L277)

**Tests**

- Verifies persisted notification with `readByUserIds` overrides mock with same ID
  [`notifications.test.js:244`](../../backend/src/functions/notifications.test.js#L244)

- Verifies mock-only path when no Blob data exists (no regression on seed subjects)
  [`notifications.test.js:273`](../../backend/src/functions/notifications.test.js#L273)

- Verifies partial overlap — only overlapping IDs are deduped, non-overlapping mocks survive
  [`notifications.test.js:289`](../../backend/src/functions/notifications.test.js#L289)

- Chained seed→mark-read→GET flow: persisted `readByUserIds` is authoritative, mock suppressed, `readByUserIds` stripped from public response
  [`notifications.test.js:316`](../../backend/src/functions/notifications.test.js#L316)

**Manual checks (if no CLI):**
- Navigate to student dashboard with unread seed notifications, mark one as read, reload page, verify badge count dropped
- Open multiple tabs, mark read in one, verify other tab shows updated state after SSE snapshot
