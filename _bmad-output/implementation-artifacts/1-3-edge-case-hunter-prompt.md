# Edge Case Hunter — Story 1.3: AI Content Consent

You are a **pure path tracer**. Walk every branching path and boundary condition within the diff scope. Report ONLY paths and conditions that lack handling. Do NOT comment on whether code is good or bad.

You have the diff below AND read access to the project at `/Users/lucasvidmar/Documents/azure-educational-dashboard`.

## Instructions

1. Scan the diff hunks below.
2. List boundaries that are directly reachable from the changed lines and lack an explicit guard in the diff.
3. Walk all branching paths: control flow (conditionals, loops, error handlers, early returns) and domain boundaries (null/empty inputs, race conditions, timeout gaps, implicit type coercion, off-by-one).
4. Output findings as a JSON array following this format exactly:

```json
[{
  "location": "file:start-end (or file:line when single line, or file:hunk when exact line unavailable)",
  "trigger_condition": "one-line description (max 15 words)",
  "guard_snippet": "minimal code sketch that closes the gap (single-line escaped string, no raw newlines or unescaped quotes)",
  "potential_consequence": "what could actually go wrong (max 15 words)"
}]
```

No extra text, no explanations, no markdown wrapping. An empty array `[]` is valid.

## Diff to Review

