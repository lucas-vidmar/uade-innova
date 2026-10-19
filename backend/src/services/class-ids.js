/**
 * services/class-ids.js — Normalización de `classIds` a un arreglo plano
 * (Issue #578).
 *
 * El pipeline escribe `classIds` en tres lugares que se leen después como
 * identificadores de clase: la fila autoritativa de `materials` (Table
 * Storage), la metadata de cada vector y el JSON procesado. Si el valor llega
 * anidado como texto —por ejemplo `['["class-01"]']`, que es lo que produce
 * un campo multipart enviado como arreglo JSON y separado por comas—, ninguna
 * comparación contra una clase real matchea: el material existe pero queda
 * invisible para las consultas acotadas a una clase.
 *
 * Esta función aplana cualquier combinación razonable de arreglos, strings
 * JSON anidados y listas separadas por comas, y deduplica preservando el
 * orden de aparición.
 */

// Guarda contra payloads patológicos (JSON dentro de JSON dentro de JSON…).
const MAX_DEPTH = 5;

const NOT_JSON = Symbol('not-json');

function tryParseJson(value) {
    try {
        return JSON.parse(value);
    } catch {
        return NOT_JSON;
    }
}

function dedupe(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
}

/**
 * @param {unknown} value - arreglo, string (JSON o separado por comas), número o null.
 * @param {number} [depth] - nivel de anidamiento (uso interno).
 * @returns {string[]} identificadores planos, sin vacíos y sin repetidos.
 */
export function normalizeClassIds(value, depth = 0) {
    if (value === null || value === undefined) return [];
    if (depth > MAX_DEPTH) return [];

    if (Array.isArray(value)) {
        const out = [];
        for (const item of value) out.push(...normalizeClassIds(item, depth + 1));
        return dedupe(out);
    }

    if (typeof value === 'number') return [String(value)];
    if (typeof value !== 'string') return [];

    const trimmed = value.trim();
    if (!trimmed) return [];

    const parsed = tryParseJson(trimmed);
    if (parsed !== NOT_JSON) {
        if (Array.isArray(parsed)) return normalizeClassIds(parsed, depth + 1);
        // `'"class-01"'` → la string interna
        if (typeof parsed === 'string') return normalizeClassIds(parsed, depth + 1);
        if (typeof parsed === 'number') return [String(parsed)];
        // objeto/booleano: no es un identificador de clase
        return [];
    }

    return dedupe(
        trimmed
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
    );
}
