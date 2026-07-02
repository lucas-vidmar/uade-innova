# Acceptance Auditor — Story 1.3: AI Content Consent

You are an **Acceptance Auditor**. Review this diff against the spec and context docs below. Check for: violations of acceptance criteria, deviations from spec intent, missing implementation of specified behavior, contradictions between spec constraints and actual code.

## Instructions

Output findings as a Markdown list. Each finding must include:
- One-line title
- Which AC/constraint it violates
- Evidence from the diff or spec

## Spec File Content

Found in `_bmad-output/implementation-artifacts/1-3-ai-content-consent.md`:

### Acceptance Criteria

**AC1: Consent Modal on First Chat Use**
- Given I am a newly authenticated student
- When I click "Usar el chat" for the first time (or the chat widget renders for the first time)
- Then a modal appears with:
  - Terms of use text (fetched from Blob Storage: `legal/terms-v1.md`)
  - Checkbox: "Acepto que mis consultas sean procesadas por IA y almacenadas para mejorar el servicio"
  - Button "Continuar" (disabled until checked)

**AC2: Consent Persisted in UserConsent Table**
- PartitionKey=myUserId, RowKey="consent"
- Columns: acceptedAt (ISO 8601), version (e.g., "v1"), ipAddress

**AC3: No Repeat Modal After Acceptance**
- Given I have accepted the terms
- When I return to the platform and access the chat again
- Then the modal does not appear

**AC4: Terms Fetched from Blob Storage**
- System fetches `legal/terms-v1.md` from Blob Storage (container: `legal`)
- Renders the Markdown content as HTML in the modal body

**AC5: Teachers and Directors Exempt**
- AI content consent modal does NOT appear
- No UserConsent record is required

**AC6: Backend Consent Check on RAG Query**
- Student without consent → 403 Forbidden with error code `CONSENT_REQUIRED`
- Message: "Debés aceptar los términos de uso antes de usar el chat."

### Architecture Constraints (from spec)
- **Frontend:** Vanilla JS + Vite, component pattern, CSS variables from Design System
- **Backend:** Node.js 20, Azure Functions v4, ESM modules
- **Storage:** Azure Table Storage for UserConsent, Azure Blob Storage for legal/terms-v1.md
- **API responses:** `{ success, data, error, meta }` format with `error.code` in UPPER_SNAKE_CASE
- **Error handling:** `context.log()` with `userId`/`subjectId` context in every catch block
- **Table Storage schema:** PartitionKey=userId, RowKey=consent, columns: acceptedAt (ISO 8601), version, ipAddress
- **Auth:** API Keys via env vars, no Managed Identities
- **Blob Storage fetch:** Use existing `downloadFile('legal', 'terms-v1.md')` from `backend/src/services/storage.js`
- **Table Storage:** Use existing `getTableClient('UserConsent')` from `backend/src/services/storage.js`
- **Markdown rendering:** Render raw markdown as HTML in frontend (simple approach — no full markdown parser needed for MVP)

### UX Constraints (from spec)
- Modal style: Glassmorphism-inspired, dark-first
- Typography: Montserrat
- Button: Primary variant, disabled state with reduced opacity
- Checkbox: Custom styled, `--color-accent` when checked
- Animation: Modal entrance: scale 0.95 + opacity fade (0.2s cubic-bezier)
- Responsive: Max-width 640px on desktop, full-width on mobile

### Security Constraints (from spec)
- Frontend-only guards can be bypassed — the rag-query backend MUST enforce consent for students
- No PII in logs (do not log ipAddress)
- Terms immutability: Once terms-v1.md is uploaded, do not overwrite it

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

diff --git a/backend/src/index.js b/backend/src/index.js
--- a/backend/src/index.js
+++ b/backend/src/index.js
@@ -22,3 +22,4 @@
+import './functions/consent-api.js';

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

diff --git a/frontend/public/staticwebapp.config.json b/frontend/public/staticwebapp.config.json
--- a/frontend/public/staticwebapp.config.json
+++ b/frontend/public/staticwebapp.config.json
@@ -9,6 +9,7 @@
   "auth": {
+    "identityProviders": {},
     "rolesSource": "/api/get-roles?code=UADE-Pilot-Secure-Roles-Secret-2026"
   }
 }

