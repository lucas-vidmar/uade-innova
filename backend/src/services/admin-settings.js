/**
 * services/admin-settings.js — Admin configuration persistence (Story 10.19)
 *
 * Source of truth for the admin settings surfaces (`Configuración Técnica`,
 * `Configuración del Modelo de IA`, `Políticas de Retención`). Pure validation
 * + defaults live here; runtime overrides are merged over the compile-time
 * `CONFIG` defaults and persisted to Table Storage (`AdminSettings`) mirroring
 * `subject-weights.js`.
 */

import { getTableClient } from './storage.js';
import { CONFIG } from '../config.js';

const ADMIN_SETTINGS_TABLE = CONFIG.tables.adminSettings;

export const ALLOWED_MODELS = ['deepseek-v4-flash', 'gpt-4o-mini'];

export const VALID_SCOPES = ['technical', 'model'];

export const DEFAULT_TECH_SETTINGS = {
  retentionDays: 90,
  containerName: 'class-materials',
  maxFileSizeMb: 50,
  autoCleanup: true,
  optimizeImages: true,
};

export const DEFAULT_MODEL_CONFIG = {
  model: 'deepseek-v4-flash',
  temperature: 0.3,
  maxTokens: 2048,
  topP: 0.95,
  embeddingModel: 'text-embedding-3-small',
};

export const DEFAULT_RETENTION_POLICY = {
  archiveEnabled: true,
  archiveDays: 730,
  deleteEnabled: true,
  // deleteDays must be > archiveDays when archiveEnabled (AC #2 / QA-006).
  // The old contradictory defaults (delete 365 < archive 730) are fixed here.
  deleteDays: 1095,
  notifyTeachers: true,
  autoDelete: true,
};

const SCOPE_DEFAULTS = {
  technical: DEFAULT_TECH_SETTINGS,
  model: DEFAULT_MODEL_CONFIG,
};

// Controls that are disabled/labeled prototype in the UI (AC #3) must never be
// persisted. They appear only from defaults (for display) and are stripped from
// any client-supplied values before storage.
const NON_PERSISTED_KEYS = {
  technical: ['containerName'],
  model: ['embeddingModel'],
};

function getDefaultsForScope(scope) {
  return SCOPE_DEFAULTS[scope] || null;
}

function isBool(value) {
  return typeof value === 'boolean';
}

function isValidNumber(value, min, max) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return false;
    value = Number(trimmed);
    if (!Number.isFinite(value)) return false;
  } else {
    return false;
  }
  return value >= min && value <= max;
}

export class AdminSettingsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminSettingsValidationError';
  }
}

export function validateTechSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    return { valid: false, error: 'Se requieren ajustes técnicos en formato objeto JSON.' };
  }
  const keys = ['retentionDays', 'maxFileSizeMb', 'autoCleanup', 'optimizeImages'];
  for (const key of keys) {
    if (!(key in settings)) {
      return { valid: false, error: `El campo "${key}" es requerido.` };
    }
  }
  if (!isValidNumber(settings.retentionDays, 1, 365)) {
    return { valid: false, error: 'retentionDays debe ser un número entre 1 y 365.' };
  }
  if (!isValidNumber(settings.maxFileSizeMb, 1, 500)) {
    return { valid: false, error: 'maxFileSizeMb debe ser un número entre 1 y 500.' };
  }
  if (!isBool(settings.autoCleanup)) {
    return { valid: false, error: 'autoCleanup debe ser un booleano.' };
  }
  if (!isBool(settings.optimizeImages)) {
    return { valid: false, error: 'optimizeImages debe ser un booleano.' };
  }
  settings.retentionDays = Math.round(Number(settings.retentionDays));
  settings.maxFileSizeMb = Math.round(Number(settings.maxFileSizeMb));
  return { valid: true, error: null };
}

export function validateModelConfig(config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'Se requiere configuración de modelo en formato objeto JSON.' };
  }
  const keys = ['model', 'temperature', 'maxTokens', 'topP'];
  for (const key of keys) {
    if (!(key in config)) {
      return { valid: false, error: `El campo "${key}" es requerido.` };
    }
  }
  if (!ALLOWED_MODELS.includes(config.model)) {
    return { valid: false, error: `Modelo inválido: "${config.model}". Válidos: ${ALLOWED_MODELS.join(', ')}.` };
  }
  if (!isValidNumber(config.temperature, 0, 1)) {
    return { valid: false, error: 'temperature debe ser un número entre 0 y 1.' };
  }
  if (!isValidNumber(config.topP, 0, 1)) {
    return { valid: false, error: 'topP debe ser un número entre 0 y 1.' };
  }
  if (!isValidNumber(config.maxTokens, 256, 8192)) {
    return { valid: false, error: 'maxTokens debe ser un número entre 256 y 8192.' };
  }
  config.temperature = Number(config.temperature);
  config.topP = Number(config.topP);
  config.maxTokens = Math.round(Number(config.maxTokens));
  return { valid: true, error: null };
}

