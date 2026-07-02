# Acceptance Auditor Review — GH-116 Timeout for Stale Processing Jobs

Review the diff against the spec at `_bmad-output/implementation-artifacts/spec-gh-116-timeout-stale-processing.md`. You have read access to the project.

Read the spec file and the diff, then check whether every acceptance criterion and constraint is satisfied.

**The diff:**

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

**Acceptance Criteria from spec:**
1. Given a tracked job exceeds 30 minutes since `trackedAt`, when the next poll cycle runs, then the job is removed from tracking and a warning toast with actionable guidance is shown
2. Given a tracked job has been polled 225+ times, when the next poll cycle runs, then the same expiry behavior occurs
3. Given a page load with expired jobs in localStorage, when `init()` runs, then expired jobs are silently removed without toast
4. Given a job that completes normally within TTL, when it reaches terminal status, then existing toast behavior is preserved unchanged

**Boundaries & Constraints:**
- Expired jobs produce a single `warning`-type toast: "Tiempo de espera agotado para '{filename}'..."
- Expired jobs are removed from `trackedJobs` and from localStorage immediately
- Expiration check runs in `pollStatuses()` before each job's status fetch, and in `init()`
- Cross-tab sync must not re-introduce expired jobs
- No backend changes, no toast component changes, no FileUpload/UploadMaterials/MaterialManager changes

Check each one and return the result for each AC as PASS or FAIL, with explanation.
