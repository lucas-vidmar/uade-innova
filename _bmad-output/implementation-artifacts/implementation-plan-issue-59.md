# Implementation Plan — Issue #59

## Story
As a student, I want an in-app notification bell for grades, summaries, and materials.

## Acceptance Criteria
- Red badge UI is visible on the notification bell.
- A dropdown shows a list of events.
- Triggering a new notification increases the badge count.

## Scope and Constraints
- Implement in the existing frontend shell (`top-utility-bar`) used by student views.
- Keep feature role-aware: only student role should see the notification center.
- Use current mock-friendly API architecture and avoid hardcoded secrets.
- Keep accessibility and usability basics (button labels, focus states, clear empty state).

## Technical Approach
1. **Data contract extension (`api.js`)**
   - Add `getNotifications({ userId, subjectId, limit })` method.
   - Try backend endpoint `/api/notifications` first.
   - Provide robust fallback generation from existing mock academic/class data with event types:
     - `grade`
     - `summary`
     - `material`

2. **UI integration (`Sidebar.js`)**
   - Add a bell icon button inside `top-utility-actions` for students.
   - Add red badge element for unread count.
   - Add dropdown panel with:
     - Header
     - Event list
     - Empty state
     - Actions: “Mark all as read”, “Simulate notification” (for acceptance testing/demo)
   - Add event trigger support via:
     - UI button (simulate)
     - `window` custom event (`student:trigger-notification`) for extensibility.

3. **Styling (`pages.css`)**
   - Add styles for bell button, red badge, dropdown list items, and notification type pills.
   - Ensure visual consistency with existing glass/top utility style.

4. **E2E verification (`Playwright`)**
   - Add a new test that uses **Chrome** channel:
     - opens student dashboard
     - validates initial badge and dropdown list
     - triggers notification via simulate action
     - verifies badge count increments
     - verifies clicking event navigates to its target screen

## Edge Cases
- No notifications returned: show empty state and hide badge.
- Backend endpoint unavailable: fallback notifications should still render.
- Repeated renders/reloads: avoid duplicate global listeners by replacing prior listeners.
- Non-student roles: notification center should not appear.

## Verification Plan
- Run frontend build.
- Run the new Playwright spec in Chrome channel and confirm pass.
