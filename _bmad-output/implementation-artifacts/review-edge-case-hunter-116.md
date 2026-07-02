# Edge Case Hunter Review — GH-116 Timeout for Stale Processing Jobs

Review the following diff with read access to the project at `/Users/lucasvidmar/Documents/azure-educational-dashboard`. Walk every branching path and boundary condition. Report only unhandled edge cases.

```diff
diff --git a/frontend/src/services/processing-notifications.js b/frontend/src/services/processing-notifications.js
index 19b5f52..c7cf37e 100644
--- a/frontend/src/services/processing-notifications.js
+++ b/frontend/src/services/processing-notifications.js
@@ -13,6 +13,8 @@ const BROADCAST_KEY = 'uade.processing.last-broadcast';
 const POLL_INTERVAL_MS = Number(globalThis?.__UADE_PROCESSING_POLL_MS) > 0
     ? Number(globalThis.__UADE_PROCESSING_POLL_MS)
     : 8000;
+const JOB_TTL_MS = 30 * 60 * 1000;
+const MAX_POLL_RETRIES = 225;
 
 let trackedJobs = loadTrackedJobs();
 let timerId = null;
@@ -261,6 +263,7 @@ function normalizeTrackedJob(job) {
         trackedAt: typeof job.trackedAt === 'string' && job.trackedAt.trim()
             ? job.trackedAt
             : new Date().toISOString(),
+        pollCount: typeof job.pollCount === 'number' ? job.pollCount : 0,
     };
 }
 
@@ -277,6 +280,14 @@ function normalizeTrackedJobs(jobs) {
     return Array.from(dedupe.values());
 }
 
+function hasJobExpired(job) {
+    if (!job || !job.trackedAt) return true;
+    const age = Date.now() - new Date(job.trackedAt).getTime();
+    if (age > JOB_TTL_MS) return true;
+    if ((job.pollCount || 0) >= MAX_POLL_RETRIES) return true;
+    return false;
+}
+
 function ensurePolling() {
     if (timerId) return;
     timerId = setInterval(() => {
@@ -394,6 +405,29 @@ async function pollStatuses() {
             let terminal = null;
             let shouldFallbackToClasses = false;
 
+            job.pollCount = (job.pollCount || 0) + 1;
+
+            if (hasJobExpired(job)) {
+                const displayFilename = job.filename || 'Material';
+                toast('warning', 'Tiempo de espera agotado', `"${displayFilename}" está demorando más de lo esperado. Revisá el estado del material en la tabla o intentá la carga nuevamente.`, 8000);
+                console.warn(`[ProcessingNotifications] Job expired for "${displayFilename}" (trackedAt=${job.trackedAt}, pollCount=${job.pollCount})`);
+                const expiredIndex = trackedJobs.findIndex(
+                    (j) => j.materialId === job.materialId && j.subjectId === job.subjectId
+                );
+                if (expiredIndex !== -1) {
+                    trackedJobs.splice(expiredIndex, 1);
+                }
+                notifyListeners({
+                    type: 'material-status-terminal',
+                    terminal: 'expired',
+                    materialId: job.materialId,
+                    subjectId: job.subjectId,
+                    classIds: [...(job.classIds || [])],
+                    filename: job.filename,
+                });
+                continue;
+            }
+
             try {
                 const batchResult = batchStatusByKey.get(`${job.subjectId}::${job.materialId}`);
                 const statusResult = batchResult?.material || null;
@@ -469,6 +503,12 @@ export const processingNotifications = {
         const activeSubjectId = auth.getActiveSubjectId();
         if (activeSubjectId) {
             trackedJobs = trackedJobs.filter((job) => !!job?.materialId && !!job?.subjectId);
+        }
+
+        const beforeCleanup = trackedJobs.length;
+        trackedJobs = trackedJobs.filter((job) => !hasJobExpired(job));
+        if (trackedJobs.length !== beforeCleanup) {
+            console.warn(`[ProcessingNotifications] Cleaned ${beforeCleanup - trackedJobs.length} expired job(s) on init`);
             persistTrackedJobs();
         }
 
```

Read the full source file at `frontend/src/services/processing-notifications.js` and identify any edge cases the change does not handle. Consider:
- What happens if `job.trackedAt` is an invalid date string?
- What if a job is tracked with no `trackedAt` at all?
- What about the cross-tab sync — can an expired job be re-introduced from another tab?
- What about the toast buffer — could an expired job end up in the toast buffer AND get an expiry toast?
- What about the `persistTrackedJobs()` call in the original flow after `trackedJobs = pending`?

Return a bullet list of unhandled edge cases with severity (high/medium/low).
