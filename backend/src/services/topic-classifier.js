/**
 * Agrupación por TEMA de la analítica docente (#420, UJ-42 / UJ-50).
 *
 * El temario NO se define acá: sale de `classes[].topics`, el temario que la
 * unidad declara encuentro por encuentro (`listClassesBySubject`). Este módulo
 * sólo decide a qué tema DECLARADO pertenece una consulta y qué pasa cuando no
 * pertenece a ninguno (grupo explícito `SIN_TEMA`, nunca descarte silencioso).
 *
 * La comparación es léxica contra el texto del tema declarado: se normaliza
 * (minúsculas, sin acentos, sin signos), se descartan palabras funcionales y se
 * compara con una poda de plurales + prefijo común. No hay sinónimos ni mapa de
 * temas propio: si un tema no está declarado, no existe para esta lectura.
 */

/** Clave del grupo explícito para lo que no cae en ningún tema del temario. */
export const SIN_TEMA = 'sin-tema';
export const SIN_TEMA_LABEL = 'Sin tema';

/** Orígenes que declara cada pregunta (UJ-42). */
export const ORIGENES = {
  SIN_MATERIAL: 'consultaSinMaterial',
  VALORACION_BAJA: 'valoracionBaja',
  REPORTE_ABIERTO: 'reporteAbierto',
  SIN_SENAL: 'sinSenal',
};

export const ORIGEN_LABELS = {
  [ORIGENES.SIN_MATERIAL]: 'Consulta sin material',
  [ORIGENES.VALORACION_BAJA]: 'Valoración baja',
  [ORIGENES.REPORTE_ABIERTO]: 'Reporte abierto',
  [ORIGENES.SIN_SENAL]: 'Sin señal',
};

// Palabras funcionales y andamiaje de la consulta: no son contenido temático.
const STOPWORDS = new Set([
  'que', 'como', 'cual', 'cuales', 'cualesquiera', 'donde', 'cuando', 'cuanto', 'cuanta',
  'quien', 'quienes', 'porque', 'para', 'por', 'con', 'sin', 'sobre', 'entre', 'desde',
  'hasta', 'segun', 'contra', 'hacia', 'bajo', 'tras', 'ante', 'durante', 'mediante',
  'los', 'las', 'del', 'una', 'unos', 'unas', 'por', 'sus', 'mas', 'muy', 'este', 'esta',
  'estos', 'estas', 'esto', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella', 'aquellos',
  'ser', 'son', 'esta', 'estan', 'estaba', 'hay', 'tiene', 'tienen', 'tenia', 'puede',
  'pueden', 'podria', 'debe', 'deben', 'hace', 'hacen', 'dice', 'dicen', 'trata', 'tratan',
  'visto', 'vistos', 'vista', 'vistas', 'vieron', 'cubre', 'cubrieron', 'vimos',
  'explica', 'explicar', 'explicame', 'describi', 'describir', 'resumi', 'resumir',
  'defini', 'definir', 'contame', 'decime', 'dame', 'haceme',
  'material', 'materiales', 'clase', 'clases', 'tema', 'temas', 'unidad', 'unidades',
  'programa', 'materia', 'curso', 'bibliografia', 'autores', 'autor',
  'sistema', 'sistemas',
]);

