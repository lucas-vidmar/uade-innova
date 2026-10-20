/**
 * functions/access-audit-api.js — Superficie de lectura del rastro de pedidos de
 * datos (UJ-62 pasos 5, 7, 8 y 9 / #456).
 *
 * Tres lecturas, ninguna escritura:
 *   GET /api/audit/access-log            → pedidos en una ventana, con filtros
 *   GET /api/audit/access-log/{id}       → un pedido, por su id de caso
 *   GET /api/audit/access-log/export     → exportación para el auditor
 *
 * La exportación separa **entregado** de **denegado** de forma explícita:
 *  - `format=json` devuelve tres arreglos con nombre (`entregados`, `denegados`,
 *    `errores`) más un `resumen` con conteos: es la forma que un auditor (A7,
 *    fuera de la aplicación) puede citar sin interpretar una columna.
 *  - `format=csv` es plano y ordenado por resultado (entregados, denegados,
 *    errores) con la columna `resultado` en tercera posición, para que Excel o
 *    un script lo lean sin heurísticas.
 *
 * Lo que la respuesta declara siempre, para que nadie lea de más:
 *  - `alcance`: qué pedidos cubre el rastro (todos los HTTP de esta API).
 *  - `retencion`: plazo declarado y si está aplicado (`enforced`).
 *  - `trazado`: si el rastro está activo y si el almacén está configurado. Un
 *    listado vacío con `trazado.activo=false` NO es evidencia de que no hubo
 *    pedidos; la pantalla y el export lo dicen.
 *  - `origen.disponible`: si el origen (IP) es recuperable. Cuando la plataforma
 *    no lo informa, los asientos lo declaran en vez de inventarlo.
 *
 * Roles: los mismos que responden por el cumplimiento (Director, Admin,
 * Security), tal como el resto de la superficie de `compliance`. No se inventó
 * una identidad "auditor": quien audita usa una de esas cuentas y el rastro
 * asienta esa lectura como cualquier otra.
 */

import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';
import { withAuth } from '../middleware/with-auth.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import {
  listAccessRecords,
  getAccessRecord,
  isValidAccessRecordId,
  declaredRetention,
  isAuditTrailEnabled,
  isAuditStorageConfigured,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  WINDOW_MAX_DAYS,
} from '../services/access-audit-store.js';

const AUDIT_ROLES = ['Director', 'Admin', 'Security'];

export const AUDIT_SCOPE = 'Todos los pedidos HTTP a esta API (una fila por pedido, entregado, denegado o con error). El contenido del pedido no se copia: se describe la superficie, el método, la ruta y los nombres de los parámetros.';

function isAuditAuthorized(request, context) {
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') return true;
  if (!validateFrontDoorId(request)) return false;
  const principal = context?.principal || parseClientPrincipal(request);
  return principal?.userRoles?.some((r) => AUDIT_ROLES.includes(r)) === true;
}

