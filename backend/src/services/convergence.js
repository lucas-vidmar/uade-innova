/**
 * convergence.js — clave de convergencia de las señales de calidad (UJ-40).
 *
 * Una marca (pulgar abajo) y un reporte sobre la misma respuesta tienen que
 * caer en el mismo grupo de la bandeja. Hasta #514 cada señal se guardaba en
 * su propio almacén y sólo los reportes calculaban una clave, así que dos
 * personas marcando el mismo punto nunca se veían juntas.
 *
 * La clave se deriva del punto de material citado (material + fragmento), con
 * respaldo en el encuentro más la pregunta normalizada. Nunca se usa el texto
 * de la respuesta como respaldo: las respuestas de abstención son un texto
 * único para media materia y fusionaban reportes de temas distintos en un
 * grupo inflado (ver #513).
 */

/** Normaliza un tramo de texto para que dos personas que preguntan lo mismo converjan. */
export function normalizeKeyPart(value, limit = 120) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, limit);
}

/**
 * @param {object} signal
 * @param {Array} [signal.sources] fuentes citadas en la respuesta (chat-log)
 * @param {string} [signal.classId] encuentro de la respuesta
 * @param {string} [signal.question] pregunta que originó la respuesta
 * @param {string} [signal.answer] respuesta del asistente
 * @param {string} [signal.messageId] identificador de la respuesta
 * @returns {string} clave estable para agrupar marcas y reportes
 */
export function deriveGroupKey({ sources, classId, question, answer, messageId } = {}) {
  const list = Array.isArray(sources) ? sources : [];
  const primary = list.find((s) => s && (s.materialId || s.sourceFilename)) || null;
  if (primary) {
    return `${primary.classId || classId || 'unknown'}|${primary.materialId || primary.sourceFilename || ''}#${primary.chunkIndex ?? ''}`;
  }

  const questionKey = normalizeKeyPart(question);
  const answerKey = normalizeKeyPart(answer);
  if (questionKey || answerKey) {
    return `${classId || 'unknown'}|${questionKey || answerKey}`;
  }

  // Sin log legible no hay punto de material ni pregunta: la única identidad
  // que queda es la respuesta misma, que es justo el punto que se marcó.
  return `${classId || 'unknown'}|msg:${messageId || 'sin-punto'}`;
}
