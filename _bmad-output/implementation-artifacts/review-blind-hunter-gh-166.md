# Blind Hunter Review — SAT Significance Guardrails

You are a **Blind Hunter** reviewer. You have NO context about the project, the spec, or the codebase. You receive only the diff below.

Your mission: review this diff adversarially. Look for:
- Logic errors, off-by-one, edge cases
- Security vulnerabilities (injection, data leaks, auth bypass)
- Race conditions, concurrency issues
- Error handling gaps
- Any code smell

Return findings as a numbered list. For each finding include: severity (critical/high/medium/low), the file and line, and what's wrong.

---

```
diff --git a/backend/src/services/significance.js b/backend/src/services/significance.js
new file mode 100644
index 0000000..c59ffad
--- /dev/null
+++ b/backend/src/services/significance.js
@@ -0,0 +1,76 @@
+const DEFAULT_MIN_RATED = 10;
+const DEFAULT_ALPHA = 0.05;
+
+function normalCdf(x) {
+  const a1 = 0.254829592;
+  const a2 = -0.284496736;
+  const a3 = 1.421413741;
+  const a4 = -1.453152027;
+  const a5 = 1.061405429;
+  const p = 0.3275911;
+
+  const sign = x < 0 ? -1 : 1;
+  x = Math.abs(x);
+
+  const t = 1 / (1 + p * x);
+  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
+
+  return 0.5 * (1 + sign * y);
+}
+
+function twoProportionZTest(positive1, n1, positive2, n2) {
+  if (n1 === 0 || n2 === 0) return { z: 0, pValue: 1 };
+
+  const p1 = positive1 / n1;
+  const p2 = positive2 / n2;
+  const pHat = (positive1 + positive2) / (n1 + n2);
+
+  if (pHat === 0 || pHat === 1) return { z: 0, pValue: 1 };
+
+  const se = Math.sqrt(pHat * (1 - pHat) * (1 / n1 + 1 / n2));
+  if (se === 0) return { z: 0, pValue: 1 };
+
+  const z = (p1 - p2) / se;
+  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
+
+  return { z, pValue };
+}
+
+export function computeWinner(segments, minRatedThreshold = DEFAULT_MIN_RATED) {
+  if (!segments || segments.length === 0) {
+    return { state: 'insufficient_data', reason: 'no_data' };
+  }
+
+  if (segments.length === 1) {
+    return segments[0].rated >= minRatedThreshold
+      ? { state: 'insufficient_data', reason: 'single_segment' }
+      : { state: 'insufficient_data', reason: 'insufficient_data_both' };
+  }
+
+  const contenders = segments
+    .filter(s => s.rated >= minRatedThreshold && s.positive >= 0)
+    .sort((a, b) => (b.satScore || 0) - (a.satScore || 0));
+
+  if (contenders.length < 2) {
+    return { state: 'insufficient_data', reason: 'insufficient_data_both' };
+  }
+
+  const best = contenders[0];
+  const second = contenders[1];
+
+  if (best.satScore === second.satScore) {
+    return { state: 'tie' };
+  }
+
+  const { pValue } = twoProportionZTest(best.positive, best.rated, second.positive, second.rated);
+
+  if (pValue < DEFAULT_ALPHA) {
+    return {
+      state: 'declared',
+      winnerPromptVersion: best.promptVersion,
+      pValue: Math.round(pValue * 10000) / 10000,
+    };
+  }
+
+  return { state: 'insufficient_data', reason: 'insufficient_data_not_significant', pValue: Math.round(pValue * 10000) / 10000 };
+}
```

And the modifications to existing files:

