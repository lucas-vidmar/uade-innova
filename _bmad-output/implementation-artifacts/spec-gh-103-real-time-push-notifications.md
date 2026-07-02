---
title: 'Real-time push notifications for students'
type: 'feature'
created: '2026-06-19'
status: 'done'
baseline_commit: '899679e5d88f05d10103a8f6ef7cb3b8661ad378'
context: ['backend/src/functions/notifications.js', 'backend/src/services/notification-store.js', 'frontend/src/services/api.js', 'frontend/src/components/Sidebar.js']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students must manually refresh or re-navigate to see new notifications. Timer-created notifications (deadlines, materials, summaries) only appear on next page load or sidebar re-render, causing stale badge counts and delayed awareness.

**Approach:** Add an SSE (Server-Sent Events) endpoint that streams notification changes to the frontend. The frontend subscribes when the student session is active, injects new notifications into the existing bell dropdown via the `student:trigger-notification` event bridge, and auto-reconnects on connection loss.

## Boundaries & Constraints

**Always:**
- Use SSE (`text/event-stream`), not WebSocket — matches existing `rag-query` streaming pattern
- The SSE endpoint (`GET /api/notifications/stream`) lives in `notifications.js` alongside existing HTTP handlers
- Frontend SSE client is a new module `frontend/src/services/notification-stream.js`, not added to `api.js`
- New notifications injected via existing `window.dispatchEvent(new CustomEvent('student:trigger-notification', {...}))` bridge — no direct `allNotifications` mutation from outside `initializeNotificationCenter`
- Auto-reconnect with exponential backoff: 1s → 2s → 4s → 8s → max 30s, reset on successful connection
- SSE stream sends `keepalive` events every 30s to prevent proxy timeout
- Use a `lastPolledAt` timestamp per-connection to detect new/updated notifications; store as query param so back-end can diff
- All existing auth guards (Front Door ID, principal parsing, enrollment check) apply to the SSE endpoint
- Consumption Plan idle timeout (~230s for HTTP) is handled by client-side reconnect — no special server-side keepalive beyond the 30s ping

