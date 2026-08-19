/**
 * services/users-store.js — App-owned central user database (Story 1.4 / 1.5)
 *
 * Manages the `Users` table that replaces the deploy-managed allowlist as the
 * identity source for email+password login. Passwords are NEVER stored or
 * logged in plaintext: they are hashed with Node's built-in `crypto.scryptSync`
 * using a per-user random salt and stored as `salt:hash` hex. Verification uses
 * `timingSafeEqual`.
 *
 * Schema (PartitionKey 'users', RowKey userId):
 *   name, surname, email (unique, trimmed + lowercase, @uade.edu.ar), role
 *   (student|teacher|director|admin), status (active|disabled), passwordHash,
 *   mustChangePassword, createdAt.
 *
 * Emails are enforced server-side: trim + case-insensitive + unique + domain.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getTableClient } from './storage.js';
import { CONFIG } from './config.js';

export const VALID_ROLES = ['student', 'teacher', 'director', 'admin'];

// Lowercase Users role -> internal (Spanish) role used by backend role checks.
export const INTERNAL_ROLE_BY_ROLE = {
  student: 'Alumno',
  teacher: 'Docente',
  director: 'Director',
  admin: 'Admin',
};

export const FRONTEND_ROLE_BY_INTERNAL = {
  Alumno: 'student',
  Docente: 'teacher',
  Director: 'director',
  Admin: 'admin',
};

export const UADE_EMAIL_DOMAIN = '@uade.edu.ar';

const USERS_TABLE = CONFIG.tables.users;
const USERS_PARTITION = 'users';
const STATUS_ACTIVE = 'active';
const STATUS_DISABLED = 'disabled';

const ensuredTables = new Set();

async function ensureTable() {
  if (ensuredTables.has(USERS_TABLE)) return;
  const client = getTableClient(USERS_TABLE);
  try {
    await client.createTable();
  } catch (err) {
    if (err.statusCode !== 409) throw err;
  }
  ensuredTables.add(USERS_TABLE);
}

function escapeODataValue(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * Normalizes an email for storage/lookup (trim + lowercase).
 * @param {string} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  return String(email == null ? '' : email).trim().toLowerCase();
}

/**
 * True when the email belongs to the institutional @uade.edu.ar domain.
 * @param {string} email
 * @returns {boolean}
 */
export function isUadeEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized.endsWith(UADE_EMAIL_DOMAIN) && normalized.length > UADE_EMAIL_DOMAIN.length;
}

/**
 * Hashes a password with a per-user random salt (scrypt, 64-byte key).
 * @param {string} password
 * @returns {string} `salt:hash` hex
 */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(String(password), salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

/**
 * Constant-time password verification against a stored `salt:hash`.
 * @param {string} password
 * @param {string} stored
 * @returns {boolean}
 */
export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const candidate = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

const RANDOM_PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';

/**
 * Generates a random password (excludes ambiguous chars: 0/O, 1/l, I).
 * @param {number} length
 * @returns {string}
 */
export function generateRandomPassword(length = 12) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += RANDOM_PASSWORD_CHARSET[bytes[i] % RANDOM_PASSWORD_CHARSET.length];
  }
  return out;
}

function toEntity(user) {
  return {
    partitionKey: USERS_PARTITION,
    rowKey: user.userId,
    name: user.name,
    surname: user.surname || '',
    email: user.email,
    passwordHash: user.passwordHash,
    role: user.role,
    status: user.status || STATUS_ACTIVE,
    mustChangePassword: user.mustChangePassword === true,
    createdAt: user.createdAt || new Date().toISOString(),
  };
}

function fromEntity(entity) {
  if (!entity) return null;
  return {
    userId: entity.rowKey,
    name: entity.name,
    surname: entity.surname || '',
    email: entity.email,
    passwordHash: entity.passwordHash,
    role: entity.role,
    status: entity.status || STATUS_ACTIVE,
    mustChangePassword: entity.mustChangePassword === true,
    createdAt: entity.createdAt,
  };
}

