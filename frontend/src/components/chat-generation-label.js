/* ============================================================
   chat-generation-label.js — Declaración de la configuración de generación
   que se muestra debajo de cada respuesta (#408 / UJ-27)
   ============================================================
   El backend arma el bloque `generation` (modelo, temperatura, tope de tokens,
   versión del prompt) y la etiqueta legible. Acá no se inventan parámetros: si
   el bloque no llegó (respuestas viejas guardadas antes de este arreglo), no se
   declara nada en vez de mostrar una configuración supuesta.
*/

/**
 * Texto a mostrar debajo de una respuesta.
 * @param {object|null|undefined} generation bloque `generation` del backend
 * @returns {string} '' si no hay declaración disponible
 */
export function generationLabel(generation) {
    if (!generation || typeof generation !== 'object') return '';
    if (typeof generation.label === 'string' && generation.label.trim()) {
        const label = generation.label.trim();
        return generation.determinism === 'temperature-0' ? `Powered by ${label}` : label;
    }
    // Compatibilidad: respuestas anteriores a #408 sólo traían `model`.
    if (typeof generation.model === 'string' && generation.model.trim()) {
        return `Powered by ${generation.model.trim()}`;
    }
    return '';
}

/**
 * Marca de abstención: distingue "el modelo se abstuvo pese a tener evidencia"
 * de "el material no alcanza". Es la diferencia que el grupo necesita para
 * decidir si la falta de respuesta es del material o del motor.
 * @param {{abstained?: boolean, abstainedWithEvidence?: boolean, evidenceCount?: number}} msg
 * @returns {string} '' cuando no hay nada que declarar
 */
export function abstentionNote(msg) {
    if (!msg || msg.abstained !== true) return '';
    if (msg.abstainedWithEvidence === true) {
        const n = Number(msg.evidenceCount);
        const evidencia = Number.isFinite(n) && n > 0
            ? `${n} fragmento${n === 1 ? '' : 's'} del material`
            : 'fragmentos del material';
        return `El modelo se abstuvo con ${evidencia} adjunta${Number(n) === 1 ? '' : 's'}: la falta de respuesta no es del material, es del motor.`;
    }
    if (msg.abstainedWithEvidence === false) {
        return 'Se abstuvo sin fragmentos del material: el material no alcanza.';
    }
    return '';
}
