import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';
import { withAuth } from '../middleware/with-auth.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { loadJson, saveJson } from '../services/storage.js';
import { trackNotificationInteraction } from '../services/telemetry.js';
import { CONFIG } from '../services/config.js';
import { validateRetentionPolicy, DEFAULT_RETENTION_POLICY } from '../services/admin-settings.js';

const COMPLIANCE_CONTAINER = CONFIG.containers.compliance;
const POLICY_BLOB = 'retention-policy.json';
const COMPLIANCE_ROLES = ['Director', 'Admin', 'Security'];
const DEFAULT_SOFT_DELETE_DAYS = 7;
const DEFAULT_POLICY_RULES = [
  {
    name: 'DeleteArchiveAfter2Years',
    enabled: true,
    action: 'delete',
    filter: { containerPattern: 'archive-*', blobAgeDays: 730 },
  },
];

function isComplianceAuthorized(request, context) {
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') return true;
  if (!validateFrontDoorId(request)) return false;
  const principal = context?.principal || parseClientPrincipal(request);
  return principal?.userRoles?.some(r => COMPLIANCE_ROLES.includes(r)) === true;
}

function csvValue(value) {
  return value === undefined || value === null ? '' : String(value);
}

function buildCsv(policy, generatedAt) {
  const header = 'rule_name,enabled,action,retention_days,prefixes';
  const rows = (policy.rules || []).map((r) => {
    const rule = r || {};
    const filter = rule.filter || {};
    const retentionDays = rule.retentionDays ?? filter.blobAgeDays ?? '';
    const prefixes = Array.isArray(rule.prefixes)
      ? rule.prefixes.join(';')
      : (filter.containerPattern !== undefined && filter.containerPattern !== null ? String(filter.containerPattern) : '');
    return `${csvValue(rule.name)},${csvValue(rule.enabled)},${csvValue(rule.action)},${csvValue(retentionDays)},"${csvValue(prefixes)}"`;
  });
  const settingsRows = [
    `cold_archive_policy,${csvValue(policy.archiveEnabled)},archive,${csvValue(policy.archiveDays)},class-materials`,
    `permanent_delete_policy,${csvValue(policy.deleteEnabled)},delete,${csvValue(policy.deleteDays)},all_blobs`,
    `notify_teachers,${csvValue(policy.notifyTeachers)},notify,,teachers`,
    `auto_delete,${csvValue(policy.autoDelete)},autoDelete,,all_blobs`,
  ];
  const footer = `generated_at,${csvValue(generatedAt)}`;
  const softDeleteRow = `soft_delete_policy,true,softDelete,${csvValue(policy.softDeleteDays)},all_blobs`;
  return [header, ...rows, ...settingsRows, softDeleteRow, footer].join('\n');
}

async function getPolicy() {
  const policy = await loadJson(COMPLIANCE_CONTAINER, POLICY_BLOB);
  if (!policy) return null;
  return policy;
}

function policyResponse(policy, configured, note) {
  return {
    configured,
    rules: policy.rules,
    softDeleteDays: policy.softDeleteDays,
    archiveEnabled: policy.archiveEnabled,
    archiveDays: policy.archiveDays,
    deleteEnabled: policy.deleteEnabled,
    deleteDays: policy.deleteDays,
    notifyTeachers: policy.notifyTeachers,
    autoDelete: policy.autoDelete,
    updatedAt: policy.updatedAt || null,
    updatedBy: policy.updatedBy || null,
    evaluatedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
}

async function handleGetPolicy(request, context) {
  if (!isComplianceAuthorized(request, context)) {
    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director, Admin, or Security role required' }) };
  }

    try {
        const policy = await getPolicy();
        if (!policy) {
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(policyResponse(
                    { ...DEFAULT_RETENTION_POLICY, rules: [], softDeleteDays: DEFAULT_SOFT_DELETE_DAYS },
                    false,
                    'Política de retención no configurada — aplican valores por defecto de Azure Storage.'
                )),
            };
        }
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(policyResponse({ ...DEFAULT_RETENTION_POLICY, ...policy }, true)),
        };
    } catch (err) {
        context.log('[Compliance] Error reading policy:', err.message);
        return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al leer política de retención' }) };
    }
}