export function validateRetentionPolicy(policy) {
  if (!policy || typeof policy !== 'object') {
    return { valid: false, error: 'Se requiere política de retención en formato objeto JSON.' };
  }
  const keys = ['archiveEnabled', 'archiveDays', 'deleteEnabled', 'deleteDays', 'notifyTeachers', 'autoDelete'];
  for (const key of keys) {
    if (!(key in policy)) {
      return { valid: false, error: `El campo "${key}" es requerido.` };
    }
  }
  if (!isBool(policy.archiveEnabled)) {
    return { valid: false, error: 'archiveEnabled debe ser un booleano.' };
  }
  if (!isBool(policy.deleteEnabled)) {
    return { valid: false, error: 'deleteEnabled debe ser un booleano.' };
  }
  if (!isBool(policy.notifyTeachers)) {
    return { valid: false, error: 'notifyTeachers debe ser un booleano.' };
  }
  if (!isBool(policy.autoDelete)) {
    return { valid: false, error: 'autoDelete debe ser un booleano.' };
  }
  if (!isValidNumber(policy.archiveDays, 1, 3650)) {
    return { valid: false, error: 'archiveDays debe ser un número entre 1 y 3650.' };
  }
  if (!isValidNumber(policy.deleteDays, 1, 3650)) {
    return { valid: false, error: 'deleteDays debe ser un número entre 1 y 3650.' };
  }
  policy.archiveDays = Math.round(Number(policy.archiveDays));
  policy.deleteDays = Math.round(Number(policy.deleteDays));
  // Cross-field rule (AC #2 / QA-006): permanent deletion must occur AFTER
  // cold archiving when archiving is enabled.
  if (policy.archiveEnabled && policy.deleteDays <= policy.archiveDays) {
    return {
      valid: false,
      error: `deleteDays (${policy.deleteDays}) debe ser mayor que archiveDays (${policy.archiveDays}) cuando el archivado está habilitado.`,
    };
  }
  return { valid: true, error: null };
}

function validateScope(scope, values) {
  switch (scope) {
    case 'technical':
      return validateTechSettings(values);
    case 'model':
      return validateModelConfig(values);
    default:
      return { valid: false, error: `Scope inválido: "${scope}". Válidos: ${VALID_SCOPES.join(', ')}.` };
  }
}

/**
 * Merges a custom (persisted) settings object over the scope defaults,
 * mirroring `mergeWeightsWithDefaults` in `subject-weights.js`.
 * @param {string} scope
 * @param {object|null} custom
 * @returns {object} full merged settings object
 */
export function mergeWithDefaults(scope, custom) {
  const defaults = getDefaultsForScope(scope);
  if (!defaults) return null;
  if (!custom || typeof custom !== 'object') return { ...defaults };
  const merged = { ...defaults };
  const nonPersisted = NON_PERSISTED_KEYS[scope] || [];
  for (const key of Object.keys(defaults)) {
    if (custom[key] !== undefined && !nonPersisted.includes(key)) merged[key] = custom[key];
  }
  return merged;
}

function stripNonPersisted(scope, obj) {
  const nonPersisted = NON_PERSISTED_KEYS[scope] || [];
  const out = { ...obj };
  for (const key of nonPersisted) delete out[key];
  return out;
}

/**
 * Reads the persisted admin settings for a scope. Falls back to defaults when
 * nothing is stored yet or the scope is unknown.
 * @param {string} scope - 'technical' | 'model'
 */
export async function getAdminSettings(scope) {
  const defaults = getDefaultsForScope(scope);
  if (!defaults) {
    return { data: null, defaults: true, updatedAt: null, updatedBy: null };
  }
  const client = getTableClient(ADMIN_SETTINGS_TABLE);
  try {
    const entity = await client.getEntity(scope, 'config');
    const custom = {};
    for (const key of Object.keys(defaults)) {
      if (entity[key] !== undefined) custom[key] = entity[key];
    }
    return {
      data: mergeWithDefaults(scope, custom),
      defaults: Object.keys(custom).length === 0,
      updatedAt: entity.updatedAt || null,
      updatedBy: entity.updatedBy || null,
    };
  } catch (err) {
    // Only a missing entity (404) means "not configured yet". Any other failure
    // (auth/network/5xx/malformed entity) must surface so the GET endpoint can
    // return 500 instead of silently masking real config as defaults.
    if (err && err.statusCode === 404) {
      return { data: { ...defaults }, defaults: true, updatedAt: null, updatedBy: null };
    }
    throw err;
  }
}

/**
 * Validates and persists admin settings for a scope, returning the readback
 * object (post-write value) so the client can re-render without a second GET.
 * @param {string} scope
 * @param {object} values
 * @param {string} updatedBy
 */
export async function upsertAdminSettings(scope, values, updatedBy) {
  const validation = validateScope(scope, values);
  if (!validation.valid) throw new AdminSettingsValidationError(validation.error);

  const merged = mergeWithDefaults(scope, values);
  const client = getTableClient(ADMIN_SETTINGS_TABLE);
  try {
    await client.createTable();
  } catch (err) {
    if (err.statusCode !== 409) throw err;
  }
  const now = new Date().toISOString();
  const by = updatedBy || 'unknown';
  const entity = {
    partitionKey: scope,
    rowKey: 'config',
    ...stripNonPersisted(scope, merged),
    updatedBy: by,
    updatedAt: now,
  };
  await client.upsertEntity(entity, 'Replace');
  return { data: merged, defaults: false, updatedAt: now, updatedBy: by };
}

/**
 * Resets the persisted admin settings for a scope (restore defaults).
 * @param {string} scope
 */
export async function resetAdminSettings(scope) {
  if (!getDefaultsForScope(scope)) {
    throw new AdminSettingsValidationError(`Scope inválido: "${scope}". Válidos: ${VALID_SCOPES.join(', ')}.`);
  }
  const client = getTableClient(ADMIN_SETTINGS_TABLE);
  try {
    await client.deleteEntity(scope, 'config');
  } catch (err) {
    // 404 (no such entity) and 412 (condition) are benign — treat as already reset.
    if (err.statusCode !== 404 && err.statusCode !== 412) throw err;
  }
  return getAdminSettings(scope);
}