```diff
diff --git a/backend/src/functions/sat-analytics.js b/backend/src/functions/sat-analytics.js
index 7435b7a..8ff31ea 100644
--- a/backend/src/functions/sat-analytics.js
+++ b/backend/src/functions/sat-analytics.js
@@ -1,6 +1,7 @@
 import { validateFrontDoorId, parseClientPrincipal, getAuthenticatedUser } from '../services/auth-utils.js';
 import { getEnrollment, RATINGS_TABLE } from '../services/state-store.js';
 import { getTableClient } from '../services/storage.js';
+import { computeWinner } from '../services/significance.js';
 import { app } from '@azure/functions';
 
 app.http('get-sat-analytics', {
@@ -66,10 +67,13 @@ app.http('get-sat-analytics', {
                 seg.satScore = seg.rated > 0 ? Math.round((seg.positive / seg.rated) * 100) / 100 : 0;
             }
 
+            const minRated = Number(process.env.SAT_MIN_RATED_THRESHOLD) || 10;
+            const winner = computeWinner(resultArray, minRated);
+
             return {
                 status: 200,
                 headers: { 'Content-Type': 'application/json' },
-                body: JSON.stringify({ segments: resultArray, total: entities.length, filter: { subjectId, classId: classId || null, windowDays: days } }),
+                body: JSON.stringify({ segments: resultArray, total: entities.length, filter: { subjectId, classId: classId || null, windowDays: days }, winner }),
             };
         } catch (err) {
             context.error(`[sat-analytics] Error subjectId=${subjectId} classId=${classId || 'none'}:`, err);
diff --git a/backend/src/services/telemetry.js b/backend/src/services/telemetry.js
index 25070fe..1a645c0 100644
--- a/backend/src/services/telemetry.js
+++ b/backend/src/services/telemetry.js
@@ -59,8 +59,9 @@ async function getClient() {
  * @param {string} [params.interactionId]   - Unique ID for this chat turn
  * @param {string} [params.firstTokenAt]    - ISO timestamp when first SSE token was emitted
  * @param {number} [params.selectedClassCount] - Number of unique classes selected for context
- * @param {string} [params.sourceMix] - Classification of material types used in the response (e.g. 'notes+bibliography', 'notes-only', 'mixed-other')
+ * @param {string} [params.sourceMix] - Classification of material types used in the response (e.g. 'notes+bibliography', 'notes-only', 'bibliography-only', 'transcript-only', 'presentation-only', 'mixed-other', 'none', 'unknown')
  * @param {string} [params.correlationId] - Trace correlation ID for joining with request telemetry in KQL
+ * @param {string} [params.winnerDeclared] - Prompt version declared as winner (null if none)
  */
 export async function trackRAGInteraction({
     userId,
@@ -78,6 +79,7 @@ export async function trackRAGInteraction({
     selectedClassCount,
     sourceMix,
     correlationId,
+    winnerDeclared,
 }) {
     const client = await getClient();
     if (!client) return;
@@ -93,6 +95,7 @@ export async function trackRAGInteraction({
             filterType: filterType || 'unknown',
             sourceMix: sourceMix || 'unknown',
             ...(correlationId && { correlationId }),
+            ...(winnerDeclared && { winnerDeclared }),
         },
         measurements: {
             promptTokens: promptTokens || 0,
diff --git a/frontend/src/pages/director/SatAnalytics.js b/frontend/src/pages/director/SatAnalytics.js
index 1de1876..c405704 100644
--- a/frontend/src/pages/director/SatAnalytics.js
+++ b/frontend/src/pages/director/SatAnalytics.js
@@ -89,11 +89,19 @@ export async function renderDirectorSatAnalytics(container) {
               <th>Positivas</th>
               <th>SAT Score</th>
               <th>Barra</th>
+              <th>Ganador</th>
             </tr>
           </thead>
           <tbody>
             ${segments.map(s => {
       const pct = Math.max(0, Math.min(100, Math.round((s.satScore || 0) * 100)));
+      const w = satData?.winner || { state: 'insufficient_data' };
+      const isWinner = w.state === 'declared' && w.winnerPromptVersion === s.promptVersion;
+      const badge = isWinner
+        ? '<span class="badge badge-success" style="font-size:0.8rem">✓ Ganador</span>'
+        : w.state === 'tie'
+          ? '<span class="badge badge-warning" style="font-size:0.8rem">Empate</span>'
+          : '<span class="badge badge-secondary" style="font-size:0.8rem">Insuficiente</span>';
       return `
               <tr>
                 <td><code>${esc(s.promptVersion)}</code></td>
