/**
 * services/access-audit-store.js — Rastro de los pedidos de datos (UJ-62 / #456).
 *
 * El recorrido UJ-62 pregunta si el registro alcanza para reconstruir **quién
 * pidió qué, cuándo y desde dónde**, y si el auditor puede **separar lo
 * entregado de lo denegado**. Hasta este módulo no había ninguno de los dos:
 * el pipeline sólo persistía la interacción *contestada* y no-sandbox
 * (`rag-query.js`), sin origen ni correlación, y las denegaciones morían en una
 * línea de `context.log`.
 *
 * Este almacén asienta **un registro por pedido HTTP**, entregado o no:
 *
 *   PartitionKey = `day:AAAA-MM-DD`      (ventana diaria: un rango de fechas es
 *                                         un rango de particiones, sin escanear
 *                                         toda la tabla)
 *   RowKey       = `AAAAMMDD-HHMMSSmmm-<nonce>`  (orden cronológico por texto y
 *                                         citable como id del caso)
 *
 * Reglas del registro:
 *  - **Append-only por construcción**: no hay ninguna ruta de código que
 *    actualice ni borre un asiento. El nonce evita colisiones; un reintento del
 *    mismo pedido deja un asiento propio. La inmutabilidad es del módulo, no del
 *    servicio de tablas (no se declara WORM).
 *  - **El dato pedido se describe, no se copia**: se guarda método, ruta (sin
 *    query string) y los *nombres* de los parámetros de query. Nunca valores de
 *    query, nunca el cuerpo del pedido (leerlo consumiría el stream del handler
 *    y, además, copiaría contenido sensible al rastro).
 *  - **El origen no se inventa**: si la petición no trae `x-azure-clientip` ni
 *    `x-forwarded-for`, el asiento queda con `origin.ip = null`,
 *    `origin.available = false` y una nota. No se rellena con la IP del
 *    servicio ni con un valor por defecto.
 *  - **La retención se declara**: cada asiento lleva el plazo declarado por
 *    este registro (`retention.days`) y si ese plazo está aplicado hoy por
 *    alguna regla (`retention.enforced = false`: la política de retención no
 *    cubre este almacén todavía). No se toca la política existente.
 *  - La escritura es **best-effort**: el rastro no puede tumbar un pedido, pero
 *    el llamador recibe `{ recorded: false, error }` para poder declararlo.
 */

import { randomBytes } from 'node:crypto';
import { getTableClient } from './storage.js';
import { CONFIG } from './config.js';

const TABLE = CONFIG.tables.accessAudit;
const PARTITION_PREFIX = 'day:';

export const ACCESS_OUTCOMES = ['delivered', 'denied', 'error'];

/** Plazo que este registro declara para sí mismo. No es una regla de ciclo de
 *  vida: `enforced: false` hasta que la política de retención lo cubra. */
export const ACCESS_AUDIT_RETENTION_DAYS = (() => {
  const raw = Number(process.env.ACCESS_AUDIT_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 365;
})();

export const LIMIT_DEFAULT = 50;
export const LIMIT_MAX = 500;
/** Días máximos por consulta: una ventana mayor se rechaza en vez de escanear. */
export const WINDOW_MAX_DAYS = 31;
/** Tope de filas leídas por consulta (corta el escaneo aun sin llenar el límite). */
export const SCAN_MAX_ROWS = 5000;

const ensuredTables = new Set();

async function ensureTable() {
  if (ensuredTables.has(TABLE)) return;
  const client = getTableClient(TABLE);
  try {
    await client.createTable();
  } catch (err) {
    if (err.statusCode !== 409) throw err;
  }
  ensuredTables.add(TABLE);
}

/**
 * ¿Hay almacén configurado? Sin credenciales no se intenta la red: el asiento
 * se declara como no escrito en vez de colgar el pedido esperando un timeout.
 */
export function isAuditStorageConfigured() {
  return Boolean(
    process.env.AZURE_STORAGE_CONNECTION_STRING
    || (process.env.AZURE_STORAGE_ACCOUNT_NAME && process.env.AZURE_STORAGE_ACCESS_KEY)
  );
}

export function isAuditTrailEnabled() {
  return String(process.env.ACCESS_AUDIT_ENABLED || 'true').toLowerCase() !== 'false';
}

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

/** Marca temporal compacta y ordenable: 20261020T101530123. */
export function compactStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '00000000T000000000';
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}${pad(d.getUTCMilliseconds(), 3)}`;
  return `${date}T${time}`;
}

/** Día UTC de un instante, en el formato de la partición. */
export function dayKey(iso) {
  return compactStamp(iso).slice(0, 8);
}

export function partitionForDay(iso) {
  const day = dayKey(iso);
  return `${PARTITION_PREFIX}${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}

export function buildAccessRecordId({ at, nonce } = {}) {
  const stamp = compactStamp(at || new Date().toISOString());
  const suffix = nonce || randomBytes(3).toString('hex');
  return `${stamp.slice(0, 8)}-${stamp.slice(9)}-${suffix}`;
}

