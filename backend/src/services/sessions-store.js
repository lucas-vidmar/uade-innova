/**
 * services/sessions-store.js — Opaque session tokens (Story 1.1a / 1.5)
 *
 * Opaque bearer tokens are generated with `crypto.randomBytes(32)` and stored in
 * the `Sessions` table (PartitionKey 'Sessions', RowKey token) with an expiry.
 * They are sent by the client as `Authorization: Bearer <token>`.
 *
 * Fail closed: an unknown or expired token resolves to null.
 */

import { randomBytes } from 'node:crypto';
import { getTableClient } from './storage.js';
import { CONFIG } from './config.js';

const SESSIONS_TABLE = CONFIG.tables.sessions;
const SESSIONS_PARTITION = 'Sessions';

const ensuredTables = new Set();

async function ensureTable() {
  if (ensuredTables.has(SESSIONS_TABLE)) return;
  const client = getTableClient(SESSIONS_TABLE);
  try {
    await client.createTable();
  } catch (err) {
    if (err.statusCode !== 409) throw err;
  }
  ensuredTables.add(SESSIONS_TABLE);
}

function escapeODataValue(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * Generates a fresh opaque session token (64 hex chars).
 * @returns {string}
 */
export function generateSessionToken() {
  return randomBytes(32).toString('hex');
}

/**
 * Creates a session for a user.
 * @param {string} userId
 * @param {Object} [options] { ttlMs? }
 * @returns {Promise<{token: string, userId: string, expiresAt: string}>}
 */
export async function createSession(userId, options = {}) {
  const token = generateSessionToken();
  const now = Date.now();
  const ttlMs = Number(options.ttlMs) || Number(CONFIG.auth?.sessionTtlMs) || 7 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(now + ttlMs).toISOString();
  const entity = {
    partitionKey: SESSIONS_PARTITION,
    rowKey: token,
    userId,
    expiresAt,
    createdAt: new Date(now).toISOString(),
  };

  await ensureTable();
  const client = getTableClient(SESSIONS_TABLE);
  await client.upsertEntity(entity, 'Replace');
  return { token, userId, expiresAt };
}

/**
 * Resolves a session by token. Expired or unknown tokens resolve to null.
 * @param {string} token
 * @returns {Promise<{token: string, userId: string, expiresAt: string}|null>}
 */
export async function getSession(token) {
  if (!token) return null;
  try {
    await ensureTable();
    const client = getTableClient(SESSIONS_TABLE);
    const entity = await client.getEntity(SESSIONS_PARTITION, String(token));
    if (!entity) return null;
    const expires = new Date(entity.expiresAt).getTime();
    if (!Number.isFinite(expires) || expires < Date.now()) return null;
    return {
      token: entity.rowKey,
      userId: entity.userId,
      expiresAt: entity.expiresAt,
    };
  } catch (err) {
    if (err.statusCode === 404) return null;
    // Storage unavailable / table not created: fail closed (no session).
    return null;
  }
}

/**
 * Deletes a session by token (logout / revocation).
 * @param {string} token
 * @returns {Promise<boolean>}
 */
export async function deleteSession(token) {
  if (!token) return false;
  try {
    await ensureTable();
    const client = getTableClient(SESSIONS_TABLE);
    await client.deleteEntity(SESSIONS_PARTITION, String(token));
    return true;
  } catch (err) {
    if (err.statusCode === 404) return false;
    return false;
  }
}

/**
 * Deletes every session of a user (used on password change / user deletion).
 * @param {string} userId
 * @param {string} [exceptToken] token to keep (the caller's current session)
 * @returns {Promise<number>} number of sessions deleted
 */
export async function deleteSessionsForUser(userId, exceptToken) {
  if (!userId) return 0;
  try {
    await ensureTable();
    const client = getTableClient(SESSIONS_TABLE);
    const filter = `userId eq '${escapeODataValue(userId)}'`;
    let deleted = 0;
    for await (const entity of client.listEntities({ queryOptions: { filter } })) {
      if (entity.rowKey === exceptToken) continue;
      try {
        await client.deleteEntity(entity.partitionKey, entity.rowKey);
        deleted += 1;
      } catch {
        // best-effort per session
      }
    }
    return deleted;
  } catch {
    return 0;
  }
}
