/* ============================================================
   Fechas sin hora — utilidades compartidas
   ============================================================ */

/**
 * #335: las fechas de entrega y de clase se guardan como fecha sin hora
 * ("2026-12-15"). `new Date("2026-12-15")` la interpreta como medianoche
 * **UTC**; al mostrarla con `toLocaleDateString('es-AR')` en Argentina
 * (UTC-3) cae al día anterior — se ve "14 dic" para un vencimiento del 15.
 * Parsear la fecha sin hora como mediodía local fija el día calendario que
 * se eligió, sin importar la zona del navegador. Un instante con hora (ISO
 * completo) se respeta tal cual, porque ahí la hora sí importa.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseLocalDate(value) {
  if (!value) return null;
  const raw = String(value);
  const parsed = new Date(DATE_ONLY.test(raw) ? `${raw}T12:00:00` : raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Medianoche local del día de `date` (para comparar días, no instantes). */
export function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Formatea una fecha (sin hora o ISO) en es-AR sin corrimiento de día. */
export function formatLocalDate(value, options = { day: 'numeric', month: 'short' }) {
  const parsed = parseLocalDate(value);
  return parsed ? parsed.toLocaleDateString('es-AR', options) : '';
}

/**
 * Días calendario entre hoy y `value` (negativo si ya venció). Se calcula
 * sobre el día local, así que un vencimiento "hoy" da 0 y no -1 por la hora.
 */
export function daysUntilLocalDate(value) {
  const parsed = parseLocalDate(value);
  if (!parsed) return null;
  return Math.round((startOfLocalDay(parsed) - startOfLocalDay()) / 86400000);
}