function stripAccents(text) {
  return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Normaliza a minúsculas sin acentos ni signos, conservando los espacios. */
export function normalizeText(text) {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Poda de plural: 'capas'→'capa', 'patrones'→'patron', 'aplicaciones'→'aplicacion'. */
export function stem(token) {
  const value = String(token || '');
  if (value.length >= 6 && value.endsWith('es')) return value.slice(0, -2);
  if (value.length >= 4 && value.endsWith('s')) return value.slice(0, -1);
  return value;
}

/** Tokens con contenido temático de un texto. */
export function significantTokens(text) {
  return normalizeText(text)
    .split(' ')
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !STOPWORDS.has(token))
    .map(stem);
}

/**
 * Dos tokens refieren al mismo término si coinciden tras normalizar y podar el
 * plural ('capa' ~ 'capas', 'patrón' ~ 'patrones', 'aplicación' ~ 'aplicaciones').
 * No hay sinónimos: 'arquitectura' no se estira a 'arquitectónico'.
 */
export function tokensMatch(a, b) {
  if (!a || !b) return false;
  return stem(a) === stem(b);
}

function acronymOf(tokens) {
  if (tokens.length < 2) return null;
  const acronym = tokens.map((t) => t[0]).join('');
  return acronym.length >= 3 ? acronym : null;
}

/**
 * Temario de la unidad: los temas que declara cada encuentro
 * (`classes[].topics`), de-duplicados por texto normalizado. El mismo tema
 * declarado en dos encuentros es UN tema con dos `declaredIn`.
 */
export function buildTemario(classes = []) {
  const byKey = new Map();
  (Array.isArray(classes) ? classes : []).forEach((klass) => {
    const classId = String(klass?.id || '').trim();
    const topics = Array.isArray(klass?.topics) ? klass.topics : [];
    for (const raw of topics) {
      const tema = String(raw || '').trim();
      const key = normalizeText(tema);
      if (!key) continue;
      const entry = byKey.get(key) || {
        tema,
        key,
        tokens: significantTokens(tema),
        acronym: acronymOf(significantTokens(tema)),
        declaredIn: [],
      };
      if (classId && !entry.declaredIn.includes(classId)) entry.declaredIn.push(classId);
      byKey.set(key, entry);
    }
  });
  const temario = Array.from(byKey.values());

  // Cuántos temas declaran cada token: sirve para no asignar una consulta por
  // una palabra que aparece en todo el temario ('arquitectura').
  const topicCountByToken = new Map();
  for (const entry of temario) {
    for (const token of new Set(entry.tokens)) {
      topicCountByToken.set(token, (topicCountByToken.get(token) || 0) + 1);
    }
  }

  return temario.map((entry) => ({
    ...entry,
    distinctiveTokens: new Set(
      entry.tokens.filter((token) => (topicCountByToken.get(token) || 0) <= 1),
    ),
  }));
}

/**
 * Asigna una consulta a un tema declarado, o `null` si no cae en ninguno.
 *
 * Regla: un tema es candidato si la consulta cubre todos sus tokens, o al menos
 * la mitad incluyendo un token que sólo ese tema declara. Gana mayor cobertura
 * y, en empate, el tema que aparece antes en el temario.
 */
export function classifyByTopic(question, temario = []) {
  const questionTokens = significantTokens(question);
  if (questionTokens.length === 0) return null;

  let best = null;
  for (const entry of temario) {
    if (!entry.tokens.length) continue;
    const acronymHit = Boolean(entry.acronym) && questionTokens.includes(entry.acronym);
    const matched = entry.tokens.filter((token) => questionTokens.some((q) => tokensMatch(token, q)));
    if (matched.length === 0 && !acronymHit) continue;

    const coverage = acronymHit ? 1 : matched.length / entry.tokens.length;
    if (coverage < 0.5) continue;
    const distinctive = acronymHit || matched.some((token) => entry.distinctiveTokens.has(token));
    if (coverage < 1 && !distinctive) continue;

    const score = { coverage, matched: matched.length, distinctive: distinctive ? 1 : 0 };
    if (
      !best
      || score.coverage > best.score.coverage
      || (score.coverage === best.score.coverage && score.matched > best.score.matched)
      || (score.coverage === best.score.coverage && score.matched === best.score.matched
        && score.distinctive > best.score.distinctive)
    ) {
      best = { entry, score };
    }
  }

  return best ? best.entry : null;
}

/** Origen de una consulta según lo que la propia interacción dejó registrado. */
export function originsOfLog(log, { pendingMessageIds } = {}) {
  const origins = [];
  // Consulta sin material: la respuesta no se apoyó en ningún material de la
  // unidad (`sources` vacío). Si el log no trae el campo, no se afirma nada.
  if (Array.isArray(log?.sources) && log.sources.length === 0) {
    origins.push(ORIGENES.SIN_MATERIAL);
  }
  // Valoración baja: pulgar abajo / rating negativo del alumno.
  if (log?.feedback === 'negative') {
    origins.push(ORIGENES.VALORACION_BAJA);
  }
  // Reporte abierto: reporte del alumno sobre esa respuesta, en el log o como
  // corrección pendiente en la bandeja.
  const reported = Boolean(log?.reportedIssue);
  const pendingById = Boolean(log?.id && pendingMessageIds?.has?.(String(log.id)));
  if (reported || pendingById) {
    origins.push(ORIGENES.REPORTE_ABIERTO);
  }
  return origins;
}

/** Contadores de origen por grupo, con `sinSenal` explícito. */
export function emptyOriginCounts() {
  return {
    [ORIGENES.SIN_MATERIAL]: 0,
    [ORIGENES.VALORACION_BAJA]: 0,
    [ORIGENES.REPORTE_ABIERTO]: 0,
    [ORIGENES.SIN_SENAL]: 0,
  };
}

export function countOrigins(counts, origins) {
  const list = Array.isArray(origins) ? origins : [];
  if (list.length === 0) {
    counts[ORIGENES.SIN_SENAL] += 1;
    return counts;
  }
  for (const origin of list) {
    if (counts[origin] === undefined) counts[origin] = 0;
    counts[origin] += 1;
  }
  return counts;
}
