/**
 * services/rag-generation-config.js — Configuración de generación DECLARADA
 * (#408 / UJ-27)
 *
 * Problema que resuelve: dos personas del mismo grupo, con la misma pregunta y
 * exactamente la misma evidencia recuperada, recibían respuestas distintas —o
 * una respuesta y una abstención—. El desacuerdo no estaba en el material ni en
 * los fragmentos: estaba en el muestreo del modelo, y no había forma de verlo
 * desde el producto. La comparación que pide el recorrido (UJ-27, pasos 5-9) no
 * tenía árbitro.
 *
 * Decisión (opción c): bajar la temperatura de la respuesta y DECLARAR en cada
 * respuesta el modelo y la configuración con la que se generó. Así, si dos
 * personas con la misma evidencia obtienen textos distintos, pueden ver que
 * ambas salieron del mismo modelo con los mismos parámetros y que la diferencia
 * es del muestreo remanente del proveedor — no de la evidencia.
 *
 * Por qué temperatura 0 y no otra:
 * - Es el valor que el propio pipeline ya usa para el paso que tiene que ser
 *   reproducible (la reescritura de la pregunta de seguimiento, `temperature: 0`
 *   en rag-query.js): el proveedor acepta el parámetro y lo aplica.
 * - Baja el muestreo al mínimo que expone la API. No se promete determinismo
 *   bit-a-bit: el proveedor no lo garantiza (batching, aritmética de punto
 *   flotante). Por eso la declaración viaja con cada respuesta: lo que se
 *   declara no es "esto es determinista", es "esto salió con estos parámetros",
 *   que es lo que hace auditable la diferencia.
 *
 * top_p: NO se envía. Antes tampoco se enviaba, así que vale el default del
 * proveedor; declararlo como enviado sería mentir sobre lo que se pidió. La
 * declaración lo dice explícitamente (`topP: null`, `topPSource: 'proveedor'`).
 */
import { CONFIG } from '../config.js';

/** Temperatura de la respuesta del asistente RAG. */
export const RAG_TEMPERATURE = 0;

/** Mecanismos de determinismo que el payload puede declarar. */
export const DETERMINISM = {
  /** Respuesta del modelo con muestreo reducido al mínimo (temperature 0). */
  TEMPERATURE_ZERO: 'temperature-0',
  /** Fast-path de glosario: no hay modelo generativo, la definición es fija. */
  GLOSSARY: 'glosario-sin-modelo',
  /** Rechazo canónico sin fragmentos: el material no alcanza, no hay modelo. */
  NO_CONTEXT: 'rechazo-sin-contexto',
};

function labelFor({ modelLabel, temperature, maxTokens, promptVersion }) {
  const parts = [modelLabel];
  if (temperature !== null) parts.push(`temperatura ${temperature}`);
  if (maxTokens !== null) parts.push(`máx. ${maxTokens} tokens`);
  if (promptVersion) parts.push(`prompt ${promptVersion}`);
  return parts.filter(Boolean).join(' · ');
}

/**
 * Arma el bloque de configuración que viaja en cada respuesta (metadata SSE,
 * evento `done`, payload JSON sin stream y log de la interacción).
 *
 * Es un objeto plano y congelado a propósito: se serializa tal cual al cliente,
 * así que lo que se declara es exactamente lo que se le pasó al modelo.
 */
export function resolveRagGenerationConfig({
  model = null,
  modelLabel = null,
  maxTokens = null,
  promptVersion = null,
  determinism = DETERMINISM.TEMPERATURE_ZERO,
} = {}) {
  const usesModel = determinism === DETERMINISM.TEMPERATURE_ZERO;
  const tokens = usesModel
    ? (Number.isFinite(maxTokens) ? maxTokens : CONFIG.ai.maxTokens.chat)
    : null;
  const temperature = usesModel ? RAG_TEMPERATURE : null;
  let label;
  if (usesModel) {
    label = labelFor({ modelLabel: modelLabel || model || '', temperature, maxTokens: tokens, promptVersion });
  } else if (determinism === DETERMINISM.GLOSSARY) {
    label = 'Glosario del docente · sin modelo generativo (respuesta fija)';
  } else {
    // Sin fragmentos recuperados no se llama al modelo: la abstención es del
    // material (no alcanza), no del muestreo. Que se lea distinto es el punto.
    label = 'Rechazo sin fragmentos del material · no se llamó al modelo';
  }

  return Object.freeze({
    model: usesModel ? (model || null) : null,
    modelLabel: usesModel ? (modelLabel || model || null) : null,
    label,
    temperature,
    topP: null,
    topPSource: usesModel ? 'proveedor' : null,
    maxTokens: tokens,
    promptVersion: usesModel ? (promptVersion || null) : null,
    determinism,
  });
}

/**
 * Texto que la interfaz muestra debajo de cada respuesta. Se arma en el backend
 * para que el cliente no invente parámetros: la declaración tiene una sola
 * fuente de verdad.
 */
export function describeGenerationConfig(generation) {
  if (!generation) return '';
  if (generation.determinism === DETERMINISM.GLOSSARY) return generation.label;
  return `Powered by ${generation.label}`;
}
