# Walkthrough — Issue #59 (Student In-App Notification Center)

## What was implemented

### 1) Notification data support in frontend API service
- Added `api.getNotifications({ userId, subjectId, limit })` in `frontend/src/services/api.js`.
- It queries `/api/notifications` when available.
- If the endpoint is unavailable or returns invalid data, it falls back to robust local mock notifications.
- Included normalization and sorting by `createdAt` to keep UI data stable.

### 2) Student notification bell + dropdown UI
- Added a role-aware notification center to the student top utility bar in `frontend/src/components/Sidebar.js`.
- Includes:
  - Bell button
  - Red badge with unread count
  - Dropdown event list
  - “Mark all as read” action
  - “Simular notificación” action (for acceptance testing/demo)
- Added support for programmatic triggers through `window` event:
  - `student:trigger-notification`
- Added cleanup handling to avoid duplicated listeners after re-renders.

### 3) Styling
- Added styles in `frontend/src/styles/pages.css` for:
  - Bell button
  - Red badge
  - Notification dropdown
  - Event list items (including unread state)
  - Empty state and action footer

### 4) Chrome E2E test
- Added `frontend/tests/notifications.spec.js`.
- The test runs with Chrome channel and verifies:
  - Bell visibility
  - Initial unread badge count
  - Dropdown event list rendering
  - Badge count increase after triggering notification
  - Usable navigation when clicking an event item

## Verification results

### Build
- `npm run build` (frontend): ✅ Passed

### Tests
- `npx playwright test tests/notifications.spec.js`: ✅ Passed
- `npm run test:e2e`: ⚠️ Completed with unrelated pre-existing failures in:
  - `tests/deadlines.spec.js`
  - `tests/global-search.spec.js`
  - `tests/transcript-timeline.spec.js`
  - New notification spec passed in this full run.

## Acceptance criteria mapping
- **Red badge UI with dropdown event list**: ✅ Implemented in top utility bar for student role.
- **Trigger a notification and see badge count increase**: ✅ Verified by Chrome E2E test via simulate action.

## Backlog refinement suggestions
- Persist notification read/unread state server-side per user/session.
- Add endpoint contract doc for `/api/notifications` in AGENTS API section.
- Add filters in dropdown (all/unread/type).
- Add “mark as read” on single item hover/action for better UX.
