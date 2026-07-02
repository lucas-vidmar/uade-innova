# Blind Hunter Review — GH-134 Retry and Dead-Letter Strategy

You are a **blind hunter** reviewer. You receive ONLY the diff below. No spec, no context docs, no project access.

Your job: read the diff with adversarial suspicion. Find bugs, logic errors, race conditions, resource leaks, error-handling gaps, security issues, and anything that looks wrong. Be thorough. Report each finding with:

1. **File**:line (relative path)
2. **Severity**: high / medium / low
3. **Description**: what is wrong and why it matters
4. **Suggested fix**: how to correct it

```
diff --git a/backend/src/functions/deadline-proximity-dispatcher.js b/backend/src/functions/deadline-proximity-dispatcher.js
index 4951bc8..d8409bc 100644
--- a/backend/src/functions/deadline-proximity-dispatcher.js
+++ b/backend/src/functions/deadline-proximity-dispatcher.js
@@ -3,6 +3,7 @@ import moment from 'moment-timezone';
 import { listBlobs, loadJson, getTableClient } from '../services/storage.js';
 import { listNotificationsBySubject, upsertNotificationForSubject } from '../services/notification-store.js';
 import { getEnrollmentsBySubject } from '../services/state-store.js';
+import { trackDispatcherRun } from '../services/telemetry.js';
 
 const CONTAINER_DEADLINES = 'deadlines';
 const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
@@ -89,6 +90,7 @@ function buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt,
 }
 
 export async function runDeadlineProximityDispatcher(context = { log: () => {}, error: () => {} }, now = new Date()) {
+  const startedAt = Date.now();
   const windowHours = normalizeWindowHours(process.env.DEADLINE_PROXIMITY_WINDOW_HOURS);
   const weightThreshold = Number(process.env.DEADLINE_HIGH_PRIORITY_WEIGHT_THRESHOLD) || 25;
   const deadlineBlobs = await listBlobs(CONTAINER_DEADLINES);
@@ -98,6 +100,10 @@ export async function runDeadlineProximityDispatcher(context = { log: () => {},
     .filter(Boolean);
 
   let dispatched = 0;
+  let errors = 0;
+  let retryAttempts = 0;
+  let deadLetterWrites = 0;
+  const errorEntries = [];
 
   for (const subjectId of subjectIds) {
     const deadlines = await loadJson(CONTAINER_DEADLINES, `${subjectId}.json`);
@@ -153,18 +159,41 @@ export async function runDeadlineProximityDispatcher(context = { log: () => {},
 
           if (existingIds.has(notification.id)) continue;
 
-          await upsertNotificationForSubject(subjectId, notification);
+          const { retryAttempts: retries, deadLetterWrites: dlWrites } = await upsertNotificationForSubject(subjectId, notification);
+          retryAttempts += retries;
+          deadLetterWrites += dlWrites;
           existingIds.add(notification.id);
           dispatched += 1;
         }
       } catch (err) {
+        errors += 1;
+        errorEntries.push(`subject=${subjectId} deadline=${deadline?.id || 'unknown'}`);
         context.error(`[deadline-proximity-dispatcher] subject=${subjectId} deadline=${deadline?.id || 'unknown'} timezone=${resolveTimezone(deadline)} error=${err.message}`);
       }
     }
   }
 
-  context.log(`[deadline-proximity-dispatcher] completed; notifications upserted=${dispatched}; subjects=${subjectIds.length}`);
-  return { dispatched, subjectCount: subjectIds.length };
+  const durationMs = Date.now() - startedAt;
+  context.log(`[deadline-proximity-dispatcher] completed; notifications upserted=${dispatched} errors=${errors} retryAttempts=${retryAttempts} deadLetterWrites=${deadLetterWrites} subjects=${subjectIds.length} duration=${durationMs}ms`);
+
+  try {
+    await trackDispatcherRun({
+      dispatcherName: 'deadline-proximity',
+      subjectCount: subjectIds.length,
+      classCount: 0,
+      dispatched,
+      skipped: 0,
+      errors,
+      retryAttempts,
+      deadLetterWrites,
+      durationMs,
+      errorDetails: errorEntries.length > 0 ? errorEntries.join(' | ') : undefined,
+    });
+  } catch (telemetryErr) {
+    context.error(`[deadline-proximity-dispatcher] telemetry error: ${telemetryErr.message}`);
+  }
+
+  return { dispatched, subjectCount: subjectIds.length, errors, retryAttempts, deadLetterWrites, durationMs };
 }
 
 app.timer('deadline-proximity-dispatcher', {
diff --git a/backend/src/functions/notifications.js b/backend/src/functions/notifications.js
index aad0919..0a03c64 100644
--- a/backend/src/functions/notifications.js
+++ b/backend/src/functions/notifications.js
@@ -208,9 +208,10 @@ app.http('mark-notification-read', {
       if (!target) return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Notification not found for subject' }) };
       if (!canReceiveNotification(target, userId)) return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Notification does not belong to user' }) };
 
-      await notificationStore.markNotificationReadForUser(subjectId, notificationId, userId);
-      context.log(`[notifications] marked as read id=${notificationId} subjectId=${subjectId} userId=${userId}`);
+      const { success: marked, retryAttempts } = await notificationStore.markNotificationReadForUser(subjectId, notificationId, userId);
+      context.log(`[notifications] marked as read id=${notificationId} subjectId=${subjectId} userId=${userId} retryAttempts=${retryAttempts}`);
       trackNotificationInteraction({ action: 'mark_read', status: 'success', userId, subjectId, notificationId }).catch((err) => context.error('[Telemetry] Error emitting NotificationInteraction:', err));
+      if (!marked) return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed to persist read status' }) };
       return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: notificationId, unread: false }) };
     } catch (err) {
       context.error(`[notifications] failed to mark read id=${notificationId} subjectId=${subjectId}: ${err.message}`);
@@ -385,7 +386,7 @@ app.http('mark-notifications-read', {
           target = notifications.find((item) => item.id === notificationId);
         }
         if (!target || !canReceiveNotification(target, userId)) continue;
-        const marked = await notificationStore.markNotificationReadForUser(subjectId, notificationId, userId);
+        const { success: marked } = await notificationStore.markNotificationReadForUser(subjectId, notificationId, userId);
         if (marked) updated += 1;
       }
 
diff --git a/backend/src/functions/notifications.test.js b/backend/src/functions/notifications.test.js
index 7605ef3..fd2a1e0 100644
--- a/backend/src/functions/notifications.test.js
+++ b/backend/src/functions/notifications.test.js
@@ -9,7 +9,7 @@ const authMocks = {
 const notificationStoreMocks = {
     listNotificationsBySubject: mock.fn(async () => []),
     listNotificationsSince: mock.fn(async () => []),
-    markNotificationReadForUser: mock.fn(async () => true),
+    markNotificationReadForUser: mock.fn(async () => ({ success: true, retryAttempts: 0, deadLetterWrites: 0 })),
 };
 
 const telemetryMocks = {
diff --git a/backend/src/functions/post-class-summary-dispatcher.js b/backend/src/functions/post-class-summary-dispatcher.js
index 98fe8b5..c97a042 100644
--- a/backend/src/functions/post-class-summary-dispatcher.js
+++ b/backend/src/functions/post-class-summary-dispatcher.js
@@ -52,6 +52,8 @@ export async function runPostClassSummaryDispatcher(context = { log: () => {}, e
   let classCount = 0;
   let skipped = 0;
   let errors = 0;
+  let retryAttempts = 0;
+  let deadLetterWrites = 0;
   const errorEntries = [];
 
   for (const subjectId of subjectIds) {
@@ -68,7 +70,7 @@ export async function runPostClassSummaryDispatcher(context = { log: () => {}, e
         }
 
         const classId = String(classData.id);
-        await upsertNotificationForSubject(subjectId, {
+        const { retryAttempts: retries, deadLetterWrites: dlWrites } = await upsertNotificationForSubject(subjectId, {
           id: notificationIdForClass(subjectId, classId),
           type: 'summary',
           title: 'Resumen validado por docente',
@@ -81,6 +83,8 @@ export async function runPostClassSummaryDispatcher(context = { log: () => {}, e
           origin: 'post-class-summary-timer',
         });
 
+        retryAttempts += retries;
+        deadLetterWrites += dlWrites;
         dispatched += 1;
       } catch (err) {
         errors += 1;
@@ -92,7 +96,7 @@ export async function runPostClassSummaryDispatcher(context = { log: () => {}, e
 
   const durationMs = Date.now() - startedAt;
 
-  context.log(`[post-class-summary-dispatcher] completed; subjects=${subjectIds.length} classes=${classCount} dispatched=${dispatched} skipped=${skipped} errors=${errors} duration=${durationMs}ms`);
+  context.log(`[post-class-summary-dispatcher] completed; subjects=${subjectIds.length} classes=${classCount} dispatched=${dispatched} skipped=${skipped} errors=${errors} retryAttempts=${retryAttempts} deadLetterWrites=${deadLetterWrites} duration=${durationMs}ms`);
 
   try {
     await trackDispatcherRun({
@@ -102,6 +106,8 @@ export async function runPostClassSummaryDispatcher(context = { log: () => {}, e
       dispatched,
       skipped,
       errors,
+      retryAttempts,
+      deadLetterWrites,
       durationMs,
       errorDetails: errorEntries.length > 0 ? errorEntries.join(' | ') : undefined,
     });
@@ -109,7 +115,7 @@ export async function runPostClassSummaryDispatcher(context = { log: () => {}, e
     context.error(`[post-class-summary-dispatcher] telemetry error: ${telemetryErr.message}`);
   }
 
-  return { dispatched, subjectCount: subjectIds.length, classCount, skipped, errors, durationMs };
+  return { dispatched, subjectCount: subjectIds.length, classCount, skipped, errors, retryAttempts, deadLetterWrites, durationMs };
 }
 
 app.timer('post-class-summary-dispatcher', {
diff --git a/backend/src/services/notification-store.js b/backend/src/services/notification-store.js
index 1f89550..adb28e0 100644
--- a/backend/src/services/notification-store.js
+++ b/backend/src/services/notification-store.js
@@ -1,6 +1,49 @@
 import { loadJson, saveJson } from './storage.js';
 
 const CONTAINER_NOTIFICATIONS = 'notifications';
+const CONTAINER_CLASS_MATERIALS = process.env.AZURE_STORAGE_CONTAINER_MATERIALS || 'class-materials';
+const MAX_RETRIES = 3;
+const BASE_DELAY_MS = 200;
+
+function sleep(ms) {
+  return new Promise((resolve) => setTimeout(resolve, ms));
+}
+
+async function saveJsonWithRetry(container, blobName, data) {
+  let lastError;
+  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
+    try {
+      await saveJson(container, blobName, data);
+      return { retryAttempts: attempt - 1, deadLetterWritten: false };
+    } catch (err) {
+      lastError = err;
+      if (attempt < MAX_RETRIES) {
+        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
+      }
+    }
+  }
+
+  const subjectId = data?.subjectId || 'unknown';
+  const notificationId = data?.id || 'unknown';
+  const dlBlobName = `dead-letter/notifications/${subjectId}/${Date.now()}-${notificationId}.json`;
+  const dlPayload = {
+    originalPayload: data,
+    _dlMeta: {
+      originalError: lastError.message,
+      retryCount: MAX_RETRIES,
+      failedAt: new Date().toISOString(),
+    },
+  };
+  try {
+    await saveJson(CONTAINER_CLASS_MATERIALS, dlBlobName, dlPayload);
+    return { retryAttempts: MAX_RETRIES, deadLetterWritten: true };
+  } catch (dlErr) {
+    console.error(
+      `[notification-store] saveJson failed after ${MAX_RETRIES} retries and dead-letter write also failed: ${lastError.message} | dl: ${dlErr.message}`
+    );
+    return { retryAttempts: MAX_RETRIES, deadLetterWritten: false, dlWriteError: dlErr.message };
+  }
+}
 
 function normalizeRecipientUserIds(value) {
   if (!Array.isArray(value)) return [];
@@ -48,7 +91,7 @@ export async function listNotificationsSince(subjectId, sinceTimestamp) {
 }
 
 export async function upsertNotificationForSubject(subjectId, notification) {
-  if (!subjectId) return false;
+  if (!subjectId) return { success: false, retryAttempts: 0, deadLetterWrites: 0 };
   const current = await listNotificationsBySubject(subjectId);
   const normalized = normalizeNotification({ ...notification, subjectId }, current.length);
   const idx = current.findIndex((item) => item.id === normalized.id);
@@ -61,16 +104,20 @@ export async function upsertNotificationForSubject(subjectId, notification) {
   }
 
   next.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
-  await saveJson(CONTAINER_NOTIFICATIONS, `${subjectId}.json`, next);
-  return true;
+  const result = await saveJsonWithRetry(CONTAINER_NOTIFICATIONS, `${subjectId}.json`, next);
+  return {
+    success: !result.deadLetterWritten && !result.dlWriteError,
+    retryAttempts: result.retryAttempts,
+    deadLetterWrites: result.deadLetterWritten ? 1 : 0,
+  };
 }
 
 export async function markNotificationReadForUser(subjectId, notificationId, userId) {
-  if (!subjectId || !notificationId || !userId) return false;
+  if (!subjectId || !notificationId || !userId) return { success: false, retryAttempts: 0, deadLetterWrites: 0 };
 
   const current = await listNotificationsBySubject(subjectId);
   const idx = current.findIndex((item) => item.id === notificationId);
-  if (idx < 0) return false;
+  if (idx < 0) return { success: false, retryAttempts: 0, deadLetterWrites: 0 };
 
   const target = current[idx];
   const readByUserIds = normalizeReadByUserIds(target.readByUserIds);
@@ -80,6 +127,10 @@ export async function markNotificationReadForUser(subjectId, notificationId, use
 
   const next = [...current];
   next[idx] = { ...target, readByUserIds };
-  await saveJson(CONTAINER_NOTIFICATIONS, `${subjectId}.json`, next);
-  return true;
+  const result = await saveJsonWithRetry(CONTAINER_NOTIFICATIONS, `${subjectId}.json`, next);
+  return {
+    success: !result.deadLetterWritten && !result.dlWriteError,
+    retryAttempts: result.retryAttempts,
+    deadLetterWrites: result.deadLetterWritten ? 1 : 0,
+  };
 }
diff --git a/backend/src/services/notification-store.test.js b/backend/src/services/notification-store.test.js
index a8a24c8..aae045b 100644
--- a/backend/src/services/notification-store.test.js
+++ b/backend/src/services/notification-store.test.js
@@ -24,7 +24,7 @@ test('upsertNotificationForSubject should replace existing notification by id',
     },
   ]));
 
-  await store.upsertNotificationForSubject('arq-software-2026', {
+  const result = await store.upsertNotificationForSubject('arq-software-2026', {
     id: 'notif-auto-summary-arq-software-2026-class-03',
     type: 'summary',
     title: 'Resumen validado por docente',
@@ -35,6 +35,8 @@ test('upsertNotificationForSubject should replace existing notification by id',
   });
 
   assert.ok(storageMocks.saveJson.mock.callCount() >= 1);
+  assert.strictEqual(result.success, true);
+  assert.strictEqual(result.retryAttempts, 0);
   const [, , payload] = storageMocks.saveJson.mock.calls.at(-1).arguments;
   assert.strictEqual(Array.isArray(payload), true);
   assert.strictEqual(payload.length, 1);
@@ -54,10 +56,68 @@ test('markNotificationReadForUser should append user to readByUserIds', async ()
     },
   ]));
 
-  const updated = await store.markNotificationReadForUser('arq-software-2026', 'notif-1', 'alu-001');
-  assert.strictEqual(updated, true);
+  const result = await store.markNotificationReadForUser('arq-software-2026', 'notif-1', 'alu-001');
+  assert.strictEqual(result.success, true);
+  assert.strictEqual(result.retryAttempts, 0);
 
   const [, , payload] = storageMocks.saveJson.mock.calls.at(-1).arguments;
   assert.strictEqual(payload[0].id, 'notif-1');
   assert.deepStrictEqual(payload[0].readByUserIds, ['alu-001']);
 });
+
+test('should retry on transient saveJson failure and succeed', async () => {
+  let callCount = 0;
+  storageMocks.loadJson.mock.mockImplementation(async () => []);
+  storageMocks.saveJson.mock.mockImplementation(async () => {
+    callCount += 1;
+    if (callCount <= 2) throw new Error('Transient storage error');
+  });
+
+  const result = await store.upsertNotificationForSubject('arq-software-2026', {
+    id: 'notif-retry-test',
+    type: 'material',
+    title: 'Retry test',
+    subjectId: 'arq-software-2026',
+  });
+
+  assert.strictEqual(result.success, true);
+  assert.strictEqual(result.retryAttempts, 2);
+  assert.strictEqual(result.deadLetterWrites, 0);
+  assert.strictEqual(callCount, 3);
+});
+
+test('should write dead-letter after exhausting all retries', async () => {
+  let callCount = 0;
+  storageMocks.loadJson.mock.mockImplementation(async () => []);
+  storageMocks.saveJson.mock.mockImplementation(async () => {
+    callCount += 1;
+    if (callCount <= 3) throw new Error('Persistent storage error');
+  });
+
+  const result = await store.upsertNotificationForSubject('arq-software-2026', {
+    id: 'notif-dl-test',
+    type: 'material',
+    title: 'Dead letter test',
+    subjectId: 'arq-software-2026',
+  });
+
+  assert.strictEqual(result.success, false);
+  assert.strictEqual(result.retryAttempts, 3);
+  assert.strictEqual(result.deadLetterWrites, 1);
+  assert.strictEqual(callCount, 4);
+});
+
+test('should mark notification read with retry on transient failure', async () => {
+  let callCount = 0;
+  storageMocks.loadJson.mock.mockImplementation(async () => ([
+    { id: 'notif-retry-read', type: 'material', title: 'Test', subjectId: 's1', unread: true, readByUserIds: [] },
+  ]));
+  storageMocks.saveJson.mock.mockImplementation(async () => {
+    callCount += 1;
+    if (callCount <= 1) throw new Error('Transient error');
+  });
+
+  const result = await store.markNotificationReadForUser('s1', 'notif-retry-read', 'user-1');
+  assert.strictEqual(result.success, true);
+  assert.strictEqual(result.retryAttempts, 1);
+});
+diff --git a/backend/src/services/telemetry.js b/backend/src/services/telemetry.js
index 89b8b0f..c00d146 100644
--- a/backend/src/services/telemetry.js
+++ b/backend/src/services/telemetry.js
@@ -225,6 +225,8 @@ export async function trackUserLogin({ userId, roles = [] }) {
  * @param {number} params.skipped         - Items skipped (future date, not ready, etc.)
  * @param {number} params.errors          - Count of errors caught during the run
  * @param {number} params.durationMs      - Wall-clock execution time in milliseconds
+ * @param {number} [params.retryAttempts] - Total retry attempts across all upsert operations
+ * @param {number} [params.deadLetterWrites] - Total dead-letter blobs written due to exhaustion
  * @param {string} [params.errorDetails]  - Concatenated error context for troubleshooting (subjectId/classId)
  */
 export async function trackDispatcherRun({
@@ -234,6 +236,8 @@ export async function trackDispatcherRun({
     dispatched = 0,
     skipped = 0,
     errors = 0,
+    retryAttempts = 0,
+    deadLetterWrites = 0,
     durationMs = 0,
     errorDetails,
 }) {
@@ -252,11 +256,45 @@ export async function trackDispatcherRun({
             dispatched: Math.max(0, Number(dispatched) || 0),
             skipped: Math.max(0, Number(skipped) || 0),
             errors: Math.max(0, Number(errors) || 0),
+            retryAttempts: Math.max(0, Number(retryAttempts) || 0),
+            deadLetterWrites: Math.max(0, Number(deadLetterWrites) || 0),
             durationMs: Math.max(0, Number(durationMs) || 0),
         },
     });
 }
 
+/**
+ * Tracks a dead-letter write event when a notification payload exhausts all retries.
+ *
+ * @param {object} params
+ * @param {string} params.subjectId     - Subject identifier
+ * @param {string} params.notificationId - Original notification ID
+ * @param {string} params.blobPath      - Dead-letter blob path in storage
+ * @param {number} params.retryCount    - Number of retry attempts before dead-letter
+ * @param {string} params.originalError - Truncated error message from the last saveJson attempt
+ */
+export async function trackDeadLetterWrite({
+    subjectId,
+    notificationId,
+    blobPath,
+    retryCount,
+    originalError,
+}) {
+    const client = await getClient();
+    if (!client) return;
+
+    client.trackEvent({
+        name: 'DeadLetterWrite',
+        properties: {
+            subjectId: subjectId || 'unknown',
+            notificationId: notificationId || 'unknown',
+            blobPath: blobPath || 'unknown',
+            retryCount: String(retryCount || 0),
+            originalError: originalError ? String(originalError).slice(0, 500) : '',
+        },
+    });
+}
+
 /**
  * Tracks a categorized RAG error event for telemetry monitoring.
  *
```