function json(status, payload) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function csvCell(value) {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function fecha(iso) {
  return iso || '';
}

/** Orden del export: primero lo entregado, después lo denegado, al final los errores. */
const OUTCOME_ORDER = ['delivered', 'denied', 'error'];

const OUTCOME_LABEL = {
  delivered: 'ENTREGADO',
  denied: 'DENEGADO',
  error: 'ERROR',
};

function orderRecords(records) {
  const rank = (record) => OUTCOME_ORDER.indexOf(record.outcome);
  return [...records].sort((a, b) => {
    const byOutcome = rank(a) - rank(b);
    if (byOutcome !== 0) return byOutcome;
    return String(b.at).localeCompare(String(a.at));
  });
}

export function buildAuditCsv(records, meta = {}) {
  const ordered = orderRecords(records);
  const header = [
    'registro', 'fecha', 'resultado', 'metodo', 'ruta', 'superficie',
    'actor', 'rol', 'identificado', 'origen_ip', 'origen_fuente',
    'estado_http', 'motivo_denegacion', 'correlation_id', 'retencion_dias',
  ].join(',');
  const rows = ordered.map((record) => [
    csvCell(record.recordId),
    csvCell(fecha(record.at)),
    csvCell(OUTCOME_LABEL[record.outcome] || record.outcome),
    csvCell(record.request?.method),
    csvCell(record.request?.path),
    csvCell(record.surface),
    csvCell(record.actor?.id || 'anonymous'),
    csvCell(record.actor?.role || ''),
    csvCell(record.actor?.identified ? 'si' : 'no'),
    csvCell(record.origin?.ip || 'no disponible'),
    csvCell(record.origin?.source || 'no disponible'),
    csvCell(record.status ?? ''),
    csvCell(record.denial?.code || ''),
    csvCell(record.correlationId || ''),
    csvCell(record.retention?.days ?? ''),
  ].join(','));
  const totales = {
    entregados: ordered.filter((r) => r.outcome === 'delivered').length,
    denegados: ordered.filter((r) => r.outcome === 'denied').length,
    errores: ordered.filter((r) => r.outcome === 'error').length,
  };
  // Cola legible por personas: el resumen va al final en líneas `#`, así el
  // cuerpo sigue siendo un CSV plano para scripts.
  const footer = [
    `# resumen: entregados=${totales.entregados}; denegados=${totales.denegados}; errores=${totales.errores}; total=${ordered.length}`,
    `# ventana: ${meta.window?.from || 'n/d'} .. ${meta.window?.to || 'n/d'}`,
    `# retencion declarada: ${meta.retencion?.days ?? 'n/d'} dias (aplicada por politica: ${meta.retencion?.enforced ? 'si' : 'no'})`,
    `# origen: ${meta.origen?.disponible === false ? 'no disponible en la plataforma para los asientos listados' : 'informado por la cabecera de la peticion'}`,
    `# alcance: ${AUDIT_SCOPE}`,
    `# generado: ${meta.generatedAt || ''}`,
  ];
  return [header, ...rows, ...footer].join('\n');
}

function buildMeta(result, generatedAt) {
  const conOrigen = result.records.filter((r) => r.origin?.available === true).length;
  return {
    generatedAt,
    window: result.window,
    retencion: declaredRetention(),
    alcance: AUDIT_SCOPE,
    trazado: {
      activo: isAuditTrailEnabled(),
      almacenConfigurado: isAuditStorageConfigured(),
    },
    origen: {
      disponible: conOrigen > 0,
      asientosConOrigen: conOrigen,
      asientosSinOrigen: result.records.length - conOrigen,
      nota: conOrigen > 0
        ? null
        : 'La plataforma no informó el origen (IP) de estos pedidos: el rastro lo declara en vez de inventarlo.',
    },
    resumen: {
      entregados: result.totals.delivered,
      denegados: result.totals.denied,
      errores: result.totals.error,
      total: result.count,
    },
    paginado: {
      cursor: result.cursor,
      limite: LIMIT_MAX,
      limitePorDefecto: LIMIT_DEFAULT,
      ventanaMaximaDias: WINDOW_MAX_DAYS,
      truncadoPorEscaneo: result.truncated === true,
    },
  };
}

function queryFilters(request) {
  const q = request.query;
  const read = (name) => (typeof q?.get === 'function' ? q.get(name) : null);
  return {
    from: read('from') || null,
    to: read('to') || null,
    outcome: read('outcome') || null,
    correlationId: read('correlationId') || read('correlation_id') || null,
    actor: read('actor') || null,
    surface: read('surface') || null,
    limit: read('limit') || null,
    cursor: read('cursor') || null,
  };
}

export async function handleListAccessLog(request, context) {
  if (!isAuditAuthorized(request, context)) {
    return json(403, { error: 'Forbidden - Director, Admin, or Security role required' });
  }
  const filters = queryFilters(request);
  const limit = filters.limit ? Number(filters.limit) : LIMIT_DEFAULT;
  if (filters.limit && (!Number.isFinite(limit) || limit < 1)) {
    return json(400, { error: 'limit inválido: tiene que ser un entero positivo' });
  }
  const result = await listAccessRecords({ ...filters, limit });
  if (result.error) {
    // No se disfraza un fallo de lectura como "no hay pedidos".
    const status = /ventana|limit|outcome/.test(result.error) ? 400 : 503;
    return json(status, {
      error: result.error,
      note: 'No se pudo leer el rastro. Esto NO significa que no haya pedidos registrados.',
      trazado: { activo: isAuditTrailEnabled(), almacenConfigurado: isAuditStorageConfigured() },
    });
  }
  return json(200, {
    count: result.count,
    totals: result.totals,
    records: result.records,
    window: result.window,
    cursor: result.cursor,
    filters,
    ...buildMeta(result, new Date().toISOString()),
  });
}

export async function handleGetAccessRecord(request, context) {
  if (!isAuditAuthorized(request, context)) {
    return json(403, { error: 'Forbidden - Director, Admin, or Security role required' });
  }
  const recordId = request.params?.recordId;
  if (!isValidAccessRecordId(recordId)) {
    return json(400, { error: 'recordId inválido' });
  }
  const { record, error } = await getAccessRecord(recordId);
  if (error) {
    return json(503, {
      error,
      note: 'No se pudo leer el asiento. Esto NO significa que no exista.',
    });
  }
  if (!record) {
    return json(404, { error: 'No existe un asiento con ese id' });
  }
  return json(200, { record, retencion: declaredRetention(), alcance: AUDIT_SCOPE });
}

export async function handleExportAccessLog(request, context) {
  if (!isAuditAuthorized(request, context)) {
    return json(403, { error: 'Forbidden - Director, Admin, or Security role required' });
  }
  const q = request.query;
  const format = (typeof q?.get === 'function' ? q.get('format') : null) || 'csv';
  if (!['csv', 'json'].includes(format)) {
    return json(400, { error: "Unsupported format. Use 'csv' or 'json'" });
  }
  const filters = queryFilters(request);
  const limitRaw = filters.limit ? Number(filters.limit) : LIMIT_MAX;
  if (!Number.isFinite(limitRaw) || limitRaw < 1) {
    return json(400, { error: 'limit inválido: tiene que ser un entero positivo' });
  }
  const result = await listAccessRecords({ ...filters, limit: limitRaw });
  if (result.error) {
    const status = /ventana|limit|outcome/.test(result.error) ? 400 : 503;
    return json(status, {
      error: result.error,
      note: 'No se pudo leer el rastro: no se genera una exportación vacía que pueda leerse como "no hubo pedidos".',
    });
  }

  const generatedAt = new Date().toISOString();
  const meta = buildMeta(result, generatedAt);

  if (format === 'csv') {
    return {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="rastro-accesos-${generatedAt.slice(0, 10)}.csv"`,
      },
      body: buildAuditCsv(result.records, meta),
    };
  }

  return json(200, {
    generatedAt,
    ...meta,
    // La separación explícita que pide el paso 8: tres bloques con nombre.
    entregados: orderRecords(result.records).filter((r) => r.outcome === 'delivered'),
    denegados: orderRecords(result.records).filter((r) => r.outcome === 'denied'),
    errores: orderRecords(result.records).filter((r) => r.outcome === 'error'),
  });
}

app.http('get-audit-access-log', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'audit/access-log',
  handler: withCorrelation(withAuth(handleListAccessLog, { roles: AUDIT_ROLES })),
});

// El export se registra antes que la lectura por id: si no, `access-log/export`
// cae en `{recordId}`.
app.http('get-audit-access-log-export', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'audit/access-log/export',
  handler: withCorrelation(withAuth(handleExportAccessLog, { roles: AUDIT_ROLES })),
});

app.http('get-audit-access-record', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'audit/access-log/{recordId}',
  handler: withCorrelation(withAuth(handleGetAccessRecord, { roles: AUDIT_ROLES })),
});