diff --git a/frontend/src/components/ChatWidget.js b/frontend/src/components/ChatWidget.js
--- a/frontend/src/components/ChatWidget.js
+++ b/frontend/src/components/ChatWidget.js
@@ -5,6 +5,7 @@
+import { renderPrivacyModal } from './PrivacyModal.js';
@@ -18,9 +19,35 @@
+  if (auth.getRole() === 'student' && !auth.getAIConsentAccepted()) {
+    container.innerHTML = `...blocking UI...`;
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
     ...
     modalOverlay.innerHTML = `...terms header, checkbox, disabled continue button...`;
+    checkbox.addEventListener('change', () => {
+        continueBtn.disabled = !checkbox.checked;
+    });
+    continueBtn.addEventListener('click', async () => {
+        const success = await auth.acceptAIConsent();
+        if (success) { ...close modal... }
+        else { ...re-enable button, show toast... }
+    });
+    try {
+        const terms = await api.getTerms();
+        if (terms && terms.content) {
+            termsContent.innerHTML = renderMarkdown(terms.content);
+        }
+    } catch (err) { ...error message... }
+}
+function renderMarkdown(text) { ...simple md to html... }

diff --git a/frontend/src/main.js b/frontend/src/main.js
--- a/frontend/src/main.js
+++ b/frontend/src/main.js
@@ -5,7 +5,6 @@
-import { renderPrivacyModal } from './components/PrivacyModal.js';
@@ -120,11 +119,6 @@
-    if (!auth.getConsentAccepted()) {
-        renderPrivacyModal();
-    }

diff --git a/frontend/src/services/api.js b/frontend/src/services/api.js
--- a/frontend/src/services/api.js
+++ b/frontend/src/services/api.js
@@ -1515,19 +1515,71 @@
+    async getTerms() { ... },
+    async getConsent() { ... },
+    async saveConsent() { ... },

diff --git a/frontend/src/services/auth.js b/frontend/src/services/auth.js
--- a/frontend/src/services/auth.js
+++ b/frontend/src/services/auth.js
@@ -4,6 +4,8 @@
+const AI_CONSENT_KEY = 'edu_ai_consent_accepted';
@@ -94,6 +96,28 @@
+    getAIConsentAccepted() {
+        return localStorage.getItem(AI_CONSENT_KEY) === 'true' || sessionStorage.getItem(AI_CONSENT_KEY) === 'true';
+    },
+    async acceptAIConsent() { ... },
     async acceptPrivacyPolicy() { ... },
@@ -259,6 +283,18 @@
+        // Sync AI consent from backend
+        try {
+            const consent = await api.getConsent();
+            if (consent) {
+                const accepted = consent.accepted ? 'true' : 'false';
+                sessionStorage.setItem(AI_CONSENT_KEY, accepted);
+                localStorage.setItem(AI_CONSENT_KEY, accepted);
+            }
+        } catch (err) { ... }

diff --git a/infra/modules/storage.bicep b/infra/modules/storage.bicep
--- a/infra/modules/storage.bicep
+++ b/infra/modules/storage.bicep
@@ -167,6 +167,12 @@
+resource userConsentTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
+  parent: tableService
+  name: 'UserConsent'
+}
```

## New Files

### backend/src/functions/consent-api.js
- GET /api/consent — reads UserConsent table for current user
- POST /api/consent — upserts UserConsent record with acceptedAt, version, ipAddress
- GET /api/terms — fetches legal/terms-v1.md from Blob Storage
- Both endpoints validateFrontDoorId()
- Fallback userId: principal?.oid || request.headers.get('x-edu-uid') || 'pilot-user'

### backend/src/functions/consent-api.test.js
- 5 tests: GET new user, POST+GET, POST create, GET terms, duplicate POST
- Uses node:test mock module

### legal/terms-v1.md
- 6 sections: Info Recopilada, IA Generativa, Almacenamiento, Derechos, Seguridad, Contacto
- References Argentine Data Protection Law 25.326
