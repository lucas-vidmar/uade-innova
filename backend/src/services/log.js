/**
 * services/log.js — Logging defensivo para los caminos que no pueden romperse.
 *
 * `context.log.warn(...)` no está operativo en el host desplegado (#433): en los
 * caminos de negación de acceso convierte un 403 en un 500 y, cuando la llamada
 * queda fuera de un `try`, la invocación no devuelve respuesta nunca. El efecto
 * se midió contra el piloto: `material-status` (uno, lote y lote POST) responde
 * 500 `Error al verificar permisos de acceso.` donde el guard idéntico de
 * `deadlines.js:63-77` responde 403; y `telemetry/polling` con un tipo
 * desconocido —y `get-roles` sin secreto— no responden ni en 60 s, mientras el
 * mismo endpoint de telemetría con un tipo conocido responde 200 en 0,6 s.
 *
 * Regla: la respuesta de una petición no puede depender de un método de log.
 * `logWarn` usa la API v4 (`context.warn`) cuando existe, cae a `context.log(...)`
 * —que sí funciona— y jamás llama a `context.log.warn`, ni lanza ni espera nada.
 *
 * @param {Object} context Azure Functions invocation context
 * @param {...*} args Mensaje y datos a registrar
 * @returns {void}
 */
export function logWarn(context, ...args) {
  try {
    if (typeof context?.warn === 'function') {
      context.warn(...args);
      return;
    }
    if (typeof context?.log === 'function') {
      context.log(...args);
      return;
    }
    if (typeof console?.warn === 'function') {
      console.warn(...args);
    }
  } catch {
    // Loguear es observabilidad, nunca el resultado: si el logger falla, la
    // respuesta sigue su curso.
  }
}
