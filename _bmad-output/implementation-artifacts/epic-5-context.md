# Epic 5 Context: Smart Notifications & Academic Engagement

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Students and teachers receive timely, relevant notifications about deadlines, materials, and corrections. The system sends deadline proximity alerts (48h/24h), teacher material upload reminders, new-material and correction notifications, and supports per-user preference control over which notification types they receive.

## Stories

- Story 5.1: Teacher Material Upload Reminders
- Story 5.2: Student Deadline and Material Alerts (covers #139 Timezone-Aware Deadline Notifications)
- Story 5.3: Notification Preferences
- Story 5.4a: Academic Timeline and Material Browser
- Story 5.4b: AI-Generated Class Summary

## Requirements & Constraints

- FR45: System sends deadline proximity alerts (48h/24h) to students
- FR42: System sends teacher material upload reminders before scheduled classes
- FR44: System notifies students when new materials or summaries are published
- FR46: Users can configure notification preferences (frequency, channel, types)
- Notification content must be in Spanish
- Notifications stored per-subject in Blob Storage (JSON), not Table Storage (use `notification-store.js`)
- Timer triggers run on Consumption Plan — must be fast and idempotent

## Technical Decisions

- **Notification storage:** Blob Storage JSON files per subject (`notifications/{subjectId}.json`) via `notification-store.js`; no Table Storage for this
- **Deadline data:** Stored as JSON files per subject (`deadlines/{subjectId}.json`) with fields: id, title, subjectId, classId, dueDate, notifyOnDayBefore, notifyOnDayOf
- **Deadline proximity dispatcher:** Timer trigger every 30 min evaluating 48h/24h thresholds with dedup via notification ID
- **Teacher reminders:** Timer trigger daily at 08:00 checking upcoming classes and their material status
- **Notification types:** `grade`, `summary`, `material`, `deadline`, `teacher-reminder`
- **Timezones:** No current timezone support — all deadline evaluations are UTC-only. Timezone support should use a precedence model (student-level > subject-level > system default) and `moment-timezone` is available as transitive dependency (install if needed)
- **Notifications have `targetHash` for frontend deep-linking (e.g. `#/student/calendar`)**

## UX & Interaction Patterns

- Notifications feed accessible from sidebar with unread count badge
- "Mark as read" interaction available per-notification or bulk
- Deadline reminders deep-link to `#/student/calendar`
- Teacher upload reminders deep-link to teacher upload panel
- All notification titles and messages in Spanish

## Cross-Story Dependencies

- Story 5.3 (Notification Preferences) provides the user preference store — 5.1 and 5.2 should check preferences before sending
- Story 5.4a (Academic Timeline) provides the class schedule data consumed by 5.1 reminders
- Deadline infrastructure (JSON storage, CRUD endpoints) is shared across all notification stories
