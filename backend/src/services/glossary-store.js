import { saveJson, loadJson } from './storage.js';
import { resolveGlossaryTerm } from './glossary-match.js';

const GLOSSARY_CONTAINER = 'class-materials';
// La caché evita leer el blob en cada consulta, pero mientras vive una copia el
// asistente y el corrector pueden estar usando el vocabulario anterior. Se acota
// a 60 s para que un vocabulario recién puesto en vigencia no tarde 5 minutos en
// regir (UJ-16 paso 5).
const CACHE_TTL_MS = 60 * 1000;

const cache = new Map();

function cacheKey(subjectId) {
  return `glossary:${subjectId}`;
}

function blobName(subjectId) {
  return `glossary/${subjectId}.json`;
}

function getCached(subjectId) {
  const entry = cache.get(cacheKey(subjectId));
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(cacheKey(subjectId));
    return null;
  }
  return entry.data;
}

function setCache(subjectId, data) {
  cache.set(cacheKey(subjectId), { data, ts: Date.now() });
}

export async function getGlossary(subjectId) {
  if (!subjectId) return null;

  const cached = getCached(subjectId);
  if (cached) return cached;

  const data = await loadJson(GLOSSARY_CONTAINER, blobName(subjectId));
  if (data) setCache(subjectId, data);
  return data;
}

/**
 * Error de validación del vocabulario. El endpoint lo mapea a 400 para que la
 * pantalla pueda mostrar el choque antes de poner el vocabulario en vigencia
 * (UJ-16 paso 4).
 */
export class GlossaryValidationError extends Error {
  constructor(message, conflicts = []) {
    super(message);
    this.name = 'GlossaryValidationError';
    this.code = 'GLOSSARY_VALIDATION';
    this.status = 400;
    this.conflicts = conflicts;
  }
}

function normalizeForm(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTerms(terms) {
  return (terms || []).map((t) => ({
    term: typeof t.term === 'string' ? t.term.trim() : '',
    aliases: Array.isArray(t.aliases)
      ? t.aliases.map((a) => String(a).trim()).filter(Boolean)
      : typeof t.aliases === 'string'
        ? t.aliases.split(',').map((a) => a.trim()).filter(Boolean)
        : [],
    definition: typeof t.definition === 'string' ? t.definition.trim() : '',
  }));
}

/**
 * Choques del vocabulario: dos formas preferidas iguales, un alias que ya es la
 * forma preferida de otro término, o un alias compartido por dos términos.
 * Todas dejan al asistente sin poder distinguir conceptos (UJ-16 pasos 2, 3 y 4).
 */
export function findGlossaryConflicts(terms) {
  const conflicts = [];
  const preferredBy = new Map();

  (terms || []).forEach((t, i) => {
    const key = normalizeForm(t.term);
    if (!key) return;
    if (preferredBy.has(key)) {
      conflicts.push({
        type: 'duplicate_preferred_form',
        form: t.term,
        rows: [preferredBy.get(key), i],
        message: `"${t.term}" está definido dos veces como forma preferida (filas ${preferredBy.get(key) + 1} y ${i + 1}).`,
      });
    } else {
      preferredBy.set(key, i);
    }
  });

  (terms || []).forEach((t, i) => {
    const ownKey = normalizeForm(t.term);
    (t.aliases || []).forEach((alias) => {
      const aliasKey = normalizeForm(alias);
      if (!aliasKey) return;
      const owner = preferredBy.get(aliasKey);
      if (owner === undefined || owner === i) return;
      conflicts.push({
        type: 'alias_is_preferred_form',
        alias,
        rows: [i, owner],
        message: `"${alias}" es variante de "${t.term}" (fila ${i + 1}) pero además es la forma preferida de "${terms[owner].term}" (fila ${owner + 1}).`,
      });
    });
  });

  const aliasOwners = new Map();
  (terms || []).forEach((t, i) => {
    (t.aliases || []).forEach((alias) => {
      const key = normalizeForm(alias);
      if (!key) return;
      if (!aliasOwners.has(key)) aliasOwners.set(key, new Set());
      aliasOwners.get(key).add(i);
    });
  });
  for (const [aliasKey, owners] of aliasOwners) {
    if (owners.size > 1) {
      conflicts.push({
        type: 'shared_alias',
        alias: aliasKey,
        rows: [...owners],
        message: `La variante "${aliasKey}" apunta a ${owners.size} términos distintos (filas ${[...owners].map((i) => i + 1).join(', ')}).`,
      });
    }
  }

  return conflicts;
}

export async function updateGlossary(subjectId, terms, updatedBy) {
  if (!subjectId) throw new Error('subjectId is required');
  if (!Array.isArray(terms)) throw new Error('terms must be an array');

  const normalized = normalizeTerms(terms);

  // Una fila con contenido pero sin forma preferida no se descarta en silencio:
  // se rechaza para que quien enseña la complete (UJ-16 pasos 1 y 2).
  const incomplete = normalized
    .map((t, i) => ({ ...t, index: i }))
    .filter((t) => !t.term && (t.aliases.length > 0 || t.definition));
  if (incomplete.length > 0) {
    throw new GlossaryValidationError(
      `Hay ${incomplete.length} fila(s) con definición o variantes pero sin forma preferida (filas ${incomplete.map((t) => t.index + 1).join(', ')}). Completá el término o quitá la fila: no se guarda nada a medias.`,
      incomplete.map((t) => ({ type: 'missing_preferred_form', row: t.index })),
    );
  }

  const kept = normalized.filter((t) => t.term);
  const conflicts = findGlossaryConflicts(kept);
  if (conflicts.length > 0) {
    throw new GlossaryValidationError(
      `El vocabulario tiene ${conflicts.length} choque(s) que hay que resolver antes de ponerlo en vigencia: ${conflicts.map((c) => c.message).join(' ')}`,
      conflicts,
    );
  }

  const data = {
    subjectId,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || 'unknown',
    terms: kept,
  };

  await saveJson(GLOSSARY_CONTAINER, blobName(subjectId), data);
  setCache(subjectId, data);
  return data;
}

/**
 * Busca un término en el glosario de una materia normalizando mayúsculas y
 * acentos de forma case-insensitive. Coincide por término, prefijo del término
 * o aliases (Story 11.1.6), con el criterio único de `resolveGlossaryTerm`:
 * ante varios aciertos gana la forma más larga, nunca la primera del archivo
 * (issue #571). Devuelve el término completo (con definition) o null si no
 * existe.
 */
export async function findGlossaryTerm(subjectId, searchTerm) {
  if (!subjectId || !searchTerm) return null;

  const glossary = await getGlossary(subjectId);
  if (!glossary || !Array.isArray(glossary.terms) || glossary.terms.length === 0) return null;

  return resolveGlossaryTerm(glossary.terms, searchTerm);
}

export function invalidateGlossaryCache(subjectId) {
  cache.delete(cacheKey(subjectId));
}
