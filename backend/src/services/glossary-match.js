// Resolución de términos del glosario.
//
// El fast-path del asistente (rag-query) y el lookup puntual del endpoint
// (get-glossary) tienen que responder con EL MISMO criterio. Antes cada camino
// tenía su propio `includes` simétrico con orden first-wins, y el término
// buscado se comparaba contra todas las formas del glosario en el orden en que
// estaban guardadas: cualquier entrada vieja que contuviera el prefijo ganaba
// (issue #571). Acá el criterio es único, explícito y por capas:
//
//   1. igualdad normalizada con la forma preferida o con un alias;
//   2. la consulta empieza con la forma (la pregunta trae cola: "… según la clase");
//   3. la forma empieza con la consulta (lookup parcial del docente);
//   4. la forma contiene la consulta en un límite de palabra, sólo si no hay
//      ambigüedad (dos términos distintos que la contienen ⇒ no se adivina).
//
// Entre varios aciertos de la misma capa gana la forma más larga ("Arquitectura
// Hexagonal" antes que "Hexagonal") y, a igual longitud, el orden del glosario.

const ARTICLES = new Set([
  'el', 'la', 'lo', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'este', 'esta', 'estos', 'estas', 'dicho', 'dicha',
]);

const MIN_PARTIAL_LENGTH = 3;

/**
 * Clave de comparación: minúsculas, sin acentos, espacios colapsados. Los
 * separadores (`-`, `.`, `/`, `(`, `)`) se conservan porque distinguen
 * términos: `QAW-2610182111` no es `QAW`.
 */
export function normalizeGlossaryKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isWordChar(char) {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/** ¿`haystack` empieza con `prefix` cerrando en un límite de palabra? */
function startsAligned(haystack, prefix) {
  if (!prefix || !haystack.startsWith(prefix)) return false;
  return !isWordChar(haystack[prefix.length]);
}

/** ¿`haystack` contiene `needle` en algún límite de palabra por ambos lados? */
function containsAligned(haystack, needle) {
  if (!needle) return false;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const beforeOk = at === 0 || !isWordChar(haystack[at - 1]);
    const afterOk = !isWordChar(haystack[at + needle.length]);
    if (beforeOk && afterOk) return true;
    from = at + 1;
  }
}

/** Quita artículos/determinantes iniciales: "la arquitectura hexagonal" → "arquitectura hexagonal". */
function stripLeadingArticles(key) {
  let out = key;
  for (;;) {
    const space = out.indexOf(' ');
    if (space < 0) return out;
    if (!ARTICLES.has(out.slice(0, space))) return out;
    out = out.slice(space + 1).trim();
  }
}

/**
 * Devuelve el término del glosario que corresponde a `searchTerm`, o null.
 *
 * @param {Array<{term: string, aliases?: string[]}>} terms filas del glosario
 * @param {string} searchTerm término o fragmento consultado
 * @returns {object|null} la fila del glosario (con definition) o null
 */
export function resolveGlossaryTerm(terms, searchTerm) {
  if (!Array.isArray(terms) || terms.length === 0) return null;

  const key = normalizeGlossaryKey(searchTerm);
  if (!key) return null;
  const needle = stripLeadingArticles(key);
  if (!needle) return null;

  const forms = [];
  terms.forEach((row, index) => {
    const push = (value) => {
      const form = normalizeGlossaryKey(value);
      if (form) forms.push({ row, form, index });
    };
    push(row?.term);
    if (Array.isArray(row?.aliases)) row.aliases.forEach(push);
  });
  if (forms.length === 0) return null;

  const longestFirst = (a, b) => b.form.length - a.form.length || a.index - b.index;

  // 1. Igualdad exacta (forma preferida o alias).
  const exact = forms.filter((f) => f.form === needle);
  if (exact.length > 0) return exact.sort(longestFirst)[0].row;

  // 2. La consulta arranca con la forma: la pregunta trae cola. Acá la forma
  //    más larga es la más específica ("Arquitectura Hexagonal" > "Arquitectura").
  const prefixed = forms.filter((f) => startsAligned(needle, f.form));
  if (prefixed.length > 0) return prefixed.sort(longestFirst)[0].row;

  // 3. La forma arranca con la consulta (lookup parcial). Si el fragmento cae
  //    en más de un término distinto no se elige ninguno: adivinar el más largo
  //    es justamente el first-wins que devolvía el término equivocado (#571).
  if (needle.length >= MIN_PARTIAL_LENGTH) {
    const partial = uniqueRow(forms.filter((f) => startsAligned(f.form, needle)));
    if (partial !== undefined) return partial;
  }

  // 4. La forma contiene la consulta en un límite de palabra, sin ambigüedad.
  if (needle.length >= MIN_PARTIAL_LENGTH) {
    const contained = uniqueRow(forms.filter((f) => containsAligned(f.form, needle)));
    if (contained !== undefined) return contained;
  }

  return null;
}

/**
 * Devuelve la fila si todos los aciertos apuntan al mismo término; si no hay
 * aciertos o hay más de uno, `undefined` (sigue la siguiente capa).
 */
function uniqueRow(hits) {
  if (hits.length === 0) return undefined;
  const rows = new Set(hits.map((f) => f.row));
  return rows.size === 1 ? hits[0].row : null;
}
