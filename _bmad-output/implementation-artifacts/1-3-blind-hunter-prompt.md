# Blind Hunter Review — Story 1.3: AI Content Consent

You are a **Cynical Adversarial Reviewer**. You receive ONLY the diff below. No spec, no project context, no acceptance criteria. You have been told the author is clueless — find at least ten issues.

## Instructions

Review the diff with extreme skepticism. Assume problems exist. Focus on:
- Security vulnerabilities
- Logic errors
- Race conditions
- Missing error handling
- Inconsistent patterns
- Code smells
- Performance issues
- Architectural violations visible in the diff

Output findings as a Markdown list. Each finding should have a one-line title and a brief description. No filler.

## Diff to Review

```diff
diff --git a/backend/src/functions/rag-query.js b/backend/src/functions/rag-query.js
index 02f0c27..af9af19 100644
--- a/backend/src/functions/rag-query.js
+++ b/backend/src/functions/rag-query.js
@@ -13,7 +13,7 @@ import { normalizeCategorizedError, ErrorCategory } from '../services/error-cate
 import { resolveCorrelationId, buildDependencyHeaders, withCorrelationResponseHeaders } from '../services/correlation.js';
 import { v4 as uuidv4 } from 'uuid';
 import { listMaterialsBySubject } from '../services/state-store.js';
-import { getEnrollment } from '../services/state-store.js';
+import { getEnrollment, getConsentStatus } from '../services/state-store.js';
 import { getMaterialPriority } from '../services/material-classification.js';
 const MAX_RAG_CHUNKS = 4;
 const RETRIEVAL_CANDIDATES = 10;
@@ -282,6 +282,18 @@ app.http('rag-query', {
             }
         }
 
+        // ── 1c. AI content consent check ────────────────────────────────
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
+
         const rewrittenQuestion = await rewriteQuestionWithHistory(question, recentConversationHistory, context);
 
         context.log(`Pregunta: "${question}" | Reescrita: "${rewrittenQuestion}" | Materia: ${subjectId} | Clases: ${classIds?.join(',') || 'todas'} | Session: ${sessionId || 'auto'}`);
diff --git a/backend/src/index.js b/backend/src/index.js
index ef55ce5..85d3a36 100644
--- a/backend/src/index.js
+++ b/backend/src/index.js
@@ -22,3 +22,4 @@ import './functions/process-material.js';
 import './functions/rag-query.js';
 import './functions/post-class-summary-dispatcher.js';
 import './functions/deadline-proximity-dispatcher.js';
+import './functions/consent-api.js';
diff --git a/backend/src/services/state-store.js b/backend/src/services/state-store.js
index ab100da..1cf43ab 100644
--- a/backend/src/services/state-store.js
+++ b/backend/src/services/state-store.js
@@ -299,6 +299,19 @@ export async function upsertEnrollment(enrollment) {
   return fromEnrollmentEntity(entity);
 }
 
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
+
 export async function deleteEnrollment(subjectId, userId) {
   if (!subjectId || !userId) return false;
   await ensureTable(ENROLLMENTS_TABLE);
diff --git a/frontend/public/staticwebapp.config.json b/frontend/public/staticwebapp.config.json
index 98dad20..3bdb970 100644
--- a/frontend/public/staticwebapp.config.json
+++ b/frontend/public/staticwebapp.config.json
@@ -9,6 +9,7 @@
     }
   ],
   "auth": {
+    "identityProviders": {},
     "rolesSource": "/api/get-roles?code=UADE-Pilot-Secure-Roles-Secret-2026"
   }
 }
diff --git a/frontend/src/components/ChatWidget.js b/frontend/src/components/ChatWidget.js
index 370997b..5640db2 100644
--- a/frontend/src/components/ChatWidget.js
+++ b/frontend/src/components/ChatWidget.js
@@ -5,6 +5,7 @@ import { api } from '../services/api.js';
 import { auth } from '../services/auth.js';
 import { showPromptDialog } from './Dialog.js';
 import { toast } from './Toast.js';
+import { renderPrivacyModal } from './PrivacyModal.js';
 
 const FOLLOW_UP_HISTORY_WINDOW_SIZE = 4;
 
@@ -18,9 +19,35 @@ export function createChatWidget({ classes = [], subjectId = '', sessionId = nul
   let transcriptFocus = initialTranscriptFocus;
 
   const container = document.createElement('div');
-  container.className = 'chat-container-card'; // Use the new design system class
+  container.className = 'chat-container-card';
   container.style.height = '100%';
 
+  // Consent gate for students: block chat rendering and show modal
+  if (auth.getRole() === 'student' && !auth.getAIConsentAccepted()) {
+    container.innerHTML = `
+      <div class="flex items-center justify-center h-full p-6">
+        <div class="text-center max-w-md">
+          <div class="mb-4 text-primary">
+            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto">
+              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
+            </svg>
+          </div>
+          <h3 class="text-lg font-bold text-text-primary mb-2">Aceptá los términos para usar el chat</h3>
+          <p class="text-sm text-text-secondary mb-4">Para poder consultar los materiales de clase, necesitás aceptar los términos de uso y consentimiento de IA.</p>
+          <button id="open-consent-modal-btn" class="btn btn-primary">Aceptar términos</button>
+        </div>
+      </div>
+    `;
+    container.querySelector('#open-consent-modal-btn')?.addEventListener('click', () => {
+      renderPrivacyModal(() => {
+        if (auth.getAIConsentAccepted()) {
+          location.reload();
+        }
+      });
+    });
+    return container;
+  }
+
   const render = () => {
     container.innerHTML = `
       <!-- Class selector -->
