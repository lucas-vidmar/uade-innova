import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';
import { withAuth } from '../middleware/with-auth.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { loadJson, saveJson, getClient } from '../services/storage.js';
import { trackNotificationInteraction } from '../services/telemetry.js';
import { CONFIG } from '../services/config.js';
import { validateRetentionPolicy, DEFAULT_RETENTION_POLICY } from '../services/admin-settings.js';
import { getMaterialStateById } from '../services/state-store.js';
import {
  listMaterialDeletions,
  getMaterialDeletion,
  isValidDeletionRecordId,
  DELETED_CONTAINER_PURGE_DAYS,
} from '../services/deletion-audit-store.js';

const COMPLIANCE_CONTAINER = CONFIG.containers.compliance;
const POLICY_BLOB = 'retention-policy.json';
const COMPLIANCE_ROLES = ['Director', 'Admin', 'Security'];
const DEFAULT_SOFT_DELETE_DAYS = 7;
const MATERIALS_CONTAINER = CONFIG.containers.materials;
const PROCESSED_CONTAINER = 'processed';
const DELETED_CONTAINER = 'deleted';
const BACKUP_CONTAINER = 'vector-backups';
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

// ── Constancias de borrado de material (UJ-56 pasos 4, 7 y 9 / #538) ──────
// El rol que responde por el cumplimiento (Admin) puede ejecutar el borrado y,
// además, leer y comprobar su constancia sin haber participado del borrado.

const VERDICT_LABELS = {
  'sin-copias': 'Sin copias: el material no está en el acervo ni en el índice, y no quedan blobs vivos.',
  'residuo-soft-delete': 'Sin copias vivas: sólo queda la copia soft-borrada en `deleted/`, que la política permite temporalmente.',
  'copia-viva': 'Copia viva: el material todavía tiene blobs en los contenedores vivos.',
  'material-vivo': 'Material vivo: sigue en el inventario de la clase.',
  'indeterminado': 'Indeterminado: no se pudieron leer todas las superficies de comprobación.',
};

/**
 * Enumeración de un contenedor con estado explícito: distingue "no existe" de
 * "existe y no tiene blobs de este material". Sin esto, un contenedor
 * ilegible se reportaría como "sin copias" y la constancia mentiría.
 */
async function scanContainer(container, prefix = '') {
  try {
    const containerClient = getClient().getContainerClient(container);
    const exists = await containerClient.exists();
    if (!exists) return { container, exists: false, names: [] };
    const names = [];
    for await (const blob of containerClient.listBlobsFlat({ prefix })) names.push(blob.name);
    return { container, exists: true, names };
  } catch (err) {
    return { container, exists: null, names: [], error: err?.message || 'no se pudo leer el contenedor' };
  }
}

/**
 * Comprueba, contra el estado actual, si el borrado de una constancia dejó
 * copias vivas. Es repetible: cada llamada vuelve a leer las superficies.
 * @param {object} record
 */
async function verifyDeletionRecord(record) {
  const materialId = record?.target?.materialId || null;
  const subjectId = record?.target?.subjectId || null;
  const checkedAt = new Date().toISOString();
  const matches = (name) => String(name).includes(materialId);

  const [state, liveMaterials, liveProcessed, softDeleted, backups] = await Promise.all([
    getMaterialStateById(materialId).catch(() => null),
    scanContainer(MATERIALS_CONTAINER, subjectId ? `${subjectId}/` : ''),
    scanContainer(PROCESSED_CONTAINER, ''),
    scanContainer(DELETED_CONTAINER, ''),
    scanContainer(BACKUP_CONTAINER, ''),
  ]);

  const liveNames = [
    ...liveMaterials.names.filter(matches),
    ...liveProcessed.names.filter(matches),
  ];
  const copies = softDeleted.names.filter(matches);
  const backupCopies = backups.names.filter(matches);

  const declaredDays = Number(record?.retention?.declaredDays) || DEFAULT_SOFT_DELETE_DAYS;
  const unreadable = [liveMaterials, liveProcessed, softDeleted, backups].some((c) => c.exists === null);

  let verdict;
  if (state) verdict = 'material-vivo';
  else if (liveNames.length > 0 || backupCopies.length > 0) verdict = 'copia-viva';
  else if (unreadable) verdict = 'indeterminado';
  else if (copies.length > 0) verdict = 'residuo-soft-delete';
  else verdict = 'sin-copias';

  return {
    recordId: record?.recordId || null,
    materialId,
    subjectId,
    checkedAt,
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    materialEnInventario: state ? { presente: true, status: state.status || null } : { presente: false },
    contenedores: {
      [MATERIALS_CONTAINER]: { exists: liveMaterials.exists, copias: liveMaterials.names.filter(matches) },
      [PROCESSED_CONTAINER]: { exists: liveProcessed.exists, copias: liveProcessed.names.filter(matches) },
      [DELETED_CONTAINER]: { exists: softDeleted.exists, copias: copies },
      [BACKUP_CONTAINER]: { exists: backups.exists, copias: backupCopies },
    },
    retencion: {
      diasDeclaradosPorPolitica: declaredDays,
      diasDeVidaEnDepositoFrio: DELETED_CONTAINER_PURGE_DAYS,
      excedeLaPolitica: DELETED_CONTAINER_PURGE_DAYS > declaredDays,
    },
    alcanceEsperado: Array.isArray(record?.scope?.blobsMoved) ? record.scope.blobsMoved : [],
  };
}

