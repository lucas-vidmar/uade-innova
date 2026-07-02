---
title: 'Notification History Page for Students'
type: 'feature'
created: '2026-06-19'
status: 'done'
baseline_commit: 'ebbabdf9c3eab8493fa9d82fa7b4af62885ae491'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students can only see the latest 8 notifications in the sidebar dropdown — there is no dedicated page to review full history, search, or filter by type. Once a notification scrolls out of view, it's permanently inaccessible from the UI.

**Approach:** Add a new `/student/notifications` route with a full-page history view supporting pagination, type filtering, and text search. Add a "Ver todo" link in the bell dropdown footer and a nav link in the sidebar. Extend the existing `GET /api/notifications` endpoint with `type`, `search`, and `skip` query params for pagination and filtering.

## Boundaries & Constraints

**Always:**
- Only students see the notifications page (teacher/director roles excluded)
- Notifications scoped to the active subject (selected in the global subject dropdown)
- Search filters client-side for immediate feedback, server-side filter only by `type` and pagination via `skip`
- Use existing `GET /api/notifications` endpoint — do not create a new function
- Mark-as-read from history page uses existing `PATCH /api/notifications/{id}/read` endpoint
- All UI text in Spanish to match existing notification patterns
- Follow existing page component pattern: export `renderStudentNotifications(pageContent)` and return promise

**Ask First:**
- Whether to add a dedicated "search by keyword" query parameter to the backend or keep search entirely client-side on the fetched batch

**Never:**
- Do not create new notification storage tables or change the Blob JSON schema
- Do not add real-time push (WebSocket/SSE) — polling is out of scope
- Do not modify teacher or director roles
- Do not reimplement the notification dropdown rendering

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Student navigates to `/student/notifications` | Full list of notifications for active subject, paginated 25 per page | N/A |
| EMPTY_HISTORY | Active subject has zero notifications | Empty state: "No hay notificaciones para esta materia" | N/A |
| TYPE_FILTER | Student clicks "Deadline" filter tab | Only deadline-type notifications shown (client-side filter on fetched data) | If filter yields zero results, show "No hay notificaciones de este tipo" |
| SEARCH_QUERY | Student types "resumen" in search box | Notifications with title/message containing "resumen" shown (client-side filter) | If no match, show "No se encontraron notificaciones con ese texto" |
| MARK_READ | Student clicks mark-read on a notification | Item visually updates to read state (dimmed), API called optimistically; if API fails, revert and show toast error | Revert optimistic update, toast: "No se pudo actualizar" |
| MARK_ALL_READ | Student clicks "Marcar todas leídas" | All notifications in current view become read; API called | Same as mark-read failure handling |
| PAGINATION | Student scrolls past 25 items | "Cargar más" button appears; clicking loads next 25 | Show error toast on load failure, keep existing items |
| SUBJECT_SWITCH | Student changes active subject while on notifications page | Page reloads notifications for the new subject | Show empty state if new subject has no notifications |

</frozen-after-approval>

## Code Map

- `frontend/src/main.js` — Register `/student/notifications` route with lazy import
- `frontend/src/pages/student/Notifications.js` — New page component: renders history list, filters, search, pagination
- `frontend/src/components/Sidebar.js` — Add "Notificaciones" to student NAV; add "Ver todo" link to dropdown footer
- `frontend/src/services/api.js` — Extend `getNotifications()` to accept `skip`, `type` params
- `frontend/src/styles/pages.css` — Add CSS for the notifications history page layout
- `backend/src/functions/notifications.js` — Extend GET endpoint with optional `type`, `skip` query params

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/functions/notifications.js` — Add optional `type` (comma-separated filter) and `skip` (offset) query params to the GET handler. Apply type filter before slicing. Apply skip after sorting for page-based offset
- [x] `frontend/src/services/api.js` — Extend `getNotifications()` signature to accept `{ userId, subjectId, limit, skip, type }`, pass `skip` and `type` as query params to backend
- [x] `frontend/src/pages/student/Notifications.js` — Create new page component: renders notification list with type filter pills (Todos, Nota, Resumen, Deadline, Material), text search input, "Marcar todas leídas" button, individual mark-read actions, "Cargar más" pagination button. Empty and error states per I/O matrix
- [x] `frontend/src/components/Sidebar.js` — Add "Notificaciones" entry to student `NAV` array (icon: bell, path: `#/student/notifications`); add "Ver todo" link in the dropdown footer that navigates to `#/student/notifications`
- [x] `frontend/src/main.js` — Add `/student/notifications` route in `ROUTES` registry
- [x] `frontend/src/styles/pages.css` — Add `.notifications-page`, `.notifications-filter-pills`, `.notifications-search`, `.notifications-list`, `.notifications-load-more` CSS classes following the existing page pattern