function validationError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/**
 * Lists all users (no password hashes exposed).
 * @returns {Promise<Array>}
 */
export async function listUsers() {
  await ensureTable();
  const client = getTableClient(USERS_TABLE);
  const filter = `PartitionKey eq '${USERS_PARTITION}'`;
  const users = [];
  for await (const entity of client.listEntities({ queryOptions: { filter } })) {
    const user = fromEntity(entity);
    if (user) {
      delete user.passwordHash;
      users.push(user);
    }
  }
  users.sort((a, b) => String(a.userId).localeCompare(String(b.userId)));
  return users;
}

/**
 * Resolves a user by its pilot data key (userId / RowKey).
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
export async function getUserById(userId) {
  if (!userId) return null;
  try {
    await ensureTable();
    const client = getTableClient(USERS_TABLE);
    const entity = await client.getEntity(USERS_PARTITION, String(userId));
    return fromEntity(entity);
  } catch (err) {
    if (err.statusCode === 404) return null;
    return null;
  }
}

/**
 * Resolves a user by normalized email (unique).
 * @param {string} email
 * @returns {Promise<Object|null>}
 */
export async function getUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const users = await listUsers();
  return users.find((u) => u.email === normalized) || null;
}

/**
 * Resolves a user by normalized email INCLUDING its passwordHash.
 * Used exclusively by the login path (auth-login) so password verification
 * can run against the stored hash. Never exposed to admin/list surfaces —
 * callers must not return the passwordHash to the client.
 * @param {string} email
 * @returns {Promise<Object|null>} full user including passwordHash
 */
export async function getUserByEmailWithPassword(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  await ensureTable();
  const client = getTableClient(USERS_TABLE);
  const filter = `PartitionKey eq '${USERS_PARTITION}'`;
  for await (const entity of client.listEntities({ queryOptions: { filter } })) {
    const user = fromEntity(entity);
    if (user && user.email === normalized) return user;
  }
  return null;
}

/**
 * Creates a user. Enforces: required fields, valid role, @uade.edu.ar domain,
 * unique email and unique userId.
 * @param {Object} input { userId, name, surname, email, role, password, status?, mustChangePassword? }
 * @returns {Promise<Object>} created user (no passwordHash)
 */
export async function createUser(input = {}) {
  const userId = String(input.userId || '').trim();
  const name = String(input.name || '').trim();
  const surname = String(input.surname || '').trim();
  const email = normalizeEmail(input.email);
  const role = String(input.role || '').trim().toLowerCase();
  const password = String(input.password || '');

  if (!userId) throw validationError(400, 'MISSING_USER_ID', 'userId es requerido.');
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
    throw validationError(400, 'INVALID_USER_ID', 'userId solo puede contener letras, números, guiones y guiones bajos.');
  }
  if (!name) throw validationError(400, 'MISSING_NAME', 'El nombre es requerido.');
  if (!email) throw validationError(400, 'MISSING_EMAIL', 'El email es requerido.');
  if (!password) throw validationError(400, 'MISSING_PASSWORD', 'La contraseña es requerida.');
  if (!isUadeEmail(email)) {
    throw validationError(400, 'EMAIL_DOMAIN_INVALID', `El email debe pertenecer al dominio ${UADE_EMAIL_DOMAIN}.`);
  }
  if (!VALID_ROLES.includes(role)) {
    throw validationError(400, 'INVALID_ROLE', `El rol debe ser uno de: ${VALID_ROLES.join(', ')}.`);
  }

  const existingById = await getUserById(userId);
  if (existingById) {
    throw validationError(409, 'USER_ID_EXISTS', `Ya existe un usuario con el id "${userId}".`);
  }
  const existingByEmail = await getUserByEmail(email);
  if (existingByEmail) {
    throw validationError(409, 'EMAIL_EXISTS', `Ya existe un usuario con el email "${email}".`);
  }

  const user = {
    userId,
    name,
    surname,
    email,
    role,
    passwordHash: hashPassword(password),
    status: input.status === STATUS_DISABLED ? STATUS_DISABLED : STATUS_ACTIVE,
    mustChangePassword: input.mustChangePassword === true,
    createdAt: new Date().toISOString(),
  };

  await ensureTable();
  const client = getTableClient(USERS_TABLE);
  await client.upsertEntity(toEntity(user), 'Replace');
  const { passwordHash, ...publicUser } = user;
  return publicUser;
}

