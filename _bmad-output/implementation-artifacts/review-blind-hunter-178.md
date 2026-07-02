# Blind Hunter Review — Spec gh-178

You are a blind hunter reviewer. You receive ONLY the diff below — no project context, no spec, no access to the codebase.

Review the following diff for security vulnerabilities, logic errors, anti-patterns, and hidden assumptions.

```
diff --git a/backend/src/functions/compliance-api.js b/backend/src/functions/compliance-api.js
new file mode 100644
index 0000000..ef931e8
--- /dev/null
+++ b/backend/src/functions/compliance-api.js
@@ -0,0 +1,116 @@
+import { app } from '@azure/functions';
+import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
+import { loadJson, downloadFile } from '../services/storage.js';
+import { trackNotificationInteraction } from '../services/telemetry.js';
+
+const COMPLIANCE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER_COMPLIANCE || 'compliance';
+const POLICY_BLOB = 'retention-policy.json';
+
+function buildCsv(policy, generatedAt) {
+  const header = 'rule_name,enabled,action,retention_days,prefixes';
+  const rows = policy.rules.map((r) =>
+    `${r.name},${r.enabled},${r.action},${r.retentionDays},"${r.prefixes.join(';')}"`
+  );
+  const footer = `generated_at,${generatedAt}`;
+  const softDeleteRow = `soft_delete_policy,true,softDelete,${policy.softDeleteDays},all_blobs`;
+  return [header, ...rows, softDeleteRow, footer].join('\n');
+}
+
+async function getPolicy() {
+  const policy = await loadJson(COMPLIANCE_CONTAINER, POLICY_BLOB);
+  if (!policy) return null;
+  return policy;
+}
+
+async function handleGetPolicy(request, context) {
+  if (!validateFrontDoorId(request)) {
+    return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
+  }
+  const principal = parseClientPrincipal(request);
+  const isAuthorized = principal?.userRoles?.some(r => ['Director'].includes(r))
+    || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
+  if (!isAuthorized) {
+    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
+  }
+
+  try {
+    const policy = await getPolicy();
+    if (!policy) {
+      return { status: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Retention policy configuration not found' }) };
+    }
+    return {
+      status: 200,
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ rules: policy.rules, softDeleteDays: policy.softDeleteDays, evaluatedAt: new Date().toISOString() }),
+    };
+  } catch (err) {
+    context.log('[Compliance] Error reading policy:', err.message);
+    return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al leer política de retención' }) };
+  }
+}
+
+async function handleExport(request, context) {
+  if (!validateFrontDoorId(request)) {
+    return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
+  }
+  const principal = parseClientPrincipal(request);
+  const isAuthorized = principal?.userRoles?.some(r => ['Director'].includes(r))
+    || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
+  if (!isAuthorized) {
+    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
+  }
+
+  try {
+    const format = request.query.get('format') || 'csv';
+    if (!['csv', 'json'].includes(format)) {
+      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Unsupported format. Use 'csv' or 'json'" }) };
+    }
+
+    const policy = await getPolicy();
+    if (!policy) {
+      return { status: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Retention policy configuration not found' }) };
+    }
+
+    const generatedAt = new Date().toISOString();
+
+    const userId = principal?.userId || 'anonymous';
+    trackNotificationInteraction({
+      action: 'compliance_export',
+      status: 'success',
+      userId,
+      subjectId: 'compliance',
+      notificationId: `export-${format}-${Date.now()}`,
+    }).catch((err) => context.error('[Compliance] Telemetry error:', err));
+
+    if (format === 'csv') {
+      const csv = buildCsv(policy, generatedAt);
+      return {
+        status: 200,
+        headers: {
+          'Content-Type': 'text/csv',
+          'Content-Disposition': `attachment; filename="retention-compliance-${generatedAt.slice(0, 10)}.csv"`,
+        },
+        body: csv,
+      };
+    }
+
+    return {
+      status: 200,
+      headers: {
+        'Content-Type': 'application/json',
+        'Content-Disposition': `attachment; filename="retention-compliance-${generatedAt.slice(0, 10)}.json"`,
+      },
+      body: JSON.stringify({ export: { rules: policy.rules, softDeletePolicy: { enabled: true, days: policy.softDeleteDays }, generatedAt } }, null, 2),
+    };
+  } catch (err) {
+    context.log('[Compliance] Error exporting:', err.message);
+    return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al exportar evidencia de cumplimiento' }) };
+  }
+}
+
+app.http('get-compliance-retention-policy', {
+  methods: ['GET'],
+  authLevel: 'anonymous',
+  route: 'compliance/retention-policy',
+  handler: handleGetPolicy,
+});
+
+app.http('get-compliance-retention-export', {
+  methods: ['GET'],
+  authLevel: 'anonymous',
+  route: 'compliance/retention-export',
+  handler: handleExport,
+});
```

```
diff --git a/scripts/seed-retention-policy.js b/scripts/seed-retention-policy.js
new file mode 100644
index 0000000..c3ac4be
--- /dev/null
+++ b/scripts/seed-retention-policy.js
@@ -0,0 +1,35 @@
+import { BlobServiceClient } from '@azure/storage-blob';
+
+const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
+if (!connectionString) {
+  console.error('AZURE_STORAGE_CONNECTION_STRING is required');
+  process.exit(1);
+}
+
+const policy = {
+  softDeleteDays: 7,
+  rules: [
+    {
+      name: 'DeleteArchiveAfter2Years',
+      enabled: true,
+      action: 'delete',
+      retentionDays: 730,
+      prefixes: ['class-materials/', 'processed/'],
+    },
+    {
+      name: 'ArchiveOldSemesterMaterials',
+      enabled: true,
+      action: 'tierToArchive',
+      retentionDays: 180,
+      prefixes: ['class-materials/semester-', 'processed/semester-'],
+    },
+  ],
+};
+
+async function main() {
+  const blobService = BlobServiceClient.fromConnectionString(connectionString);
+  const containerName = process.env.AZURE_STORAGE_CONTAINER_COMPLIANCE || 'compliance';
+  const containerClient = blobService.getContainerClient(containerName);
+
+  await containerClient.createIfNotExists({ access: 'container' });
+
+  const blobName = 'retention-policy.json';
+  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
+
+  const content = JSON.stringify(policy, null, 2);
+  await blockBlobClient.upload(content, content.length, {
+    blobHTTPHeaders: { blobContentType: 'application/json' },
+  });
+
+  console.log(`Uploaded ${blobName} to container ${containerName}`);
+}
+
+main().catch((err) => {
+  console.error(err);
+  process.exit(1);
+});
```

Also includes changes to: `backend/src/index.js`, `frontend/src/components/Sidebar.js`, `frontend/src/main.js`, `frontend/src/pages/director/Dashboard.js`, `frontend/src/pages/director/Compliance.js`, `frontend/src/services/api.js`, `infra/modules/storage.bicep`