async function handlePutPolicy(request, context) {
  if (!isComplianceAuthorized(request, context)) {
    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director, Admin, or Security role required' }) };
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Body JSON inválido.' }) };
  }
  const values = body?.policy || body;

  const validation = validateRetentionPolicy(values);
  if (!validation.valid) {
    return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: validation.error }) };
  }

  const principal = context?.principal || parseClientPrincipal(request);
  const userId = principal?.userId || 'anonymous';

  try {
    const existing = await getPolicy();
    const policy = {
      ...DEFAULT_RETENTION_POLICY,
      ...values,
      rules: existing?.rules || DEFAULT_POLICY_RULES,
      softDeleteDays: existing?.softDeleteDays ?? DEFAULT_SOFT_DELETE_DAYS,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };
    await saveJson(COMPLIANCE_CONTAINER, POLICY_BLOB, policy);
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(policyResponse(policy, true)),
    };
  } catch (err) {
    context.log('[Compliance] Error saving policy:', err.message);
    return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al guardar la política de retención' }) };
  }
}

async function handleExport(request, context) {
  if (!isComplianceAuthorized(request, context)) {
    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director, Admin, or Security role required' }) };
  }

  try {
    const format = request.query.get('format') || 'csv';
    if (!['csv', 'json'].includes(format)) {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Unsupported format. Use 'csv' or 'json'" }) };
    }

    const policy = await getPolicy();
    const generatedAt = new Date().toISOString();

    if (!policy) {
      if (format === 'csv') {
        const csv = buildCsv(
          { ...DEFAULT_RETENTION_POLICY, rules: [], softDeleteDays: DEFAULT_SOFT_DELETE_DAYS },
          generatedAt
        );
        return {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="retention-compliance-${generatedAt.slice(0, 10)}.csv"`,
          },
          body: csv,
        };
      }
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          export: { rules: [], softDeletePolicy: { enabled: true, days: 7 }, note: 'Política de retención no configurada.', generatedAt },
        }),
      };
    }

    const userId = parseClientPrincipal(request)?.userId || 'anonymous';
    trackNotificationInteraction({
      action: 'compliance_export',
      status: 'success',
      userId,
      subjectId: 'compliance',
      notificationId: `export-${format}-${Date.now()}`,
    }).catch((err) => context.error('[Compliance] Telemetry error:', err));

    if (format === 'csv') {
      const csv = buildCsv(policy, generatedAt);
      return {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="retention-compliance-${generatedAt.slice(0, 10)}.csv"`,
        },
        body: csv,
      };
    }

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="retention-compliance-${generatedAt.slice(0, 10)}.json"`,
      },
      body: JSON.stringify({
        export: {
          rules: policy.rules,
          softDeletePolicy: { enabled: true, days: policy.softDeleteDays },
          archivePolicy: { enabled: policy.archiveEnabled, days: policy.archiveDays },
          deletePolicy: { enabled: policy.deleteEnabled, days: policy.deleteDays },
          notifications: { notifyTeachers: policy.notifyTeachers, autoDelete: policy.autoDelete },
          updatedAt: policy.updatedAt,
          updatedBy: policy.updatedBy,
          generatedAt,
        },
      }, null, 2),
    };
  } catch (err) {
    context.log('[Compliance] Error exporting:', err.message);
    return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al exportar evidencia de cumplimiento' }) };
  }
}

app.http('get-compliance-retention-policy', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'compliance/retention-policy',
  handler: withCorrelation(withAuth(handleGetPolicy, { roles: COMPLIANCE_ROLES })),
});

app.http('put-compliance-retention-policy', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'compliance/retention-policy',
  handler: withCorrelation(withAuth(handlePutPolicy, { roles: COMPLIANCE_ROLES })),
});

app.http('get-compliance-retention-export', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'compliance/retention-export',
  handler: withCorrelation(withAuth(handleExport, { roles: COMPLIANCE_ROLES })),
});