@@ -105,6 +113,7 @@ export async function renderDirectorSatAnalytics(container) {
                     <div class="progress-fill" style="--progress-value:${pct}%;background:var(--color-success)"></div>
                   </div>
                 </td>
+                <td>${badge}</td>
               </tr>
             `;
     }).join('')}
@@ -141,7 +150,7 @@ export async function renderDirectorSatAnalytics(container) {
       container.querySelector('#sat-segments-card').innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Filtrando...</div>`;
       try {
         const result = await api.getSatAnalytics({ subjectId: activeSubjectId, classId: selectedClassId, days: selectedDays });
-        renderSegmentsTable(container, result.segments || [], result.total || 0);
+        renderSegmentsTable(container, result.segments || [], result.total || 0, result.winner);
       } catch (err) {
         console.error('[SAT] Error filtering:', err);
         container.querySelector('#sat-segments-card').innerHTML = `<div class="empty-state" style="padding:20px">Error al filtrar datos SAT.</div>`;
@@ -160,7 +169,8 @@ export async function renderDirectorSatAnalytics(container) {
   }
 }
 
-function renderSegmentsTable(container, segments, total) {
+function renderSegmentsTable(container, segments, total, winner) {
+  const w = winner || { state: 'insufficient_data' };
   const card = container.querySelector('#sat-segments-card');
   if (!card) return;
 
@@ -199,11 +209,18 @@ function renderSegmentsTable(container, segments, total) {
             <th>Positivas</th>
             <th>SAT Score</th>
             <th>Barra</th>
+            <th>Ganador</th>
           </tr>
         </thead>
         <tbody>
           ${segments.map(s => {
     const pct = Math.max(0, Math.min(100, Math.round((s.satScore || 0) * 100)));
+    const isWinner = w.state === 'declared' && w.winnerPromptVersion === s.promptVersion;
+    const badge = isWinner
+      ? '<span class="badge badge-success" style="font-size:0.8rem">✓ Ganador</span>'
+      : w.state === 'tie'
+        ? '<span class="badge badge-warning" style="font-size:0.8rem">Empate</span>'
+        : '<span class="badge badge-secondary" style="font-size:0.8rem">Insuficiente</span>';
     return `
             <tr>
               <td><code>${esc(s.promptVersion)}</code></td>
@@ -215,6 +232,7 @@ function renderSegmentsTable(container, segments, total) {
                   <div class="progress-fill" style="--progress-value:${pct}%;background:var(--color-success)"></div>
                 </div>
               </td>
+              <td>${badge}</td>
             </tr>
           `;
   }).join('')}
diff --git a/frontend/src/services/api.js b/frontend/src/services/api.js
index 75feed4..5c5f598 100644
--- a/frontend/src/services/api.js
+++ b/frontend/src/services/api.js
@@ -1689,7 +1689,12 @@ export const api = {
                     { promptVersion: 'v2', rated: 8, positive: 7, satScore: 0.875 },
                 ];
                 const filtered = classId ? segments.filter(() => false) : [];
-                return { segments: filtered, total: filtered.reduce((s, x) => s + x.rated, 0), filter: { subjectId, classId: classId || null, windowDays: days || 30 } };
+                return {
+                    segments: filtered,
+                    total: filtered.reduce((s, x) => s + x.rated, 0),
+                    filter: { subjectId, classId: classId || null, windowDays: days || 30 },
+                    winner: { state: 'insufficient_data', reason: 'insufficient_data_both' },
+                };
             }
             let url = `${BASE_URL}/sat-analytics?subjectId=${encodeURIComponent(subjectId)}`;
             if (classId) url += `&classId=${encodeURIComponent(classId)}`;
```
