/**
 * services/deletion-audit-store.js — Constancia del borrado de materiales
 * (UJ-56 pasos 4, 7 y 9).
 *
 * Hasta ahora el borrado de un material sólo devolvía `{success, softDeleted,
 * chunkCount}`: no quedaba registro de **qué** se borró, **cuándo**, **quién lo
 * pidió** ni **con qué alcance**, y el rol que responde por el cumplimiento no
 * tenía dónde leerlo. El precedente es la purga de índice (#452), que sí deja
 * un registro en `vector-quarantine/`.
 *
 * Cada borrado deja un JSON append-only en el contenedor `compliance`:
 *
 *   deletions/{recordId}.json
 *
 * El `recordId` arranca con la fecha compacta (`AAAAMMDDTHHMMSSmmm`), así que
 * ordenar por nombre ordena cronológicamente y un tercero puede citar el caso
 * por su id. El registro nunca incluye credenciales ni el contenido del
 * material: sólo metadatos de alcance, responsable y resultado.
 *
 * La escritura es **best-effort**: si Storage falla, el borrado no se revierte
 * (el material ya está fuera del acervo y del índice), pero el llamador recibe
 * `{ recorded: false, error }` y el endpoint lo expone en su respuesta. El
 * registro tampoco puede impedir un borrado pedido por un responsable.
 */

import { randomBytes } from 'node:crypto';
import { saveJson, loadJson, listBlobs } from './storage.js';
import { CONFIG } from './config.js';

const CONTAINER = CONFIG.containers.compliance;
const POLICY_BLOB = 'retention-policy.json';
const PREFIX = 'deletions/';

/** Días que el lifecycle deja vivo un blob en `deleted/`
 *  (`infra/modules/storage.bicep` → regla `DeleteDeletedMaterialsAfter30Days`).
 *  Se registra tal cual para que la constancia muestre el residuo real frente a
 *  lo que declara la política; cambiarlo es decisión de política, no de este
 *  módulo. */
export const DELETED_CONTAINER_PURGE_DAYS = 30;

export const DELETION_OUTCOMES = ['deleted', 'already-absent', 'partial', 'failed'];

const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 200;

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

/** Marca temporal compacta y ordenable: 20261019T224710610. */
function compactStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '00000000T000000000';
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
  ].join('') + 'T' + [
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds()),
    pad(d.getUTCMilliseconds(), 3),
  ].join('');
}

function safeSegment(value, max = 80) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);
}

export function buildDeletionRecordId({ requestedAt, materialId, nonce } = {}) {
  const stamp = compactStamp(requestedAt || new Date().toISOString());
  const material = safeSegment(materialId) || 'material';
  const suffix = nonce || randomBytes(3).toString('hex');
  return `${stamp}-${material}-${suffix}`;
}

export function isValidDeletionRecordId(recordId) {
  return typeof recordId === 'string' && /^[A-Za-z0-9_-]{6,200}$/.test(recordId);
}

/** Días de soft-delete que declara la política vigente (7 por defecto). */
export async function readDeclaredSoftDeleteDays() {
  try {
    const policy = await loadJson(CONTAINER, POLICY_BLOB);
    const days = Number(policy?.softDeleteDays);
    return Number.isFinite(days) && days >= 0 ? days : 7;
  } catch {
    return 7;
  }
}

/**
 * Persiste la constancia de un intento de borrado (autorizado).
 * @param {Object} entry
 *   { target: {materialId, subjectId, filename, materialType, classIds, uploadedBy, fileSize},
 *     requestedAt, completedAt, outcome, actor, authorization, scope, retention, correlationId }
 * @returns {Promise<{recorded: boolean, recordId: string, error?: string}>}
 */
export async function recordMaterialDeletion(entry = {}) {
  const materialId = String(entry?.target?.materialId || '').trim();
  if (!materialId) {
    return { recorded: false, recordId: null, error: 'target.materialId es requerido' };
  }
  const requestedAt = entry.requestedAt || new Date().toISOString();
  const recordId = isValidDeletionRecordId(entry.recordId)
    ? entry.recordId
    : buildDeletionRecordId({ requestedAt, materialId });

  const record = {
    recordId,
    action: 'material-delete',
    requestedAt,
    completedAt: entry.completedAt || new Date().toISOString(),
    outcome: DELETION_OUTCOMES.includes(entry.outcome) ? entry.outcome : 'deleted',
    actor: entry.actor || null,
    authorization: entry.authorization || null,
    target: {
      materialId,
      subjectId: entry?.target?.subjectId || null,
      filename: entry?.target?.filename || null,
      materialType: entry?.target?.materialType || null,
      classIds: Array.isArray(entry?.target?.classIds) ? entry.target.classIds : [],
      uploadedBy: entry?.target?.uploadedBy || null,
      fileSize: Number(entry?.target?.fileSize) || 0,
    },
    scope: {
      blobsMoved: Array.isArray(entry?.scope?.blobsMoved) ? entry.scope.blobsMoved : [],
      chunkCount: Number(entry?.scope?.chunkCount) || 0,
      vectorsDeleted: entry?.scope?.vectorsDeleted === true,
      stateDeleted: entry?.scope?.stateDeleted === true,
      quotaReleased: entry?.scope?.quotaReleased === true,
      errors: Array.isArray(entry?.scope?.errors) ? entry.scope.errors : [],
    },
    retention: {
      container: 'deleted',
      declaredDays: Number(entry?.retention?.declaredDays) || 7,
      containerPurgeDays: DELETED_CONTAINER_PURGE_DAYS,
    },
    correlationId: entry.correlationId || null,
    version: 1,
  };

  try {
    await saveJson(CONTAINER, `${PREFIX}${recordId}.json`, record);
    return { recorded: true, recordId };
  } catch (err) {
    return { recorded: false, recordId, error: err?.message || 'no se pudo escribir la constancia' };
  }
}

/**
 * Lee una constancia por id. Devuelve null si no existe o el id no es válido.
 * @param {string} recordId
 * @returns {Promise<object|null>}
 */
export async function getMaterialDeletion(recordId) {
  if (!isValidDeletionRecordId(recordId)) return null;
  const record = await loadJson(CONTAINER, `${PREFIX}${encodeURIComponent(recordId)}.json`);
  return record && record.action === 'material-delete' ? record : null;
}

/**
 * Lista constancias, de la más reciente a la más vieja.
 * @param {{materialId?: string, subjectId?: string, limit?: number}} [filters]
 * @returns {Promise<Array>}
 */
export async function listMaterialDeletions(filters = {}) {
  const limit = Math.min(
    Math.max(Number(filters.limit) || LIMIT_DEFAULT, 1),
    LIMIT_MAX
  );
  let names = [];
  try {
    names = await listBlobs(CONTAINER, PREFIX);
  } catch {
    return [];
  }
  const records = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const record = await loadJson(CONTAINER, name);
    if (!record || record.action !== 'material-delete') continue;
    if (filters.materialId && record?.target?.materialId !== filters.materialId) continue;
    if (filters.subjectId && record?.target?.subjectId !== filters.subjectId) continue;
    records.push(record);
  }
  records.sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
  return records.slice(0, limit);
}

/** Expuesto para diagnóstico/tests: prefijo de los blobs de constancia. */
export const DELETION_RECORD_PREFIX = PREFIX;