async function handleListDeletionRecords(request, context) {
  if (!isComplianceAuthorized(request, context)) {
    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director, Admin, or Security role required' }) };
  }
  try {
    const records = await listMaterialDeletions({
      materialId: request.query?.get?.('materialId') || undefined,
      subjectId: request.query?.get?.('subjectId') || undefined,
      limit: request.query?.get?.('limit') || undefined,
    });
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records,
        count: records.length,
        evaluatedAt: new Date().toISOString(),
        policy: {
          softDeleteDays: (await getPolicy())?.softDeleteDays ?? DEFAULT_SOFT_DELETE_DAYS,
          deletedContainerPurgeDays: DELETED_CONTAINER_PURGE_DAYS,
        },
      }),
    };
  } catch (err) {
    context.log('[Compliance] Error listando constancias de borrado:', err.message);
    return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al leer las constancias de borrado' }) };
  }
}

async function handleGetDeletionRecord(request, context) {
  if (!isComplianceAuthorized(request, context)) {
    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director, Admin, or Security role required' }) };
  }
  const recordId = request.params?.recordId;
  if (!isValidDeletionRecordId(recordId)) {
    return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'recordId inválido' }) };
  }
  try {
    const record = await getMaterialDeletion(recordId);
    if (!record) {
      return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No existe constancia con ese id' }) };
    }
    return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) };
  } catch (err) {
    context.log('[Compliance] Error leyendo constancia de borrado:', err.message);
    return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al leer la constancia de borrado' }) };
  }
}

async function handleVerifyDeletionRecord(request, context) {
  if (!isComplianceAuthorized(request, context)) {
    return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director, Admin, or Security role required' }) };
  }
  const recordId = request.params?.recordId;
  if (!isValidDeletionRecordId(recordId)) {
    return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'recordId inválido' }) };
  }
  try {
    const record = await getMaterialDeletion(recordId);
    if (!record) {
      return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No existe constancia con ese id' }) };
    }
    const verificacion = await verifyDeletionRecord(record);
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, constancia: record, verificacion }),
    };
  } catch (err) {
    context.log('[Compliance] Error comprobando constancia de borrado:', err.message);
    return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al comprobar la constancia de borrado' }) };
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

// UJ-56 pasos 4, 7 y 9: constancias de borrado de material. Mismos roles que
// responden por el cumplimiento (Director, Admin, Security); Admin también
// puede ejecutar el borrado (`DELETE /api/materials/{id}`).
app.http('get-compliance-deletion-records', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'compliance/deletion-records',
  handler: withCorrelation(withAuth(handleListDeletionRecords, { roles: COMPLIANCE_ROLES })),
});

app.http('get-compliance-deletion-record', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'compliance/deletion-records/{recordId}',
  handler: withCorrelation(withAuth(handleGetDeletionRecord, { roles: COMPLIANCE_ROLES })),
});

app.http('get-compliance-deletion-record-verification', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'compliance/deletion-records/{recordId}/verificacion',
  handler: withCorrelation(withAuth(handleVerifyDeletionRecord, { roles: COMPLIANCE_ROLES })),
});