/**
 * Updates a user's editable fields (name, surname, role, status, email).
 * Enforces email domain/unique on change.
 * @param {string} userId
 * @param {Object} updates
 * @returns {Promise<Object>} updated user (no passwordHash)
 */
export async function updateUser(userId, updates = {}) {
  const existing = await getUserById(userId);
  if (!existing) {
    throw validationError(404, 'USER_NOT_FOUND', `No existe un usuario con id "${userId}".`);
  }

  const next = { ...existing };
  if (updates.name !== undefined) {
    const name = String(updates.name).trim();
    if (!name) throw validationError(400, 'MISSING_NAME', 'El nombre es requerido.');
    next.name = name;
  }
  if (updates.surname !== undefined) next.surname = String(updates.surname).trim();
  if (updates.role !== undefined) {
    const role = String(updates.role).trim().toLowerCase();
    if (!VALID_ROLES.includes(role)) {
      throw validationError(400, 'INVALID_ROLE', `El rol debe ser uno de: ${VALID_ROLES.join(', ')}.`);
    }
    next.role = role;
  }
  if (updates.status !== undefined) {
    if (![STATUS_ACTIVE, STATUS_DISABLED].includes(updates.status)) {
      throw validationError(400, 'INVALID_STATUS', 'status debe ser "active" o "disabled".');
    }
    next.status = updates.status;
  }
  if (updates.email !== undefined) {
    const email = normalizeEmail(updates.email);
    if (!isUadeEmail(email)) {
      throw validationError(400, 'EMAIL_DOMAIN_INVALID', `El email debe pertenecer al dominio ${UADE_EMAIL_DOMAIN}.`);
    }
    const byEmail = await getUserByEmail(email);
    if (byEmail && byEmail.userId !== userId) {
      throw validationError(409, 'EMAIL_EXISTS', `Ya existe un usuario con el email "${email}".`);
    }
    next.email = email;
  }
  if (updates.mustChangePassword !== undefined) {
    next.mustChangePassword = updates.mustChangePassword === true;
  }

  await ensureTable();
  const client = getTableClient(USERS_TABLE);
  await client.upsertEntity(toEntity(next), 'Replace');
  const { passwordHash, ...publicUser } = next;
  return publicUser;
}

/**
 * Deletes a user by userId.
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function deleteUser(userId) {
  if (!userId) return false;
  const existing = await getUserById(userId);
  if (!existing) return false;
  await ensureTable();
  const client = getTableClient(USERS_TABLE);
  try {
    await client.deleteEntity(USERS_PARTITION, String(userId));
    return true;
  } catch (err) {
    if (err.statusCode === 404) return false;
    return false;
  }
}

/**
 * Sets a new password hash for a user (self-service change or admin reset).
 * @param {string} userId
 * @param {string} password
 * @param {Object} [options] { mustChangePassword? }
 * @returns {Promise<boolean>}
 */
export async function setUserPassword(userId, password, options = {}) {
  if (!userId || !password) return false;
  const existing = await getUserById(userId);
  if (!existing) return false;
  const next = {
    ...existing,
    passwordHash: hashPassword(password),
    mustChangePassword: options.mustChangePassword === true,
  };
  await ensureTable();
  const client = getTableClient(USERS_TABLE);
  await client.upsertEntity(toEntity(next), 'Replace');
  return true;
}

/**
 * Diagnostic snapshot for tests/scripts. Never exposed to the browser.
 * @returns {Promise<{count: number, roles: Object}>}
 */
export async function getUsersDiagnostics() {
  const users = await listUsers();
  const roles = {};
  for (const user of users) {
    roles[user.role] = (roles[user.role] || 0) + 1;
  }
  return { count: users.length, roles };
}