diff --git a/frontend/src/components/PrivacyModal.js b/frontend/src/components/PrivacyModal.js
index cd7dd5b..cc51686 100644
--- a/frontend/src/components/PrivacyModal.js
+++ b/frontend/src/components/PrivacyModal.js
@@ -1,83 +1,81 @@
 /* ============================================================
-   PrivacyModal.js — Institutional Data Privacy Modal
+   PrivacyModal.js — AI Content Consent Modal
+   Terms fetched from Blob Storage, checkbox and continue button.
    ============================================================ */
 import { auth } from '../services/auth.js';
+import { api } from '../services/api.js';
 import { toast } from './Toast.js';
 
-/**
- * Renders and manages the Privacy Policy modal.
- * This is a blocking modal that only disappears when the user clicks "Accept".
- */
-export function renderPrivacyModal() {
-    // If already accepted, do nothing
-    if (auth.getConsentAccepted()) return;
-
-    // Check if modal already exists
+export async function renderPrivacyModal(container) {
+    if (auth.getAIConsentAccepted()) return;
     if (document.getElementById('privacy-modal')) return;
 
     const modalOverlay = document.createElement('div');
     modalOverlay.id = 'privacy-modal';
     modalOverlay.className = 'modal-overlay';
-    modalOverlay.style.zIndex = '9999'; // Ensure it's on top of everything
+    modalOverlay.style.zIndex = '9999';
 
     modalOverlay.innerHTML = `
-        <div class="modal-content animate-in">
+        <div class="modal-content animate-in" style="max-width: 640px;">
             <div class="modal-header">
                 <h2 class="h3" style="margin: 0; display: flex; align-items: center; gap: var(--space-2);">
-                    <span>⚖️</span> Política de Privacidad de Datos
+                    Términos de uso
                 </h2>
             </div>
             
-            <div class="modal-body" style="overflow-y: auto; max-height: 60vh;">
-                <p><strong>Bienvenido a UADE Innova.</strong></p>
-                <p>Para continuar utilizando este dashboard educativo inteligente, es necesario que acepte el tratamiento de sus datos académicos conforme a nuestra política institucional.</p>
-                
-                <h3 class="h4" style="margin-top: var(--space-4);">1. Información Recopilada</h3>
-                <p>Procesamos información sobre su cursada, incluyendo materiales de clase (transcripciones, presentaciones), tareas y actividades en el chat RAG para personalizar su experiencia de aprendizaje.</p>
-                
-                <h3 class="h4" style="margin-top: var(--space-4);">2. Uso de IA Generativa</h3>
-                <p>Utilizamos modelos de Azure OpenAI para generar resúmenes y responder consultas. Sus datos están protegidos bajo protocolos de seguridad de nivel empresarial (Zero-Trust) y no se utilizan para entrenar modelos públicos externos.</p>
-                
-                <h3 class="h4" style="margin-top: var(--space-4);">3. Sus Derechos</h3>
-                <p>Usted mantiene el derecho de acceso, rectificación y eliminación de sus datos personales conforme a las normativas vigentes en la República Argentina y las políticas internas de UADE.</p>
+            <div class="modal-body" style="overflow-y: auto; max-height: 50vh;">
+                <div id="terms-content" class="p-4 text-text-secondary text-sm">
+                    <div class="animate-pulse">Cargando términos...</div>
+                </div>
                 
-                <div class="alert alert-info" style="margin-top: var(--space-4);">
-                    <p style="margin: 0; font-size: 0.9rem;">Al hacer clic en "Aceptar y Continuar", usted confirma que ha leído y acepta los términos anteriores.</p>
+                <div class="mt-4 p-3 bg-surface-2 rounded-xl border border-border">
+                    <label class="flex items-start gap-3 cursor-pointer">
+                        <input type="checkbox" id="consent-checkbox" class="mt-1" style="accent-color: var(--color-accent);">
+                        <span class="text-sm font-medium text-text-primary">
+                            Acepto que mis consultas sean procesadas por IA y almacenadas para mejorar el servicio
+                        </span>
+                    </label>
                 </div>
             </div>
             
             <div class="modal-footer">
-                <button id="privacy-accept-btn" class="btn btn-primary btn-lg">Aceptar y Continuar</button>
+                <button id="consent-continue-btn" class="btn btn-primary btn-lg" disabled>Continuar</button>
             </div>
         </div>
     `;
 
     document.body.appendChild(modalOverlay);
 
-    // Interaction logic
-    const acceptBtn = document.getElementById('privacy-accept-btn');
-    acceptBtn.addEventListener('click', async () => {
-        acceptBtn.disabled = true;
-        acceptBtn.innerHTML = 'Procesando...';
-        
-        const success = await auth.acceptPrivacyPolicy();
-        if (success || window.location.hostname === 'localhost') {
-            if (!success) console.warn('[PrivacyModal] Failed to save consent to API, but continuing in local mode.');
+    const checkbox = document.getElementById('consent-checkbox');
+    const continueBtn = document.getElementById('consent-continue-btn');
+    const termsContent = document.getElementById('terms-content');
+
+    checkbox.addEventListener('change', () => {
+        continueBtn.disabled = !checkbox.checked;
+    });
+
+    continueBtn.addEventListener('click', async () => {
+        continueBtn.disabled = true;
+        continueBtn.innerHTML = 'Procesando...';
+
+        const success = await auth.acceptAIConsent();
+        if (success) {
             modalOverlay.classList.replace('animate-in', 'animate-out');
             setTimeout(() => {
                 modalOverlay.remove();
+                document.body.style.overflow = '';
+                if (container && typeof container === 'function') {
+                    container();
+                }
             }, 300);
         } else {
-            acceptBtn.disabled = false;
-            acceptBtn.innerHTML = 'Aceptar y Continuar';
+            continueBtn.disabled = false;
+            continueBtn.innerHTML = 'Continuar';
             toast('error', 'Error', 'Hubo un problema al guardar su preferencia. Reintente.');
         }
     });
 
-    // Disable background scrolling while modal is open
     document.body.style.overflow = 'hidden';
-    
-    // Clean up scroll on remove
     const observer = new MutationObserver((mutations) => {
         mutations.forEach((mutation) => {
             mutation.removedNodes.forEach((node) => {
@@ -89,4 +87,35 @@ export function renderPrivacyModal() {
         });
     });
     observer.observe(document.body, { childList: true });
+
+    // Fetch terms from backend
+    try {
+        const terms = await api.getTerms();
+        if (terms && terms.content) {
+            termsContent.innerHTML = renderMarkdown(terms.content);
+        } else {
+            termsContent.innerHTML = '<p class="text-text-muted italic">No se pudieron cargar los términos. Intente nuevamente.</p>';
+        }
+    } catch (err) {
+        console.error('[PrivacyModal] Error fetching terms:', err);
+        termsContent.innerHTML = '<p class="text-text-muted italic">Error al cargar los términos de uso.</p>';
+    }
+}
+
+function renderMarkdown(text) {
+    if (!text) return '';
+    let html = text
+        .replace(/&/g, '&amp;')
+        .replace(/</g, '&lt;')
+        .replace(/>/g, '&gt;')
+        .replace(/^### (.+)$/gm, '<h3 class="h4 mt-3">$1</h3>')
+        .replace(/^## (.+)$/gm, '<h2 class="h3 mt-4">$1</h2>')
+        .replace(/^# (.+)$/gm, '<h2 class="h3 mt-4">$1</h2>')
+        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
+        .replace(/\*(.+?)\*/g, '<em>$1</em>')
+        .replace(/^- (.+)$/gm, '<li>$1</li>')
+        .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
+        .replace(/\n\n/g, '</p><p>')
+        .replace(/\n/g, '<br>');
+    return `<p>${html}</p>`;
 }
diff --git a/frontend/src/main.js b/frontend/src/main.js
index 1698e66..9c80767 100644
--- a/frontend/src/main.js
+++ b/frontend/src/main.js
@@ -5,7 +5,6 @@ import './diagnostic.js';
 import { auth } from './services/auth.js';
 import { themeManager } from './services/theme.js';
 import { renderSidebar } from './components/Sidebar.js';
-import { renderPrivacyModal } from './components/PrivacyModal.js';
 import { inactivityMonitor } from './services/inactivity.js';
 import { processingNotifications } from './services/processing-notifications.js';
 
@@ -120,11 +119,6 @@ async function bootstrap() {
     processingNotifications.init();
     inactivityMonitor.init();
     
-    // Check for privacy consent
-    if (!auth.getConsentAccepted()) {
-        renderPrivacyModal();
-    }
-    
     // Default hash on first load — or redirect if hash doesn't match role
     if (!window.location.hash) {
         window.location.hash = `#/${auth.getRole()}/dashboard`;
diff --git a/frontend/src/services/api.js b/frontend/src/services/api.js
index 31e5c26..4a4361c 100644
--- a/frontend/src/services/api.js
+++ b/frontend/src/services/api.js
@@ -1515,19 +1515,71 @@ async getTeacherAiFeedbackAlerts(subjectId, limit = 10) {
      },
 
      async checkEnrollment(userId, subjectId) {
-         if (!userId || !subjectId) return { enrolled: false, role: null, status: null };
-         try {
-             const res = await fetchWithTimeout(
-                 `${BASE_URL}/enrollments/check?userId=${encodeURIComponent(userId)}&subjectId=${encodeURIComponent(subjectId)}`,
-                 { timeout: 3500 }
-             );
-             if (!res.ok) return { enrolled: false, role: null, status: null };
-             const data = await res.json();
-             if (data?.success && data.data) return data.data;
-             return data || { enrolled: false, role: null, status: null };
-         } catch (err) {
-             console.error('[API] checkEnrollment failed:', err);
-             return { enrolled: false, role: null, status: null };
-         }
-     },
-     };
+          if (!userId || !subjectId) return { enrolled: false, role: null, status: null };
+          try {
+              const res = await fetchWithTimeout(
+                  `${BASE_URL}/enrollments/check?userId=${encodeURIComponent(userId)}&subjectId=${encodeURIComponent(subjectId)}`,
+                  { timeout: 3500 }
+              );
+              if (!res.ok) return { enrolled: false, role: null, status: null };
+              const data = await res.json();
+              if (data?.success && data.data) return data.data;
+              return data || { enrolled: false, role: null, status: null };
+          } catch (err) {
+              console.error('[API] checkEnrollment failed:', err);
+              return { enrolled: false, role: null, status: null };
+          }
+      },
+
+    async getTerms() {
+            if (USE_MOCK) {
+                await delay(300);
+                return { content: '# Términos de Uso\n\nTexto de ejemplo para consentimiento.', version: 'v1' };
+            }
+            try {
+                const res = await apiFetch(`${BASE_URL}/terms`);
+                if (!res.ok) return null;
+                const data = await res.json();
+                if (data?.success && data.data) return data.data;
+                return null;
+            } catch (err) {
+                console.error('[API] getTerms failed:', err);
+                return null;
+            }
+        },
+
+    async getConsent() {
+            if (USE_MOCK) {
+                await delay(200);
+                return { accepted: false, acceptedAt: null, version: null };
+            }
+            try {
+                const res = await apiFetch(`${BASE_URL}/consent`);
+                if (!res.ok) return { accepted: false, acceptedAt: null, version: null };
+                const data = await res.json();
+                if (data?.success && data.data) return data.data;
+                return { accepted: false, acceptedAt: null, version: null };
+            } catch (err) {
+                console.error('[API] getConsent failed:', err);
+                return { accepted: false, acceptedAt: null, version: null };
+            }
+        },
+
+    async saveConsent() {
+            if (USE_MOCK) return { saved: true };
+            try {
+                const res = await apiFetch(`${BASE_URL}/consent`, {
+                    method: 'POST',
+                    headers: { 'Content-Type': 'application/json' },
+                    body: JSON.stringify({ accepted: true }),
+                });
+                if (!res.ok) return null;
+                const data = await res.json();
+                if (data?.success && data.data) return data.data;
+                return null;
+            } catch (err) {
+                console.error('[API] saveConsent failed:', err);
+                return null;
+            }
+        },
+      };
diff --git a/frontend/src/services/auth.js b/frontend/src/services/auth.js
index 5f01f08..fec17d7 100644
--- a/frontend/src/services/auth.js
+++ b/frontend/src/services/auth.js
@@ -4,6 +4,8 @@
 import { api } from './api.js';
 import { enrollments as enrollmentService } from './enrollments.js';
 
+const AI_CONSENT_KEY = 'edu_ai_consent_accepted';
+
 const CORRELATION_HEADER = 'x-correlation-id';
 
 function correlationHeaders() {
@@ -94,6 +96,28 @@ export const auth = {
         return localStorage.getItem('edu_consent_accepted') === 'true' || sessionStorage.getItem('edu_consent_accepted') === 'true';
     },
 
+    getAIConsentAccepted() {
+        return localStorage.getItem(AI_CONSENT_KEY) === 'true' || sessionStorage.getItem(AI_CONSENT_KEY) === 'true';
+    },
+
+    async acceptAIConsent() {
+        try {
+            await api.saveConsent();
+            localStorage.setItem(AI_CONSENT_KEY, 'true');
+            sessionStorage.setItem(AI_CONSENT_KEY, 'true');
+            window.dispatchEvent(new CustomEvent('auth:aiConsentAccepted'));
+            return true;
+        } catch (err) {
+            console.error('[Auth] Error saving AI consent:', err);
+            if (window.location.hostname === 'localhost') {
+                localStorage.setItem(AI_CONSENT_KEY, 'true');
+                sessionStorage.setItem(AI_CONSENT_KEY, 'true');
+                return true;
+            }
+            return false;
+        }
+    },
+
     async acceptPrivacyPolicy() {
         const user = this.getUser();
         const profile = {
@@ -259,6 +283,18 @@ export const auth = {
             console.error('Error fetching user profile:', err);
         }
 
+        // Sync AI consent from backend
+        try {
+            const consent = await api.getConsent();
+            if (consent) {
+                const accepted = consent.accepted ? 'true' : 'false';
+                sessionStorage.setItem(AI_CONSENT_KEY, accepted);
+                localStorage.setItem(AI_CONSENT_KEY, accepted);
+            }
+        } catch (err) {
+            console.error('Error fetching AI consent:', err);
+        }
+
         return authenticated;
     }
 };
diff --git a/infra/modules/storage.bicep b/infra/modules/storage.bicep
index 19a46b2..d86db22 100644
--- a/infra/modules/storage.bicep
+++ b/infra/modules/storage.bicep
@@ -167,6 +167,12 @@ resource enrollmentsTable 'Microsoft.Storage/storageAccounts/tableServices/table
   name: 'Enrollments'
 }
 
+// ─── Table: UserConsent (AI content consent records) ──────────
+resource userConsentTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
+  parent: tableService
+  name: 'UserConsent'
+}
+
 // ─── Outputs ───────────────────────────────────────────────────
 @description('The name of the Storage Account.')
 output accountName string = storageAccount.name
```

```javascript
// NEW FILE: backend/src/functions/consent-api.js
import { app } from '@azure/functions';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getTableClient } from '../services/storage.js';
import { downloadFile } from '../services/storage.js';
import { resolveCorrelationId, buildDependencyHeaders, withCorrelationResponseHeaders } from '../services/correlation.js';
import { v4 as uuidv4 } from 'uuid';

const CONSENT_TABLE = 'UserConsent';
const LEGAL_CONTAINER = 'legal';

function jsonResponse(status, payload, correlationId) {
    return {
        status,
        headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
    };
}

async function ensureConsentTable() {
    const client = getTableClient(CONSENT_TABLE);
    try {
        await client.createTable();
    } catch (err) {
        if (err.statusCode !== 409) throw err;
    }
}

async function getConsentRecord(userId) {
    const client = getTableClient(CONSENT_TABLE);
    try {
        return await client.getEntity(userId, 'consent');
    } catch {
        return null;
    }
}

app.http('consent-get', {
    methods: ['GET'],
    route: 'consent',
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = resolveCorrelationId(request);
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' }, correlationId);

        const principal = parseClientPrincipal(request);
        const userId = principal?.oid || request.headers.get('x-edu-uid') || 'pilot-user';
        context.log(`[Consent] GET consent for userId=${userId}`);

        try {
            const record = await getConsentRecord(userId);
            if (record) {
                return jsonResponse(200, {
                    success: true,
                    data: {
                        accepted: true,
                        acceptedAt: record.acceptedAt,
                        version: record.version,
                    },
                    meta: { timestamp: new Date().toISOString(), requestId: correlationId },
                }, correlationId);
            }
            return jsonResponse(200, {
                success: true,
                data: {
                    accepted: false,
                    acceptedAt: null,
                    version: null,
                },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            }, correlationId);
        } catch (error) {
            context.error(`[Consent] Error reading consent for userId=${userId}:`, error);
            return jsonResponse(500, {
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Error al leer el consentimiento.' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            }, correlationId);
        }
    },
});

app.http('consent-post', {
    methods: ['POST'],
    route: 'consent',
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = resolveCorrelationId(request);
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' }, correlationId);

        const principal = parseClientPrincipal(request);
        const userId = principal?.oid || request.headers.get('x-edu-uid') || 'pilot-user';
        const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-azure-client-ip') || '';

        context.log(`[Consent] POST consent for userId=${userId}`);

        try {
            await ensureConsentTable();
            const client = getTableClient(CONSENT_TABLE);
            const entity = {
                partitionKey: userId,
                rowKey: 'consent',
                acceptedAt: new Date().toISOString(),
                version: 'v1',
                ipAddress,
            };
            await client.upsertEntity(entity, 'Replace');

            return jsonResponse(200, {
                success: true,
                data: { saved: true },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            }, correlationId);
        } catch (error) {
            context.error(`[Consent] Error saving consent for userId=${userId}:`, error);
            return jsonResponse(500, {
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Error al guardar el consentimiento.' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            }, correlationId);
        }
    },
});

app.http('terms-get', {
    methods: ['GET'],
    route: 'terms',
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const correlationId = resolveCorrelationId(request);
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' }, correlationId);

        context.log(`[Consent] GET terms`);

        try {
            const content = await downloadFile(LEGAL_CONTAINER, 'terms-v1.md');
            const text = content.toString('utf-8');
            return jsonResponse(200, {
                success: true,
                data: { content: text, version: 'v1' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            }, correlationId);
        } catch (error) {
            context.error('[Consent] Error fetching terms:', error);
            return jsonResponse(500, {
                success: false,
                error: { code: 'TERMS_NOT_FOUND', message: 'No se encontraron los términos de uso.' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            }, correlationId);
        }
    },
});
```

```javascript
// NEW FILE: backend/src/functions/consent-api.test.js
import { test, mock } from 'node:test';
import assert from 'node:assert';

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({ oid: 'test-user', userRoles: ['Alumno'] })),
};

let consentStore = {};

const storageMocks = {
    getTableClient: mock.fn(() => {
        return {
            createTable: mock.fn(async () => {}),
            getEntity: mock.fn(async (pk, rk) => {
                const key = `${pk}:${rk}`;
                if (!consentStore[key]) {
                    const err = new Error('Not Found');
                    err.statusCode = 404;
                    throw err;
                }
                return consentStore[key];
            }),
            upsertEntity: mock.fn(async (entity) => {
                const key = `${entity.partitionKey}:${entity.rowKey}`;
                consentStore[key] = entity;
            }),
        };
    }),
    downloadFile: mock.fn(async () => {
        return Buffer.from('# Términos de Uso\n\nTexto de prueba para consentimiento.', 'utf-8');
    }),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });

const handlers = {};
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
            }
        }
    }
});

await import('./consent-api.js');

function makeContext() {
    return { log: mock.fn(), error: mock.fn(), warn: mock.fn() };
}

function makeRequest(headers = {}) {
    return {
        headers: {
            get: (key) => headers[key] || null,
        },
    };
}

test.beforeEach(() => { consentStore = {}; });

test('get-consent returns accepted=false for new user', async () => {
    const ctx = makeContext();
    const req = makeRequest({ 'x-edu-uid': 'alu-001' });
    const res = await handlers['consent-get'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.accepted, false);
    assert.strictEqual(body.data.acceptedAt, null);
});

test('get-consent returns accepted=true after POST', async () => {
    const ctx = makeContext();
    const req = makeRequest({ 'x-edu-uid': 'alu-001' });
    const postRes = await handlers['consent-post'](req, ctx);
    assert.strictEqual(postRes.status, 200);
    const getRes = await handlers['consent-get'](req, ctx);
    assert.strictEqual(getRes.status, 200);
    const getBody = JSON.parse(getRes.body);
    assert.strictEqual(getBody.data.accepted, true);
    assert.ok(getBody.data.acceptedAt);
    assert.strictEqual(getBody.data.version, 'v1');
});

test('post-consent creates record and returns saved=true', async () => {
    const ctx = makeContext();
    const req = makeRequest({ 'x-edu-uid': 'alu-002', 'x-forwarded-for': '192.168.1.1' });
    const res = await handlers['consent-post'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.saved, true);
});

test('get-terms returns markdown content', async () => {
    const ctx = makeContext();
    const req = makeRequest({});
    const res = await handlers['terms-get'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.version, 'v1');
    assert.ok(body.data.content.includes('Términos de Uso'));
});

test('post-consent is idempotent on duplicate POST', async () => {
    const ctx = makeContext();
    const req = makeRequest({ 'x-edu-uid': 'alu-003' });
    const res1 = await handlers['consent-post'](req, ctx);
    const res2 = await handlers['consent-post'](req, ctx);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res2.status, 200);
});
```

```markdown
// NEW FILE: legal/terms-v1.md
# Términos de Uso - UADE Innova

## 1. Información Recopilada

Al utilizar el chat de UADE Innova, procesamos información sobre su cursada, incluyendo:
- Materiales de clase subidos por los docentes (transcripciones, presentaciones, apuntes y bibliografía)
- Consultas realizadas en el chat RAG
- Respuestas generadas por el asistente IA

## 2. Uso de IA Generativa

UADE Innova utiliza modelos de Azure OpenAI y Azure AI Foundry (DeepSeek) para:
- Responder consultas sobre los materiales de clase
- Generar resúmenes de contenido académico

Sus datos están protegidos bajo protocolos de seguridad de nivel empresarial proporcionados por Azure. Sus consultas **no se utilizan** para entrenar modelos públicos externos.

## 3. Almacenamiento de Consultas

- Sus consultas y las respuestas generadas se almacenan de forma segura en Azure Blob Storage
- Los datos se conservan durante el período académico y se eliminan según las políticas institucionales
- Los registros de consultas se utilizan exclusivamente para mejorar la calidad de las respuestas y para auditoría académica

## 4. Sus Derechos

Conforme a la Ley de Protección de Datos Personales 25.326 de la República Argentina, usted tiene derecho a:
- **Acceso:** Solicitar una copia de los datos almacenados sobre su actividad
- **Rectificación:** Solicitar la corrección de datos inexactos
- **Cancelación:** Solicitar la eliminación de sus datos
- **Oposición:** Oponerse al tratamiento de sus datos para fines específicos

Para ejercer estos derechos, contacte a: privacidad@uade.edu.ar

## 5. Seguridad

- Toda la comunicación entre su navegador y los servidores de Azure está cifrada mediante TLS 1.2+
- Los accesos a los datos están autenticados mediante SSO institucional (Microsoft Entra ID)
- No se almacena información biométrica ni datos sensibles en el vector index

## 6. Contacto

Para consultas sobre esta política, contacte al Departamento de Sistemas de UADE o al equipo del proyecto a través de los canales institucionales.

---

*Versión v1 - Mayo 2026*
```
