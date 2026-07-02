# Blind Hunter Review — Issue #139

You are a blind hunter reviewer. You only see the diff below. You have NO context about the project, spec, or intent.

Review the following code diff and identify any issues, bugs, security concerns, logic errors, or suspicious patterns.

```diff
diff --git a/backend/package.json b/backend/package.json
index 886d943..0c1ec8b 100644
--- a/backend/package.json
+++ b/backend/package.json
@@ -24,6 +24,7 @@
         "busboy": "^1.6.0",
         "js-tiktoken": "^1.0.21",
         "mammoth": "^1.8.0",
+        "moment-timezone": "^0.6.2",
         "openai": "^4.77.0",
         "pdf-parse": "^1.1.1",
         "uuid": "^11.0.5"
diff --git a/backend/src/functions/deadline-proximity-dispatcher.js b/backend/src/functions/deadline-proximity-dispatcher.js
index 074e375..0ca11f6 100644
--- a/backend/src/functions/deadline-proximity-dispatcher.js
+++ b/backend/src/functions/deadline-proximity-dispatcher.js
@@ -1,13 +1,28 @@
 import { app } from '@azure/functions';
+import moment from 'moment-timezone';
 import { listBlobs, loadJson } from '../services/storage.js';
 import { listNotificationsBySubject, upsertNotificationForSubject } from '../services/notification-store.js';
 
 const CONTAINER_DEADLINES = 'deadlines';
+const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
 
-function parseDeadlineDueAtUtc(dueDate) {
+function resolveTimezone(deadline) {
+  const tz = deadline?.timezone || process.env.DEFAULT_TIMEZONE || DEFAULT_TIMEZONE;
+  if (moment.tz.zone(tz)) return tz;
+  return DEFAULT_TIMEZONE;
+}
+
+function parseDeadlineDueAt(dueDate, timezone) {
   if (typeof dueDate !== 'string' || dueDate.trim().length === 0) return null;
-  const normalized = dueDate.trim().length === 10 ? `${dueDate.trim()}T00:00:00.000Z` : dueDate.trim();
-  const parsed = new Date(normalized);
+  const trimmed = dueDate.trim();
+
+  if (trimmed.length === 10) {
+    const local = moment.tz(trimmed, 'YYYY-MM-DD', true, timezone);
+    if (!local.isValid()) return null;
+    return local.toDate();
+  }
+
+  const parsed = new Date(trimmed);
   if (Number.isNaN(parsed.getTime())) return null;
   return parsed;
 }
@@ -27,7 +42,7 @@ function isWithinThresholdWindow({ dueAt, now, thresholdHours, windowHours }) {
   return diffMs <= thresholdMs && diffMs > (thresholdMs - windowMs);
 }
 
-function buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt, now }) {
+function buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt, now, timezone }) {
   const deadlineId = String(deadline?.id || `${deadline?.classId || 'class'}-${deadline?.title || 'deadline'}`).replace(/\s+/g, '-').toLowerCase();
   const id = `notif-deadline-${subjectId}-${deadlineId}-${thresholdHours}h`;
   const title = thresholdHours === 48 ? 'Deadline en 48 horas' : 'Deadline en 24 horas';
@@ -46,6 +61,7 @@ function buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt,
     subjectId,
     recipientUserIds: [],
     origin: 'deadline-proximity-timer',
+    dueDateTimezone: timezone,
   };
 }
 
@@ -68,7 +84,8 @@ export async function runDeadlineProximityDispatcher(context = { log: () => {},
 
     for (const deadline of deadlines) {
       try {
-        const dueAt = parseDeadlineDueAtUtc(deadline?.dueDate);
+        const timezone = resolveTimezone(deadline);
+        const dueAt = parseDeadlineDueAt(deadline?.dueDate, timezone);
         if (!dueAt) continue;
 
         const thresholds = [48, 24];
@@ -76,7 +93,7 @@ export async function runDeadlineProximityDispatcher(context = { log: () => {},
           const withinWindow = isWithinThresholdWindow({ dueAt, now, thresholdHours, windowHours });
           if (!withinWindow) continue;
 
-          const notification = buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt, now });
+          const notification = buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt, now, timezone });
           if (existingIds.has(notification.id)) continue;
 
           await upsertNotificationForSubject(subjectId, notification);
@@ -84,7 +101,7 @@ export async function runDeadlineProximityDispatcher(context = { log: () => {},
           dispatched += 1;
         }
       } catch (err) {
-        context.error(`[deadline-proximity-dispatcher] subject=${subjectId} deadline=${deadline?.id || 'unknown'} error=${err.message}`);
+        context.error(`[deadline-proximity-dispatcher] subject=${subjectId} deadline=${deadline?.id || 'unknown'} timezone=${resolveTimezone(deadline)} error=${err.message}`);
       }
     }
   }
diff --git a/backend/src/functions/deadlines.js b/backend/src/functions/deadlines.js
index 72c746b..1528020 100644
--- a/backend/src/functions/deadlines.js
+++ b/backend/src/functions/deadlines.js
@@ -23,6 +23,7 @@ function normalizeDeadline(deadline = {}) {
         subjectId: deadline.subjectId,
         classId: deadline.classId,
         dueDate: deadline.dueDate,
+        timezone: deadline.timezone || null,
         notifyOnDayBefore: deadline.notifyOnDayBefore !== false,
         notifyOnDayOf: deadline.notifyOnDayOf !== false,
         createdAt: deadline.createdAt || new Date().toISOString(),
```
