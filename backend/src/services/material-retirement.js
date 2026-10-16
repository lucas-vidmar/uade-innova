/**
 * #391 — Retirar una fuente sin borrarla.
 *
 * Hasta ahora la única palanca por material era `priority` ('primary' |
 * 'secondary'), que **pondera** el puntaje pero nunca excluye: con `secondary` la
 * fuente vieja se seguía citando, y la única forma de sacarla de las respuestas
 * era borrarla, perdiendo el antecedente. `retirementState` es un estado propio
 * del material ('activa' | 'retirada'): deja de citarse en las respuestas, sigue
 * en la lista y guarda quién lo retiró, cuándo y por qué. Reponer también deja
 * constancia, así que se puede reconstruir por qué una respuesta cambió de
 * fuentes.
 */

export const RETIREMENT_STATES = ['activa', 'retirada'];

export const DEFAULT_RETIREMENT_STATE = 'activa';

export const RETIREMENT_ACTIONS = { retirada: 'retirar', activa: 'reponer' };

export function normalizeRetirementState(value) {
  const raw = String(value ?? '').trim();
  return RETIREMENT_STATES.includes(raw) ? raw : DEFAULT_RETIREMENT_STATE;
}

export function isRetirementState(value) {
  return RETIREMENT_STATES.includes(String(value ?? '').trim());
}

function materialIdOf(material) {
  return material?.materialId || material?.id || null;
}

function parseHistory(value) {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object');
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Historial de retiro tal como viene de la tabla (string JSON) o del estado
 * en memoria (array). Siempre devuelve un array.
 */
export function parseRetirementHistory(value) {
  return parseHistory(value);
}

/**
 * Estado de retiro de un material con su constancia.
 * @returns {{state: string, retired: boolean, by: string|null, at: string|null, reason: string|null, history: Array}}
 */
export function resolveMaterialRetirement(material = {}) {
  const safe = material || {};
  const state = normalizeRetirementState(safe.retirementState ?? safe.retirement?.state);
  const history = parseHistory(safe.retirementHistory ?? safe.retirement?.history);
  const last = history[history.length - 1] || null;
  return {
    state,
    retired: state === 'retirada',
    // `retiredBy/At/Reason` son la constancia del retiro; el último movimiento del
    // historial (retiro o reposición) es el responsable vigente.
    by: last?.by ?? safe.retiredBy ?? safe.retirement?.by ?? null,
    at: last?.at ?? safe.retiredAt ?? safe.retirement?.at ?? null,
    reason: last?.reason ?? safe.retireReason ?? safe.retirement?.reason ?? null,
    retiredBy: safe.retiredBy ?? safe.retirement?.by ?? null,
    retiredAt: safe.retiredAt ?? safe.retirement?.at ?? null,
    retireReason: safe.retireReason ?? safe.retirement?.reason ?? null,
    lastAction: last?.action ?? null,
    history,
  };
}

export function isRetiredMaterial(material) {
  return resolveMaterialRetirement(material).state === 'retirada';
}

/**
 * Aplica un cambio de estado de retiro dejando la constancia acumulada.
 * No toca el contenido del material: retirar no borra.
 */
export function applyRetirementChange(material = {}, { state, by, at, reason } = {}) {
  const safe = material || {};
  const previous = resolveMaterialRetirement(safe);
  const nextState = normalizeRetirementState(state);
  const changedAt = at || new Date().toISOString();
  const changedBy = by || 'docente';
  const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : undefined;

  const entry = {
    action: RETIREMENT_ACTIONS[nextState] || nextState,
    from: previous.state,
    to: nextState,
    by: changedBy,
    at: changedAt,
    reason: cleanReason,
  };

  const next = {
    ...safe,
    retirementState: nextState,
    retirementHistory: [...previous.history, entry].slice(-20),
  };

  if (nextState === 'retirada') {
    next.retiredBy = changedBy;
    next.retiredAt = changedAt;
    next.retireReason = cleanReason;
  }

  return next;
}

/** Ids de material separados por estado de retiro (para filtrar la recuperación). */
export function partitionMaterialsByRetirement(materials = []) {
  const retiredIds = new Set();
  const activeIds = new Set();
  for (const material of materials || []) {
    const id = materialIdOf(material);
    if (!id) continue;
    if (isRetiredMaterial(material)) retiredIds.add(String(id));
    else activeIds.add(String(id));
  }
  return { retiredIds, activeIds };
}

/**
 * Saca de los matches los materiales retirados. Sólo descarta lo que se sabe
 * retirado: un match cuyo material no está en la lista no se toca.
 */
export function excludeRetiredMatches(matches = [], retiredIds) {
  if (!retiredIds || retiredIds.size === 0) return matches;
  return (matches || []).filter((match) => {
    const id = match?.metadata?.materialId;
    if (!id) return true;
    return !retiredIds.has(String(id));
  });
}
