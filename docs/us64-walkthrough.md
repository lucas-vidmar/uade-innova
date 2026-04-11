# Walkthrough: User Story #64

**Feature/Story Name**: Deadline Proximity Alerts (48h / 24h)  
**Status**: Completed  
**Business Impact**: Students receive proactive reminders before delivery dates, reducing missed deadlines and improving assignment adherence.

## What Changed
- Added a new automated backend timer function in `backend/src/functions/deadline-proximity-dispatcher.js`:
  - Evaluates all stored deadlines by subject.
  - Applies proximity rules for **48h** and **24h** before due time.
  - Uses a configurable evaluation window (`DEADLINE_PROXIMITY_WINDOW_HOURS`, default `1`) to tolerate scheduler cadence.
  - Upserts deadline notifications into the shared notification store.
  - Prevents duplicate reminders with deterministic notification IDs.
- Registered the dispatcher in backend startup (`backend/src/index.js`).
- Extended notification type normalization to include `deadline` in:
  - `backend/src/functions/notifications.js`
  - `backend/src/services/notification-store.js`
  - `frontend/src/services/api.js`
- Updated student notification center UI in `frontend/src/components/Sidebar.js`:
  - New icon and label mapping for deadline notifications (`⏰ Deadline`).

## Verification Results
- **Backend tests**: `npm test` (backend) — passed, including new dispatcher tests:
  - 24h remaining reminder generation.
  - 48h remaining reminder generation.
  - duplicate suppression across repeated runs.
- **Frontend usability test (Chrome)**: `npx playwright test tests/deadline-proximity-alerts.spec.js` — passed.
- Validated student can open the notification center and view a **24h deadline** alert with proper type badge.

## Acceptance Criteria Mapping
- **Automated backend system evaluates proximity rules**: Implemented via timer-driven `deadline-proximity-dispatcher`.
- **Test "24h remaining" logic**: Covered explicitly in `backend/src/functions/deadline-proximity-dispatcher.test.js`.

## Backlog Refinement
- Add opt-out or preference controls per student for deadline reminder channels and cadence.
- Add timezone-per-subject or timezone-per-student support to improve reminder precision beyond UTC defaults.
- Add escalation reminder at 2h before deadline for high-weight tasks when still pending.
