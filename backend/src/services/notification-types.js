/**
 * Tipos canónicos de aviso.
 *
 * Un tipo que no está en esta lista se degrada a `material` **en silencio**, y con
 * eso el aviso queda invisible para quien lo filtra por su tipo: pasó con el aviso
 * de integridad del índice (#328), que se guardaba bien pero se escribía y se leía
 * como `material`, así que la bandeja no lo mostraba y el tablero del docente
 * tampoco.
 *
 * La lista vive en un solo módulo a propósito: el almacén la usaba para normalizar
 * al escribir y el endpoint de lectura tenía su propia copia, así que agregar un
 * tipo en un solo lado lo dejaba degradado igual al leerlo.
 */
export const NOTIFICATION_TYPES = [
  'grade',
  'summary',
  'material',
  'deadline',
  'teacher-reminder',
  'integrity',
];

export const FALLBACK_NOTIFICATION_TYPE = 'material';

export function normalizeNotificationType(value) {
  return NOTIFICATION_TYPES.includes(value) ? value : FALLBACK_NOTIFICATION_TYPE;
}