```diff
diff --git a/backend/src/functions/rag-query.js b/backend/src/functions/rag-query.js
--- a/backend/src/functions/rag-query.js
+++ b/backend/src/functions/rag-query.js
@@ -13,7 +13,7 @@
-import { getEnrollment } from '../services/state-store.js';
+import { getEnrollment, getConsentStatus } from '../services/state-store.js';
@@ -282,6 +282,18 @@
+        if (!isTeacherOrDirector) {
+            const consentAccepted = await getConsentStatus(userId).catch(() => false);
+            if (!consentAccepted) {
+                context.log(`[Consent] Consent required: userId=${userId}`);
+                return jsonResponse(403, {
+                    error: 'CONSENT_REQUIRED',
+                    message: 'Debés aceptar los términos de uso antes de usar el chat.',
+                }, correlationId);
+            }
+        }

diff --git a/backend/src/services/state-store.js b/backend/src/services/state-store.js
--- a/backend/src/services/state-store.js
+++ b/backend/src/services/state-store.js
@@ -299,6 +299,19 @@
+export async function getConsentStatus(userId) {
+  if (!userId) return false;
+  const table = 'UserConsent';
+  await ensureTable(table);
+  const client = getTableClient(table);
+  try {
+    const entity = await client.getEntity(userId, 'consent');
+    return entity?.acceptedAt ? true : false;
+  } catch {
+    return false;
+  }
+}

diff --git a/frontend/src/components/ChatWidget.js b/frontend/src/components/ChatWidget.js
--- a/frontend/src/components/ChatWidget.js
+++ b/frontend/src/components/ChatWidget.js
@@ -18,9 +19,35 @@
+  if (auth.getRole() === 'student' && !auth.getAIConsentAccepted()) {
+    container.innerHTML = `...`;
+    container.querySelector('#open-consent-modal-btn')?.addEventListener('click', () => {
+      renderPrivacyModal(() => {
+        if (auth.getAIConsentAccepted()) {
+          location.reload();
+        }
+      });
+    });
+    return container;
+  }

diff --git a/frontend/src/components/PrivacyModal.js b/frontend/src/components/PrivacyModal.js
--- a/frontend/src/components/PrivacyModal.js
+++ b/frontend/src/components/PrivacyModal.js
@@ -1,83 +1,81 @@
-export function renderPrivacyModal() {
+export async function renderPrivacyModal(container) {
-    if (auth.getConsentAccepted()) return;
+    if (auth.getAIConsentAccepted()) return;
     if (document.getElementById('privacy-modal')) return;
     ...
     modalOverlay.innerHTML = `...`;
     document.body.appendChild(modalOverlay);
+    checkbox.addEventListener('change', () => {
+        continueBtn.disabled = !checkbox.checked;
+    });
+    continueBtn.addEventListener('click', async () => {
+        continueBtn.disabled = true;
+        continueBtn.innerHTML = 'Procesando...';
+        const success = await auth.acceptAIConsent();
+        if (success) {
+            modalOverlay.classList.replace('animate-in', 'animate-out');
+            setTimeout(() => {
+                modalOverlay.remove();
+                document.body.style.overflow = '';
+                if (container && typeof container === 'function') {
+                    container();
+                }
+            }, 300);
+        } else {
+            continueBtn.disabled = false;
+            continueBtn.innerHTML = 'Continuar';
+            toast('error', 'Error', 'Hubo un problema al guardar su preferencia. Reintente.');
+        }
+    });
     document.body.style.overflow = 'hidden';
     ...
+    try {
+        const terms = await api.getTerms();
+        ...
+    } catch (err) {
+        ...
+    }
+}

diff --git a/frontend/src/services/api.js b/frontend/src/services/api.js
--- a/frontend/src/services/api.js
+++ b/frontend/src/services/api.js
@@ -1515,19 +1515,71 @@
+    async getTerms() {
+            if (USE_MOCK) { ... }
+            try {
+                const res = await apiFetch(`${BASE_URL}/terms`);
+                if (!res.ok) return null;
+                ...
+            } catch (err) { ... }
+        },
+    async getConsent() { ... },
+    async saveConsent() { ... },

diff --git a/frontend/src/services/auth.js b/frontend/src/services/auth.js
--- a/frontend/src/services/auth.js
+++ b/frontend/src/services/auth.js
@@ -94,6 +96,28 @@
+    getAIConsentAccepted() {
+        return localStorage.getItem(AI_CONSENT_KEY) === 'true' || sessionStorage.getItem(AI_CONSENT_KEY) === 'true';
+    },
+    async acceptAIConsent() {
+        try {
+            await api.saveConsent();
+            localStorage.setItem(AI_CONSENT_KEY, 'true');
+            sessionStorage.setItem(AI_CONSENT_KEY, 'true');
+            window.dispatchEvent(new CustomEvent('auth:aiConsentAccepted'));
+            return true;
+        } catch (err) {
+            ...
+            if (window.location.hostname === 'localhost') {
+                localStorage.setItem(AI_CONSENT_KEY, 'true');
+                sessionStorage.setItem(AI_CONSENT_KEY, 'true');
+                return true;
+            }
+            return false;
+        }
+    },

diff --git a/backend/src/functions/consent-api.js b/backend/src/functions/consent-api.js
new file mode 100644
--- /dev/null
+++ b/backend/src/functions/consent-api.js
@@ -0,0 +1,151 @@
+async function ensureConsentTable() {
+    const client = getTableClient(CONSENT_TABLE);
+    try {
+        await client.createTable();
+    } catch (err) {
+        if (err.statusCode !== 409) throw err;
+    }
+}
+
+app.http('consent-get', {
+    ...
+    handler: async (request, context) => {
+        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' }, correlationId);
+        const principal = parseClientPrincipal(request);
+        const userId = principal?.oid || request.headers.get('x-edu-uid') || 'pilot-user';
+        ...
+    },
+});
+
+app.http('consent-post', {
+    ...
+    handler: async (request, context) => {
+        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' }, correlationId);
+        const principal = parseClientPrincipal(request);
+        const userId = principal?.oid || request.headers.get('x-edu-uid') || 'pilot-user';
+        const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-azure-client-ip') || '';
+        ...
+        await ensureConsentTable();
+        const client = getTableClient(CONSENT_TABLE);
+        const entity = {
+            partitionKey: userId,
+            rowKey: 'consent',
+            acceptedAt: new Date().toISOString(),
+            version: 'v1',
+            ipAddress,
+        };
+        await client.upsertEntity(entity, 'Replace');
+    },
+});
+
+app.http('terms-get', {
+    ...
+    handler: async (request, context) => {
+        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' }, correlationId);
+        const content = await downloadFile(LEGAL_CONTAINER, 'terms-v1.md');
+        const text = content.toString('utf-8');
+        ...
+    },
+});
```