export function isValidAccessRecordId(recordId) {
  return typeof recordId === 'string' && /^[0-9]{8}-[0-9]{9}-[A-Za-z0-9]{1,32}$/.test(recordId);
}

/** Describe (nunca inventa) el plazo declarado para este almacén. */
export function declaredRetention() {
  return {
    days: ACCESS_AUDIT_RETENTION_DAYS,
    declaredBy: 'access-audit-store',
    enforced: false,
    nota: `El rastro declara ${ACCESS_AUDIT_RETENTION_DAYS} días; la política de retención vigente no le fija plazo todavía, así que el plazo está declarado y no aplicado por ninguna regla.`,
  };
}

function toEntity(entry) {
  const at = entry.at || new Date().toISOString();
  const recordId = isValidAccessRecordId(entry.recordId)
    ? entry.recordId
    : buildAccessRecordId({ at });
  return {
    partitionKey: partitionForDay(at),
    rowKey: recordId,
    at,
    correlationId: entry.correlationId || null,
    surface: entry.surface || null,
    method: entry.request?.method || null,
    path: entry.request?.path || null,
    resource: entry.request?.resource || null,
    queryKeys: entry.request?.queryKeys?.length ? JSON.stringify(entry.request.queryKeys) : null,
    actorId: entry.actor?.id || null,
    actorRole: entry.actor?.role || null,
    actorIdentified: entry.actor?.identified === true,
    outcome: entry.outcome,
    status: Number.isFinite(entry.status) ? entry.status : null,
    denialCode: entry.denial?.code || null,
    denialKind: entry.denial?.kind || null,
    originIp: entry.origin?.ip || null,
    originSource: entry.origin?.source || null,
    originAvailable: entry.origin?.available === true,
    retentionDays: ACCESS_AUDIT_RETENTION_DAYS,
    durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : null,
    bodyCopied: false,
  };
}

function parseList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fromEntity(entity) {
  return {
    recordId: entity.rowKey,
    at: entity.at || null,
    correlationId: entity.correlationId || null,
    surface: entity.surface || null,
    outcome: entity.outcome || null,
    status: entity.status ?? null,
    request: {
      method: entity.method || null,
      path: entity.path || null,
      resource: entity.resource || null,
      queryKeys: parseList(entity.queryKeys),
      // El contenido del pedido no se copia en el rastro: se declara.
      contentCopied: false,
    },
    actor: {
      id: entity.actorId || null,
      role: entity.actorRole || null,
      identified: entity.actorIdentified === true,
    },
    denial: entity.denialCode || entity.denialKind
      ? { code: entity.denialCode || null, kind: entity.denialKind || null }
      : null,
    origin: {
      ip: entity.originIp || null,
      source: entity.originSource || null,
      available: entity.originAvailable === true,
      nota: entity.originAvailable === true ? null : 'origen no disponible: la petición no trajo cabecera de origen',
    },
    retention: { days: entity.retentionDays ?? ACCESS_AUDIT_RETENTION_DAYS, enforced: false },
    durationMs: entity.durationMs ?? null,
  };
}

/**
 * Asienta un pedido de datos. Nunca lanza: devuelve el resultado de la escritura.
 * @param {Object} entry
 *   { at?, correlationId?, surface?, request:{method,path,resource,queryKeys},
 *     actor:{id,role,identified}, outcome, status, denial?, origin?, durationMs? }
 * @returns {Promise<{recorded: boolean, recordId: string|null, error?: string}>}
 */
export async function recordAccess(entry = {}) {
  if (!ACCESS_OUTCOMES.includes(entry.outcome)) {
    return { recorded: false, recordId: null, error: `outcome inválido: ${entry.outcome}` };
  }
  if (!entry.request?.path && !entry.surface) {
    return { recorded: false, recordId: null, error: 'el asiento necesita al menos ruta o superficie' };
  }
  if (!isAuditStorageConfigured()) {
    return { recorded: false, recordId: null, error: 'sin almacén de auditoría configurado' };
  }
  let entity;
  try {
    entity = toEntity(entry);
    await ensureTable();
    const client = getTableClient(TABLE);
    await client.upsertEntity(entity, 'Replace');
    return { recorded: true, recordId: entity.rowKey };
  } catch (err) {
    return { recorded: false, recordId: entity?.rowKey || null, error: err?.message || 'no se pudo asentar el pedido' };
  }
}

/** Lee un asiento por su id (el id arranca con el día, así que ubica la partición). */
export async function getAccessRecord(recordId) {
  if (!isValidAccessRecordId(recordId)) {
    return { record: null, error: 'recordId inválido' };
  }
  if (!isAuditStorageConfigured()) {
    return { record: null, error: 'sin almacén de auditoría configurado' };
  }
  try {
    await ensureTable();
    const client = getTableClient(TABLE);
    const day = `${recordId.slice(0, 4)}-${recordId.slice(4, 6)}-${recordId.slice(6, 8)}`;
    const entity = await client.getEntity(`${PARTITION_PREFIX}${day}`, recordId);
    return { record: fromEntity(entity), error: null };
  } catch (err) {
    if (err?.statusCode === 404) return { record: null, error: null };
    return { record: null, error: err?.message || 'no se pudo leer el asiento' };
  }
}

