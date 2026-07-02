# Edge Case Hunter Review — Issue #126 (sourceMix Telemetry)

You receive the diff AND read access to the project at `/Users/lucasvidmar/Documents/azure-educational-dashboard`.

Review the diff for unhandled edge cases. Walk every branching path and boundary condition.

**Diff:**
```
diff --git a/backend/src/functions/rag-query.js b/backend/src/functions/rag-query.js
index 802c7db..c20574e 100644
--- a/backend/src/functions/rag-query.js
+++ b/backend/src/functions/rag-query.js
@@ -215,6 +215,28 @@ function resolveSelectedClassCount(classIds) {
     return new Set(classIds.filter(id => id && id !== 'all')).size;
 }
 
+function resolveSourceMix(sources) {
+    if (!sources || sources.length === 0) return 'none';
+
+    const types = new Set(sources.map(s => s?.materialType).filter(Boolean));
+    if (types.size === 0) return 'unknown';
+
+    const hasNotes = types.has('notes');
+    const hasBibliography = types.has('bibliography');
+    const hasTranscript = types.has('transcript');
+    const hasPresentation = types.has('presentation');
+    const hasOther = [...types].some(t => !['notes', 'bibliography', 'transcript', 'presentation'].includes(t));
+
+    if (hasNotes && hasBibliography && types.size === 2) return 'notes+bibliography';
+    if (hasNotes && types.size === 1) return 'notes-only';
+    if (hasBibliography && types.size === 1) return 'bibliography-only';
+    if (hasTranscript && types.size === 1) return 'transcript-only';
+    if (hasPresentation && types.size === 1) return 'presentation-only';
+    if (hasOther) return 'mixed-other';
+
+    return 'mixed-other';
+}
+
 function handleErrorResponse(status, message, category, isStream, correlationId) {
     if (isStream) {
         const encoder = new TextEncoder();
@@ -560,6 +582,7 @@ ${contextText}
                             firstTokenAt,
                             filterType,
                             selectedClassCount,
+                            sourceMix: resolveSourceMix(sources),
                         }).catch(err => context.error('[Telemetry] Error emitting RAGInteraction event from stream:', err));
 
 
@@ -639,6 +662,8 @@ ${contextText}
         // Accumulate total tokens for this interaction (embedding + chat)
         const totalInteractionTokens = (embeddingUsage?.total_tokens || 0) + (chatUsage?.total_tokens || 0);
 
+        const sourceMix = resolveSourceMix(matches.map(m => ({ materialType: m.metadata?.materialType })));
+
         trackRAGInteraction({
             userId,
             subjectId,
@@ -650,6 +675,7 @@ ${contextText}
             interactionId: uuidv4(),
             filterType,
             selectedClassCount: resolveSelectedClassCount(classIds),
+            sourceMix,
         }).catch(err => context.error('[Telemetry] Error emitting RAGInteraction event:', err));
 
         // ── 7. Construir respuesta con fuentes ────────────────────
diff --git a/backend/src/services/telemetry.js b/backend/src/services/telemetry.js
index f2a9960..695d266 100644
--- a/backend/src/services/telemetry.js
+++ b/backend/src/services/telemetry.js
@@ -58,6 +58,7 @@ async function getClient() {
  * @param {string} [params.interactionId]   - Unique ID for this chat turn
  * @param {string} [params.firstTokenAt]    - ISO timestamp when first SSE token was emitted
  * @param {number} [params.selectedClassCount] - Number of unique classes selected for context
+ * @param {string} [params.sourceMix] - Classification of material types used in the response (e.g. 'notes+bibliography', 'notes-only', 'mixed-other')
  */
 export async function trackRAGInteraction({
     userId,
@@ -72,6 +73,7 @@ export async function trackRAGInteraction({
     firstTokenAt,
     filterType,
     selectedClassCount,
+    sourceMix,
 }) {
     const client = await getClient();
     if (!client) return;
@@ -85,6 +87,7 @@ export async function trackRAGInteraction({
             interactionId: interactionId || 'unknown',
             firstTokenAt: firstTokenAt || null,
             filterType: filterType || 'unknown',
+            sourceMix: sourceMix || 'unknown',
         },
         measurements: {
             promptTokens: promptTokens || 0,
```

**Context from the project:**
- Material types used: `notes`, `bibliography`, `transcript`, `presentation`, and `verified-answer`
- The `verify-answer` path (lines ~326-381 of rag-query.js) returns a verified answer directly from Pinecone, bypassing `buildHybridContext` entirely. This path also emits `trackRAGInteraction` — check if `sourceMix` is handled there.
- The refusal path (lines ~427-457, no matches found) returns early without reaching the telemetry call sites — sources is empty `[]` but no telemetry is emitted.
- The blocking path builds `sources` AFTER telemetry call — the diff correctly computes from `matches` instead.
- Look at the `matches` array structure: `m.metadata?.materialType` — is this always a string?

Report only unhandled edge cases.
