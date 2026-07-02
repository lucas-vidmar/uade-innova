# Blind Hunter Review — Issue #138

You are a blind hunter reviewer. You receive ONLY the diff below — no spec, no project context, no file access. Your job is to find defects, logic errors, security issues, and edge cases in the code changes.

## Diff

\`\`\`diff
diff --git a/backend/src/functions/deadline-proximity-dispatcher.js b/backend/src/functions/deadline-proximity-dispatcher.js
index 0ca11f6..4800dd9 100644
--- a/backend/src/functions/deadline-proximity-dispatcher.js
+++ b/backend/src/functions/deadline-proximity-dispatcher.js
@@ -45,7 +45,7 @@ function isWithinThresholdWindow({ dueAt, now, thresholdHours, windowHours }) {
 function buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt, now, timezone }) {
   const deadlineId = String(deadline?.id || `${deadline?.classId || 'class'}-${deadline?.title || 'deadline'}`).replace(/\s+/g, '-').toLowerCase();
   const id = `notif-deadline-${subjectId}-${deadlineId}-${thresholdHours}h`;
-  const title = thresholdHours === 48 ? 'Deadline en 48 horas' : 'Deadline en 24 horas';
+  const title = thresholdHours === 48 ? 'Deadline en 48 horas' : thresholdHours === 2 ? '⚠️ Deadline urgente — 2 horas restantes' : 'Deadline en 24 horas';
   const classLabel = deadline?.classId ? ` · ${deadline.classId}` : '';
   const dueDateLabel = dueAt.toISOString().slice(0, 10);
   const message = `${deadline?.title || 'Entrega pendiente'} vence el ${dueDateLabel}${classLabel}.`;
@@ -67,6 +67,7 @@ function buildReminderNotification({ subjectId, deadline, thresholdHours, dueAt,

 export async function runDeadlineProximityDispatcher(context = { log: () => {}, error: () => {} }, now = new Date()) {
   const windowHours = normalizeWindowHours(process.env.DEADLINE_PROXIMITY_WINDOW_HOURS);
+  const weightThreshold = Number(process.env.DEADLINE_HIGH_PRIORITY_WEIGHT_THRESHOLD) || 25;
   const deadlineBlobs = await listBlobs(CONTAINER_DEADLINES);
   const subjectIds = deadlineBlobs
     .filter((name) => name.endsWith('.json'))
@@ -100,6 +101,20 @@ export async function runDeadlineProximityDispatcher(context = { log: () => {},
           existingIds.add(notification.id);
           dispatched += 1;
         }
+
+        const isHighPriority = (deadline?.weight || 0) >= weightThreshold;
+        const isPending = (deadline?.status || 'pending') !== 'completed';
+        if (isHighPriority && isPending) {
+          const withinWindow2h = isWithinThresholdWindow({ dueAt, now, thresholdHours: 2, windowHours });
+          if (withinWindow2h) {
+            const notification = buildReminderNotification({ subjectId, deadline, thresholdHours: 2, dueAt, now, timezone });
+            if (!existingIds.has(notification.id)) {
+              await upsertNotificationForSubject(subjectId, notification);
+              existingIds.add(notification.id);
+              dispatched += 1;
+            }
+          }
+        }
       } catch (err) {
         context.error(`[deadline-proximity-dispatcher] subject=${subjectId} deadline=${deadline?.id || 'unknown'} timezone=${resolveTimezone(deadline)} error=${err.message}`);
       }
diff --git a/backend/src/functions/deadline-proximity-dispatcher.test.js b/backend/src/functions/deadline-proximity-dispatcher.test.js
index fa267ae..2f79728 100644
--- a/backend/src/functions/deadline-proximity-dispatcher.test.js
+++ b/backend/src/functions/deadline-proximity-dispatcher.test.js
@@ -194,6 +194,104 @@ test('deadline-proximity-dispatcher should fall back to default for invalid time
   assert.strictEqual(payload.dueDateTimezone, 'America/Argentina/Buenos_Aires');
 });

+test('deadline-proximity-dispatcher should emit 2h escalation for high-weight pending deadline', async () => {
+  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
+  storageMocks.loadJson.mock.mockImplementation(async () => ([
+    {
+      id: 'deadline-high-weight',
+      title: 'Parcial 1',
+      subjectId: 'arq-software-2026',
+      classId: 'class-05',
+      dueDate: '2026-04-11T11:00:00.000Z',
+      weight: 35,
+      status: 'pending',
+    },
+  ]));
+  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);
+
+  const now = new Date('2026-04-11T09:30:00.000Z');
+  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);
+
+  assert.strictEqual(result.dispatched, 1);
+  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
+  assert.strictEqual(payload.title, '⚠️ Deadline urgente — 2 horas restantes');
+  assert.ok(payload.id.endsWith('-2h'));
+});
+
+test('deadline-proximity-dispatcher should NOT emit 2h escalation for low-weight deadline', async () => {
+  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
+  storageMocks.loadJson.mock.mockImplementation(async () => ([
+    {
+      id: 'deadline-low-weight',
+      title: 'Lectura opcional',
+      subjectId: 'arq-software-2026',
+      classId: 'class-05',
+      dueDate: '2026-04-11T11:00:00.000Z',
+      weight: 5,
+      status: 'pending',
+    },
+  ]));
+  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);
+
+  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
+  const now = new Date('2026-04-11T09:30:00.000Z');
+  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);
+  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
+
+  assert.strictEqual(result.dispatched, 0);
+  assert.strictEqual(after, before);
+});
+
+test('deadline-proximity-dispatcher should NOT emit 2h escalation for completed deadline', async () => {
+  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
+  storageMocks.loadJson.mock.mockImplementation(async () => ([
+    {
+      id: 'deadline-completed',
+      title: 'TP entregado',
+      subjectId: 'arq-software-2026',
+      classId: 'class-05',
+      dueDate: '2026-04-11T11:00:00.000Z',
+      weight: 40,
+      status: 'completed',
+    },
+  ]));
+  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);
+
+  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
+  const now = new Date('2026-04-11T09:30:00.000Z');
+  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);
+  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
+
+  assert.strictEqual(result.dispatched, 0);
+  assert.strictEqual(after, before);
+});
+
+test('deadline-proximity-dispatcher should skip duplicate 2h escalation', async () => {
+  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
+  storageMocks.loadJson.mock.mockImplementation(async () => ([
+    {
+      id: 'deadline-dup-2h',
+      title: 'Parcial 2',
+      subjectId: 'arq-software-2026',
+      classId: 'class-06',
+      dueDate: '2026-04-11T11:00:00.000Z',
+      weight: 30,
+      status: 'pending',
+    },
+  ]));
+  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
+    { id: 'notif-deadline-arq-software-2026-deadline-dup-2h-2h' },
+  ]));
+
+  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
+  const now = new Date('2026-04-11T09:30:00.000Z');
+  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);
+  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
+
+  assert.strictEqual(result.dispatched, 0);
+  assert.strictEqual(after, before);
+});
+
 test('deadline-proximity-dispatcher should use UTC timezone when specified', async () => {
   storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
   storageMocks.loadJson.mock.mockImplementation(async () => ([
diff --git a/backend/src/functions/deadlines.js b/backend/src/functions/deadlines.js
index 1528020..2568677 100644
--- a/backend/src/functions/deadlines.js
+++ b/backend/src/functions/deadlines.js
@@ -26,6 +26,8 @@ function normalizeDeadline(deadline = {}) {
         timezone: deadline.timezone || null,
         notifyOnDayBefore: deadline.notifyOnDayBefore !== false,
         notifyOnDayOf: deadline.notifyOnDayOf !== false,
+        weight: deadline.weight || 0,
+        status: deadline.status || 'pending',
         createdAt: deadline.createdAt || new Date().toISOString(),
         updatedAt: new Date().toISOString(),
     };
\ No newline at end of file
\`\`\`

Return only findings as a categorized list. Do not include commentary.