**Acceptance Criteria:**
- Given I am a student with notifications, when I click the sidebar "Notificaciones" link, then I see a full-page list of notifications for the active subject
- Given I am on the notifications page, when I click a filter pill (e.g. "Deadline"), then only notifications of that type are shown
- Given I am on the notifications page, when I type in the search box, then notifications are filtered client-side by title/message
- Given I am on the notifications page, when I click "Marcar leída" on a notification, then it visually updates to read state and the badge count decreases
- Given I am on the notifications page, when I scroll past the first 25 items and click "Cargar más", then the next 25 notifications are loaded from the API
- Given I am on the notifications page, when I change the active subject, then the page reloads with notifications for the new subject
- Given I am on the bell dropdown, when I click "Ver todo", then I am navigated to `/student/notifications`

## Verification

**Commands:**
- `npm run test` — existing notification E2E tests must still pass
- Manual: navigate to `/student/notifications`, verify filters, search, pagination, mark-read

**Manual checks (if no CLI):**
- Sidebar shows "Notificaciones" link for student role only (not teacher/director)
- Bell dropdown footer includes "Ver todo" link
- Filter pills correctly filter by type
- Search filters by title/message text
- "Cargar más" loads additional notifications
- Mark-read optimistically updates UI and persists across reload

## Suggested Review Order

**Backend pagination & filtering**

- New `type` and `skip` query params on the existing GET endpoint — type filter is applied server-side before pagination offset
  [`notifications.js:20`](../../backend/src/functions/notifications.js#L20)

- `skip` offset applied as `slice(skip, skip + limit)` for cursor-free pagination
  [`notifications.js:163`](../../backend/src/functions/notifications.js#L163)

**Frontend API client**

- `getNotifications()` signature extended to accept `skip` and `type` — only sends non-default values as query params
  [`api.js:638`](../../frontend/src/services/api.js#L638)

**New page component**

- Full notification history page with filter pills, search input, "Marcar todas leídas", individual mark-read, and paginated "Cargar más"
  [`Notifications.js:8`](../../frontend/src/pages/student/Notifications.js#L8)

- Optimistic mark-read with rollback on API failure — same pattern as existing dropdown
  [`Notifications.js:193`](../../frontend/src/pages/student/Notifications.js#L193)

- Client-side search across title and message fields for instant feedback
  [`Notifications.js:70`](../../frontend/src/pages/student/Notifications.js#L70)

**Sidebar & routing**

- "Notificaciones" entry added to student NAV with bell icon
  [`Sidebar.js:14`](../../frontend/src/components/Sidebar.js#L14)

- "Ver todo" link in the bell dropdown footer navigating to `/student/notifications`
  [`Sidebar.js:136`](../../frontend/src/components/Sidebar.js#L136)

- Route registered in the hash-based router with lazy import
  [`main.js:19`](../../frontend/src/main.js#L19)

**Styles**

- Full set of CSS classes for the notifications page: layout, filter pills, search input, items, mark-read button, pagination
  [`pages.css:374`](../../frontend/src/styles/pages.css#L374)
