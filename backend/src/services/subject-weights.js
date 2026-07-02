import { getTableClient } from './storage.js';
import { CONFIG } from '../config.js';

const SUBJECT_WEIGHTS_TABLE = CONFIG.tables.subjectWeights;

export const DEFAULT_WEIGHTS = { ...CONFIG.materialWeights };

const WEIGHT_MIN = CONFIG.weightMin;
const WEIGHT_MAX = CONFIG.weightMax;
const VALID_TYPES = new Set(Object.keys(DEFAULT_WEIGHTS));

function ensureWeight(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < WEIGHT_MIN || num > WEIGHT_MAX) return null;
  return Math.round(num * 100) / 100;
}

export function validateWeights(weights) {
  if (!weights || typeof weights !== 'object') {
    return { valid: false, error: 'Se requieren pesos en formato objeto JSON.' };
  }
  const keys = Object.keys(weights);
  if (keys.length === 0) {
    return { valid: false, error: 'Debe especificar al menos un tipo de material.' };
  }
  for (const key of keys) {
    if (!VALID_TYPES.has(key)) {
      return { valid: false, error: `Tipo de material inválido: "${key}". Válidos: ${[...VALID_TYPES].join(', ')}.` };
    }
    const validated = ensureWeight(weights[key]);
    if (validated === null) {
      return { valid: false, error: `Peso inválido para "${key}": debe ser un número entre ${WEIGHT_MIN} y ${WEIGHT_MAX}.` };
    }
    weights[key] = validated;
  }
  return { valid: true, error: null };
}

export function mergeWeightsWithDefaults(custom) {
  if (!custom || typeof custom !== 'object') return { ...DEFAULT_WEIGHTS };
  const merged = { ...DEFAULT_WEIGHTS };
  for (const key of VALID_TYPES) {
    const val = ensureWeight(custom[key]);
    if (val !== null) merged[key] = val;
  }
  return merged;
}

export async function getSubjectWeights(subjectId) {
  if (!subjectId) {
    return { weights: { ...DEFAULT_WEIGHTS }, defaults: true };
  }
  const client = getTableClient(SUBJECT_WEIGHTS_TABLE);
  try {
    const entity = await client.getEntity(subjectId, 'weights');
    const custom = {
      notes: entity.notes,
      bibliography: entity.bibliography,
      transcript: entity.transcript,
      presentation: entity.presentation,
    };
    return { weights: mergeWeightsWithDefaults(custom), defaults: false };
  } catch {
    return { weights: { ...DEFAULT_WEIGHTS }, defaults: true };
  }
}

export async function upsertSubjectWeights(subjectId, weights, updatedBy) {
  if (!subjectId) throw new Error('subjectId es requerido.');
  const validation = validateWeights(weights);
  if (!validation.valid) throw new Error(validation.error);

  const merged = mergeWeightsWithDefaults(weights);
  const client = getTableClient(SUBJECT_WEIGHTS_TABLE);
  try {
    await client.createTable();
  } catch (err) {
    if (err.statusCode !== 409) throw err;
  }
  await client.upsertEntity({
    partitionKey: subjectId,
    rowKey: 'weights',
    notes: merged.notes,
    bibliography: merged.bibliography,
    transcript: merged.transcript,
    presentation: merged.presentation,
    updatedBy: updatedBy || 'unknown',
    updatedAt: new Date().toISOString(),
  }, 'Replace');
  return { weights: merged, defaults: false };
}