function* daysDescending(fromIso, toIso) {
  const cursor = new Date(`${toIso.slice(0, 10)}T00:00:00.000Z`);
  const floor = new Date(`${fromIso.slice(0, 10)}T00:00:00.000Z`);
  while (cursor.getTime() >= floor.getTime()) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
}

function matches(record, filters) {
  if (filters.outcome && record.outcome !== filters.outcome) return false;
  if (filters.correlationId && record.correlationId !== filters.correlationId) return false;
  if (filters.surface && record.surface !== filters.surface) return false;
  if (filters.actor) {
    const actor = (record.actor?.id || '').toLowerCase();
    if (actor !== filters.actor.toLowerCase()) return false;
  }
  return true;
}

/**
 * Lista el rastro del más reciente al más viejo, con filtros y paginación.
 *
 * @param {Object} filters
 *   { from, to, outcome?, correlationId?, actor?, surface?, limit?, cursor? }
 *   `from`/`to` son ISO o `AAAA-MM-DD`; por defecto, las últimas 24 h.
 * @returns {Promise<{records: Array, count: number, totals: Object, window: Object,
 *                    cursor: string|null, scannedRows: number, truncated: boolean,
 *                    error: string|null}>}
 */
export async function listAccessRecords(filters = {}) {
  const empty = {
    records: [], count: 0, totals: { delivered: 0, denied: 0, error: 0 }, window: null,
    cursor: null, scannedRows: 0, truncated: false, error: null,
  };
  const to = filters.to || new Date().toISOString();
  const from = filters.from || new Date(Date.parse(to) - 24 * 60 * 60 * 1000).toISOString();
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return { ...empty, error: 'ventana inválida: from/to tienen que ser fechas' };
  }
  if (Date.parse(from) > Date.parse(to)) {
    return { ...empty, error: 'ventana inválida: from es posterior a to' };
  }
  const spanDays = Math.ceil((Date.parse(to) - Date.parse(from)) / (24 * 60 * 60 * 1000)) + 1;
  if (spanDays > WINDOW_MAX_DAYS) {
    return { ...empty, error: `ventana demasiado amplia: máximo ${WINDOW_MAX_DAYS} días (pedida: ${spanDays})` };
  }
  const limit = Math.min(Math.max(Number(filters.limit) || LIMIT_DEFAULT, 1), LIMIT_MAX);
  if (filters.outcome && !ACCESS_OUTCOMES.includes(filters.outcome)) {
    return { ...empty, error: `outcome inválido: usá ${ACCESS_OUTCOMES.join(', ')}` };
  }
  if (!isAuditStorageConfigured()) {
    return { ...empty, error: 'sin almacén de auditoría configurado: el rastro no se puede leer' };
  }

  const cursor = isValidAccessRecordId(filters.cursor) ? filters.cursor : null;
  const records = [];
  let scannedRows = 0;
  let truncated = false;
  let nextCursor = null;

  try {
    await ensureTable();
    const client = getTableClient(TABLE);
    for (const day of daysDescending(from, to)) {
      const filter = `PartitionKey eq '${PARTITION_PREFIX}${day}'`;
      const dayRows = [];
      for await (const entity of client.listEntities({ queryOptions: { filter } })) {
        dayRows.push(entity);
        scannedRows += 1;
        if (scannedRows >= SCAN_MAX_ROWS) { truncated = true; break; }
      }
      dayRows.sort((a, b) => String(b.rowKey).localeCompare(String(a.rowKey)));
      for (const entity of dayRows) {
        const record = fromEntity(entity);
        if (cursor) {
          // La página siguiente arranca después del último asiento entregado.
          if (record.recordId.localeCompare(cursor) >= 0) continue;
        }
        if (record.at) {
          if (Date.parse(record.at) > Date.parse(to)) continue;
          if (Date.parse(record.at) < Date.parse(from)) continue;
        }
        if (!matches(record, filters)) continue;
        records.push(record);
        if (records.length === limit) { nextCursor = record.recordId; break; }
      }
      if (records.length === limit || truncated) break;
    }
  } catch (err) {
    return { ...empty, window: { from, to }, error: err?.message || 'no se pudo leer el rastro' };
  }

  const totals = {
    delivered: records.filter((r) => r.outcome === 'delivered').length,
    denied: records.filter((r) => r.outcome === 'denied').length,
    error: records.filter((r) => r.outcome === 'error').length,
  };

  return {
    records,
    count: records.length,
    totals,
    window: { from, to },
    cursor: nextCursor,
    scannedRows,
    truncated,
    error: null,
  };
}
