import { saveJson, loadJson } from './storage.js';

const GLOSSARY_CONTAINER = 'class-materials';
const CACHE_TTL_MS = 5 * 60 * 1000;

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

export async function updateGlossary(subjectId, terms) {
  if (!subjectId) throw new Error('subjectId is required');
  if (!Array.isArray(terms)) throw new Error('terms must be an array');

  const data = {
    subjectId,
    updatedAt: new Date().toISOString(),
    terms: terms.map((t) => ({
      term: t.term,
      aliases: Array.isArray(t.aliases) ? t.aliases : [],
      definition: typeof t.definition === 'string' ? t.definition.trim() : '',
    })),
  };

  await saveJson(GLOSSARY_CONTAINER, blobName(subjectId), data);
  setCache(subjectId, data);
  return data;
}

/**
 * Busca un término en el glosario de una materia normalizando mayúsculas y
 * acentos de forma case-insensitive. Coincide por término, substring del
 * término o aliases (Story 11.1.6). Devuelve el término completo (con
 * definition) o null si no existe.
 */
export async function findGlossaryTerm(subjectId, searchTerm) {
  if (!subjectId || !searchTerm) return null;

  const glossary = await getGlossary(subjectId);
  if (!glossary || !Array.isArray(glossary.terms) || glossary.terms.length === 0) return null;

  const term = String(searchTerm).trim().toLowerCase();
  if (!term) return null;

  return (
    glossary.terms.find((t) => {
      const tTerm = String(t.term || '').trim().toLowerCase();
      const aliases = Array.isArray(t.aliases) ? t.aliases : [];
      return (
        tTerm === term ||
        tTerm.includes(term) ||
        aliases.some((a) => {
          const aNorm = String(a || '').trim().toLowerCase();
          return aNorm === term || aNorm.includes(term);
        })
      );
    }) || null
  );
}

export function invalidateGlossaryCache(subjectId) {
  cache.delete(cacheKey(subjectId));
}
