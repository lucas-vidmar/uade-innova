---
title: 'Deadline Reminder Preferences'
type: 'feature'
created: '2026-06-19'
status: 'done'
baseline_commit: '0bceb7d3ee8b95782d13d32f58e3a7d3d87bdf46'
context: ['backend/package.json']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students currently receive all deadline proximity alerts (48h/24h) with no way to opt out or choose their preferred cadence. The deadline-proximity-dispatcher sends notifications to all enrolled users regardless of individual preference.

**Approach:** Add per-user deadline reminder preferences stored in the provisioned-but-unused `NotificationPreferences` table, expose them via GET/POST API endpoints, provide a settings UI for students to configure reminders, and modify the dispatcher to filter recipients by preference.

## Boundaries & Constraints

**Always:**
- Store in `NotificationPreferences` Azure Table (already provisioned) with `partitionKey=userId`, `rowKey='deadline-reminders'`
- Default preferences (no record): reminders enabled, cadence `both` (48h and 24h)
- Preference model: `{ enabled: boolean, cadence: ('48h' | '24h' | 'both') }`
- Backend API: GET `/api/reminder-preferences` returns current preferences or defaults; POST/PUT `/api/reminder-preferences` saves preferences
- Frontend: new page `/student/settings` with toggle + cadence radio group
- Sidebar profile panel gets a "Configuración" link for student role
- The dispatcher must check preferences for each enrolled user before generating notifications using `recipientUserIds` field
- Follow consent-api.js pattern for backend API (correlation headers, jsonResponse helper)
- Follow existing profile-sync pattern in auth.js for loading preferences on init
- All notification titles/messages remain in Spanish

**Ask First:**
- Adding a new nav item to the sidebar for settings

**Never:**
- Do not modify the notification-store.js storage mechanism (keep Blob JSON per subject)
- Do not add timezone preferences (handled by spec-gh-139)
- Do not add email/push channel preferences — only in-app toggle/cadence
- Do not modify the `UserProfiles` table — use dedicated `NotificationPreferences` table

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No preferences saved (first visit) | GET /api/reminder-preferences for userId | `{ enabled: true, cadence: 'both' }` | N/A |
| User enables reminders with 24h only | POST `{ enabled: true, cadence: '24h' }` | Saved to table, returns success | Bad request if missing fields -> 400 |
| User disables reminders | POST `{ enabled: false }` | Saved, dispatcher skips this user | N/A |
| Dispatcher with no users' pref records | Deadline at 48h threshold | Notification sent to all (default behavior) | N/A |
| Dispatcher with user who disabled | Deadline at 48h threshold | Notification NOT upserted for that user | N/A |
| Dispatcher with user on 24h cadence | Deadline at 48h threshold | User NOT included in recipients | N/A |
| Dispatcher with user on 24h cadence | Deadline at 24h threshold | User IS included in recipients | N/A |
| Invalid cadence in request | `{ cadence: 'invalid' }` | 400 Bad Request | Validation error |
| User not enrolled in subject | Any | No notification for that user | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/services/storage.js` — `getTableClient()` for Table Storage access
- `backend/src/functions/reminder-preferences.js` — New GET/POST endpoint for preferences
- `backend/src/functions/deadline-proximity-dispatcher.js` — Modified to check user preferences
- `backend/src/functions/deadline-proximity-dispatcher.test.js` — Updated tests for preference filtering
- `frontend/src/pages/student/Settings.js` — New settings page with reminder toggle + cadence
- `frontend/src/main.js` — Register `/student/settings` route
- `frontend/src/components/Sidebar.js` — Add settings link to student nav
- `frontend/src/services/api.js` — Add `getReminderPreferences()` and `saveReminderPreferences()` methods
- `frontend/src/services/auth.js` — Load reminder preferences on init

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/functions/reminder-preferences.js` — Create new HTTP function with GET (read preferences or return defaults) and POST (upsert preferences) at route `reminder-preferences`
- [x] `frontend/src/services/api.js` — Add `getReminderPreferences()` and `saveReminderPreferences(data)` methods with mock fallback
- [x] `frontend/src/pages/student/Settings.js` — Create settings page with deadline reminder toggle switch and cadence radio group (48h, 24h, both)
- [x] `frontend/src/main.js` — Register `/student/settings` route pointing to settings page
- [x] `frontend/src/components/Sidebar.js` — Add "Configuración" nav link for student role after "Calendario"
- [x] `frontend/src/services/auth.js` — Sync reminder preferences on `initAuth()` similar to profile/consent sync; store in sessionStorage
- [x] `backend/src/functions/deadline-proximity-dispatcher.js` — Add a `loadUserPreferences()` helper that reads from NotificationPreferences table; filter notification `recipientUserIds` to only include users whose preferences match the threshold
- [x] `backend/src/functions/deadline-proximity-dispatcher.test.js` — Add tests for dispatcher respecting preferences (disabled, 24h-only, 48h-only, no-pref-records)

**Acceptance Criteria:**
- Given a student viewing the settings page, when they toggle deadline reminders OFF and save, then no deadline notification is generated for that user
- Given a student with reminders ON and cadence "24h", when the 48h proximity window fires, then the user is NOT included in recipients for that notification
- Given a student with reminders ON and cadence "both", when the 48h proximity window fires, then the user IS included in recipients
- Given a student with no preference record, when the dispatcher runs, then the user receives all notifications (safe default)
- Given a student sets cadence to "48h only", when the 24h window fires, then the user is NOT included in recipients

## Verification

**Commands:**
- `npm --prefix backend test` — all existing + new tests pass
- `node -e "require('./frontend/src/services/api.js')"` — no import errors (lint check)

**Manual checks (if no CLI):**
- Navigate to `#/student/settings` and verify toggle + cadence options render correctly
- Verify sidebar shows "Configuración" link for student role
- Mock `USE_MOCK=true` and verify get/save returns mock defaults

## Suggested Review Order

**Entry point — backend API design**

- New GET/POST endpoint for per-user reminder preferences using provisioned NotificationPreferences table
  [`../../backend/src/functions/reminder-preferences.js`](../../backend/src/functions/reminder-preferences.js)

**Dispatcher integration — preference-aware filtering**

- Loads enrolled users per subject, checks each user's preferences via NotificationPreferences table, filters `recipientUserIds` accordingly
  [`../../backend/src/functions/deadline-proximity-dispatcher.js:68`](../../backend/src/functions/deadline-proximity-dispatcher.js#L68)

**Frontend — settings page UI**

- New student settings page with toggle switch and cadence radio group (48h/24h/both)
  [`../../frontend/src/pages/student/Settings.js`](../../frontend/src/pages/student/Settings.js)

- API methods for get/save reminder preferences with mock fallback
  [`../../frontend/src/services/api.js:1794`](../../frontend/src/services/api.js#L1794)

- Route registration for `/student/settings`
  [`../../frontend/src/main.js:20`](../../frontend/src/main.js#L20)

- Sidebar "Configuración" nav link for student role
  [`../../frontend/src/components/Sidebar.js:15`](../../frontend/src/components/Sidebar.js#L15)

- Auth init sync + getter/setter for session-cached preferences
  [`../../frontend/src/services/auth.js:297`](../../frontend/src/services/auth.js#L297)

**Tests**

- 5 new tests for preference-aware dispatching (disabled, 24h-only, 48h-only, no-pref defaults, inactive enrollment)
  [`../../backend/src/functions/deadline-proximity-dispatcher.test.js:304`](../../backend/src/functions/deadline-proximity-dispatcher.test.js#L304)
