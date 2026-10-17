/**
 * services/identity-audit-store.js — Constancia de los cambios de identidad
 * (UJ-52 paso 9).
 *
 * El corte de acceso tiene que quedar asentado con **fecha, motivo y alcance**,
 * de modo que alguien que no participó pueda reconstruir qué se cerró, cuándo y
 * por qué. Hasta ahora la única huella de un alta, una baja o un reseteo era el
 * log del servicio (efímero, no consultable, sin motivo ni alcance).
 *
 * Registro **append-only** en la tabla `IdentityAudit`:
 *   PartitionKey = `user:{userId}` (la persona afectada)
 *   RowKey       = `{at}__{action}__{sufijo}` (orden cronológico por texto)
 *
 * Campos: at, actor, actorRole, action, target, targetEmail, reason,
 * before, after, scope. Nunca se guarda nada secreto (ni contraseñas ni
 * tokens): sólo qué cambió, quién lo hizo, cuándo, por qué y con qué alcance.
 */

import { randomBytes } from 'node:crypto';
import { getTableClient } from './storage.js';
import { CONFIG } from './config.js';

const TABLE = CONFIG.tables.identityAudit;
const PARTITION_PREFIX = 'user:';

export const IDENTITY_ACTIONS = ['create', 'update', 'disable', 'enable', 'delete', 'reset-password'];

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

function suffix() {
  return randomBytes(4).toString('hex');
}

function toEntity(entry) {
  return {
    partitionKey: `${PARTITION_PREFIX}${entry.target}`,
    rowKey: `${entry.at}__${entry.action}__${suffix()}`,
    at: entry.at,
    actor: entry.actor || null,
    actorRole: entry.actorRole || null,
    action: entry.action,
    target: entry.target,
    targetEmail: entry.targetEmail || null,
    reason: entry.reason || null,
    before: entry.before ? JSON.stringify(entry.before) : null,
    after: entry.after ? JSON.stringify(entry.after) : null,
    scope: entry.scope ? JSON.stringify(entry.scope) : null,
  };
}

function fromEntity(entity) {
  const parse = (value) => {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };
  return {
    at: entity.at || String(entity.rowKey || '').split('__')[0] || null,
    actor: entity.actor || null,
    actorRole: entity.actorRole || null,
    action: entity.action,
    target: entity.target,
    targetEmail: entity.targetEmail || null,
    reason: entity.reason || null,
    before: parse(entity.before),
    after: parse(entity.after),
    scope: parse(entity.scope),
    // Conveniencia para la lectura: el motivo del corte, si lo hay.
    registro: entity.rowKey,
  };
}

/**
 * Asienta un cambio de identidad. Best-effort por diseño: la constancia no
 * puede impedir el cambio, pero el llamador tiene que poder saber si falló.
 * @param {Object} entry { target, action, actor?, actorRole?, targetEmail?, reason?, before?, after?, scope? }
 * @returns {Promise<{recorded: boolean, at?: string, error?: string}>}
 */
export async function recordIdentityChange(entry = {}) {
  const target = String(entry.target || '').trim();
  const action = String(entry.action || '').trim();
  if (!target || !IDENTITY_ACTIONS.includes(action)) {
    return { recorded: false, error: 'target y action válidos son requeridos' };
  }
  const at = entry.at || new Date().toISOString();
  try {
    await ensureTable();
    const client = getTableClient(TABLE);
    const entity = toEntity({ ...entry, target, action, at });
    await client.upsertEntity(entity, 'Replace');
    return { recorded: true, at, registro: entity.rowKey };
  } catch (err) {
    return { recorded: false, error: err?.message || 'no se pudo asentar el cambio' };
  }
}

/**
 * Lee la constancia de una persona, de la más reciente a la más vieja.
 * @param {string} userId
 * @returns {Promise<Array>}
 */
export async function listIdentityChanges(userId) {
  const target = String(userId || '').trim();
  if (!target) return [];
  try {
    await ensureTable();
    const client = getTableClient(TABLE);
    const filter = `PartitionKey eq '${PARTITION_PREFIX}${target.replace(/'/g, "''")}'`;
    const rows = [];
    for await (const entity of client.listEntities({ queryOptions: { filter } })) {
      rows.push(fromEntity(entity));
    }
    rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return rows;
  } catch {
    return [];
  }
}