**Ask First:**
- Adding a `GET /api/notifications/stream` route to the Function App (no Bicep changes — it's an HTTP trigger under the existing `notifications` Function App)
- Whether to use polling-based diff (server periodically checks Blob Storage every 5s) or a `lastModified` timestamp stored alongside notifications in Blob Storage

**Never:**
- No new Azure resources (SignalR, Web PubSub, etc.) — cost constraint
- No WebSocket — SSE is sufficient and matches existing patterns
- No mutation of `allNotifications` directly from the stream service — use the event bridge
- No changes to the `notification-store.js` public API unless necessary for diff detection

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Student opens dashboard, SSE connects | Initial `snapshot` event with current notifications sent; subsequent `notification` events for new items within 2s of server storage | N/A |
| CONNECTION_DROPS | Network interruption, Consumption Plan timeout (230s) | Stream read fails, `notification-stream.js` starts reconnect backoff | Exponential backoff, max 30s interval; student sees stale state until reconnect succeeds |
| NO_NEW_NOTIFICATIONS | Student idle on dashboard for 5 minutes | SSE sends only `keepalive` events every 30s; no `notification` events | N/A |
| UNAUTHORIZED | Unauthenticated or mismatched userId | SSE returns 401/403, stream service does not retry | Logged once, no reconnect |
| MULTIPLE_TABS | Student opens dashboard in 2 browser tabs | Both tabs connect independently; notifications appear in each tab | Each stream connection is independent; existing BroadcastChannel for processing-notifications is unrelated |

</frozen-after-approval>

## Code Map

- `backend/src/functions/notifications.js` — Add `GET /api/notifications/stream` SSE handler (200+ lines)
- `backend/src/services/notification-store.js` — Add `listNotificationsSince(subjectId, sinceTimestamp)` for efficient diff detection (~20 lines)
- `frontend/src/services/notification-stream.js` — New module: SSE client with auto-reconnect, event parsing, `student:trigger-notification` dispatch (~120 lines)
- `frontend/src/services/api.js` — Add `subscribeNotificationStream({ userId, subjectId, onNotification, onUpdate })` method (~40 lines)
- `frontend/src/components/Sidebar.js` — Start stream after initial notification fetch in `initializeNotificationCenter` (~5 lines)
- `backend/src/functions/notifications.test.js` — Test SSE endpoint auth, connection, keepalive, diff events (~80 lines)

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/notification-store.js` — Add `listNotificationsSince(subjectId, sinceTimestamp)` that filters notifications by `createdAt > sinceTimestamp`
- [x] `backend/src/functions/notifications.js` — Add `GET /api/notifications/stream` SSE handler: validate auth, set streaming headers, send initial snapshot, poll for diffs every 5s, send keepalive every 30s, handle client disconnect
- [x] `frontend/src/services/api.js` — Add `subscribeNotificationStream({ userId, subjectId, onNotification, onUpdate })` that performs the SSE `fetch` and passes parsed events to callbacks
- [x] `frontend/src/services/notification-stream.js` — New module wrapping `api.subscribeNotificationStream` with auto-reconnect, exponential backoff, and `student:trigger-notification` dispatch
- [x] `frontend/src/components/Sidebar.js` — Call `notificationStream.start({ userId, subjectId })` after initial notification fetch in `initializeNotificationCenter`; call `.stop()` in cleanup
- [x] `backend/src/functions/notifications.test.js` — Test SSE: valid auth returns stream headers, returns initial snapshot, sends keepalive, 401 without auth, 403 for mismatched user

**Acceptance Criteria:**
- Given a student with an active session, when the dashboard loads, then the client subscribes to `GET /api/notifications/stream` and receives an initial `snapshot` event with current notifications
- Given the SSE connection is established, when a new notification is stored (e.g. by deadline-proximity-dispatcher), then the client receives a `notification` event within 5s and the badge count increments without page reload
- Given the SSE connection drops (network error / Consumption Plan timeout), then the client reconnects with exponential backoff (1s-30s) and resumes receiving events

## Verification

**Commands:**
- `cd backend && npm test -- --test-name-pattern="notification"` — expected: SSE stream tests pass
- `npm run --prefix frontend test` — expected: no regressions

**Manual checks:**
- Open student dashboard → verify badge count matches unread notifications in dropdown
- Create a new notification (via seed script or timer trigger) → verify badge increments and notification appears within 5s
- Kill network (DevTools → Offline) → verify reconnection on restore

## Suggested Review Order

**SSE streaming endpoint** — the core of the change: creates a persistent HTTP connection that streams notification events as they arrive

- SSE handler with auth guards, snapshot emission, poll-based diff detection, and abort handling
  [`notifications.js:221`](../../backend/src/functions/notifications.js#L221)

- Diff-aware query that returns only notifications newer than a timestamp
  [`notification-store.js:39`](../../backend/src/services/notification-store.js#L39)

**Frontend SSE client** — subscribes to the stream, dispatches notifications into the existing event bridge

- Reusable stream module with exponential backoff reconnect, AbortController integration, and `student:trigger-notification` dispatch
  [`notification-stream.js:1`](../../frontend/src/services/notification-stream.js#L1)

- SSE fetch wrapper that reads the ReadableStream and parses `event:`/`data:` lines
  [`api.js:728`](../../frontend/src/services/api.js#L728)

- Wiring: starts the stream after the initial notification fetch, stops on sidebar cleanup
  [`Sidebar.js:534`](../../frontend/src/components/Sidebar.js#L534)

**Tests** — validates auth, snapshot delivery, and polling behavior

- Auth rejection, stream headers, snapshot content, and poll-driven notification events
  [`notifications.test.js:174`](../../backend/src/functions/notifications.test.js#L174)
