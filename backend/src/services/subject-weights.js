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
  const empty = { weights: { ...DEFAULT_WEIGHTS }, defaults: true, updatedBy: null, updatedAt: null, reason: '' };
  if (!subjectId) {
    return empty;
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
    return {
      weights: mergeWeightsWithDefaults(custom),
      defaults: false,
      // UJ-11 paso 6: la decisión tiene que ser revisable por otra persona, así
      // que quién la fijó, cuándo y con qué fundamento viajan con los pesos.
      updatedBy: entity.updatedBy || null,
      updatedAt: entity.updatedAt || null,
      reason: typeof entity.reason === 'string' ? entity.reason : '',
    };
  } catch {
    return empty;
  }
}

function parseStoredWeights(entity) {
  if (!entity) return null;
  const weights = {
    notes: Number(entity.notes),
    bibliography: Number(entity.bibliography),
    transcript: Number(entity.transcript),
    presentation: Number(entity.presentation),
  };
  if (Object.values(weights).some((value) => !Number.isFinite(value))) return null;
  return weights;
}

export async function upsertSubjectWeights(subjectId, weights, updatedBy, reason) {
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

  // Guarda el estado anterior para poder volver atrás con motivo (UJ-11 paso 6).
  let previousWeights = null;
  try {
    previousWeights = parseStoredWeights(await client.getEntity(subjectId, 'weights'));
  } catch {
    previousWeights = null;
  }

  const updatedAt = new Date().toISOString();
  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
  const entity = {
    partitionKey: subjectId,
    rowKey: 'weights',
    notes: merged.notes,
    bibliography: merged.bibliography,
    transcript: merged.transcript,
    presentation: merged.presentation,
    updatedBy: updatedBy || 'unknown',
    updatedAt,
    reason: cleanReason,
  };
  if (previousWeights) entity.previousWeights = JSON.stringify(previousWeights);

  await client.upsertEntity(entity, 'Replace');
  return { weights: merged, defaults: false, updatedBy: entity.updatedBy, updatedAt, reason: cleanReason };
}
