import { api } from './api.js';
import { isAbortError } from './core.js';

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;
const BACKOFF_FACTOR = 2;

// El servidor late con `keepalive` cada 6 sondeos (NOTIFICATION_STREAM_POLL_MS = 5 s
// -> 30 s) y cierra la conexión a los NOTIFICATION_STREAM_MAX_MS (110 s) pidiendo
// reconexión explícita con `event: reconnect`. Si en dos latidos no llega NINGÚN
// evento, la conexión está muerta aunque el socket siga abierto (corte silencioso,
// equipo suspendido, NAT caído): sin vigía la lista queda vieja para siempre, los
// avisos del tramo se pierden sin señal y nada pide reconectar (UJ-58).
const HEARTBEAT_MS = 30000;
const WATCHDOG_MS = HEARTBEAT_MS * 2 + 10000;

const HARD_AUTH_CODES = new Set(['ACCESS_DENIED', 'FORBIDDEN', 'NOTIFICATION_SCOPE', 'ENROLLMENT_INACTIVE', 'AUTH_REQUIRED', 'TOKEN_EXPIRED', 'INVALID_TOKEN']);

/**
 * A hard authorization failure must NOT be retried: it will never succeed
 * without re-authentication, so reconnecting only produces a 403 backoff loop
 * (Story 10.24 / AC #2). Only transient/network/5xx errors reconnect.
 */
function isHardAuthFailure(err) {
    if (!err) return false;
    if (err.status === 401 || err.status === 403) return true;
    if (typeof err.code === 'string' && HARD_AUTH_CODES.has(err.code)) return true;
    return false;
}

export function createNotificationStream() {
  let retryTimer = null;
  let watchdogTimer = null;
  let retryDelay = INITIAL_RETRY_MS;
  let isRunning = false;
  let abortController = null;
  // El vigía aborta el pedido a propósito: sin esta marca el catch tomaría su
  // propia cancelación por un abort del consumidor y no reconectaría.
  let watchdogFired = false;
  // Último `createdAt` recibido por el canal (reloj del servidor). Se reenvía como
  // `since` al reconectar, para que el servidor reemita lo ocurrido en el corte.
  let since = null;
  // Callbacks registered by the consumer (onSnapshot/onError) must survive
  // stop()/start() cycles — never null them out.
  const controller = {};

  function clearWatchdog() {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function notifyState(state, extra = {}) {
    const detail = { state, ...extra };
    try {
      window.dispatchEvent(new CustomEvent('notification-stream:state', { detail }));
    } catch (e) {}
    if (typeof controller.onState === 'function') {
      controller.onState(detail);
    }
  }

  function armWatchdog() {
    clearWatchdog();
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      if (!isRunning) return;
      watchdogFired = true;
      notifyState('reconnecting', { reason: 'silence', silenceMs: WATCHDOG_MS });
      try {
        abortController?.abort();
      } catch (e) {}
    }, WATCHDOG_MS);
  }

  function stop() {
    isRunning = false;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    clearWatchdog();
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  function notifyError(err) {
    const detail = {
      status: err?.status || 0,
      code: err?.code || null,
      message: err?.message || 'No se pudo conectar al canal de notificaciones.',
    };
    window.dispatchEvent(new CustomEvent('notification-stream:error', { detail }));
    if (typeof controller.onError === 'function') {
      controller.onError(detail);
    }
  }

  async function start({ userId, subjectId }) {
    stop();
    isRunning = true;
    retryDelay = INITIAL_RETRY_MS;
    await connect({ userId, subjectId });
  }

  async function connect({ userId, subjectId }) {
    if (!isRunning) return;

    abortController = new AbortController();
    const signal = abortController.signal;
    watchdogFired = false;
    // El vigía se arma antes de abrir: una conexión que nunca responde también
    // tiene que detectarse y volver a pedirse.
    armWatchdog();
    let sawEvent = false;

    try {
      await api.subscribeNotificationStream({ userId, subjectId, signal, since }, (eventType, data) => {
        if (signal.aborted) return;
        sawEvent = true;
        armWatchdog();
        if (eventType === 'notification') {
          if (data?.createdAt) since = data.createdAt;
          window.dispatchEvent(new CustomEvent('student:trigger-notification', { detail: data }));
        }
        if (eventType === 'snapshot') {
          controller.onSnapshot?.(data);
        }
        if (eventType === 'reconnect') {
          // El servidor se cierra a propósito (vida máxima del stream) y pide
          // reconectar: se anuncia en vez de dejar la lista vieja en silencio.
          notifyState('reconnecting', { reason: data?.reason || 'server', ms: data?.ms || null });
        }
      });
      if (!isRunning) return;
      retryDelay = INITIAL_RETRY_MS;
    } catch (err) {
      if (!isRunning) return;
      // Un abort del consumidor (cambio de ruta, stop) se silencia; el abort del
      // vigía, en cambio, tiene que seguir el camino de reconexión.
      if ((signal.aborted || isAbortError(err)) && !watchdogFired) return;
      if (isHardAuthFailure(err)) {
        console.warn('[NotificationStream] Hard authorization failure, stopping reconnects:', err.status, err.code);
        stop();
        notifyState('stopped', { reason: 'auth', status: err.status || 0, code: err.code || null });
        notifyError(err);
        return;
      }
      // Fix #346: transient reconnects are routine (route change, timeout) —
      // debug-level, not a warning.
      console.debug('[NotificationStream] Connection lost, reconnecting in', retryDelay, 'ms:', err.message);
    }

    if (!isRunning) return;
    if (sawEvent && !watchdogFired) {
      notifyState('connected', { retryInMs: 0 });
    } else {
      notifyState('reconnecting', { reason: watchdogFired ? 'silence' : 'error', retryInMs: retryDelay });
    }
    retryTimer = setTimeout(() => {
      retryDelay = Math.min(retryDelay * BACKOFF_FACTOR, MAX_RETRY_MS);
      connect({ userId, subjectId });
    }, retryDelay);
  }

  return {
    start,
    stop,
    get isRunning() { return isRunning; },
    set onSnapshot(fn) {
      controller.onSnapshot = fn;
    },
    set onError(fn) {
      controller.onError = fn;
    },
    set onState(fn) {
      controller.onState = fn;
    },
  };
}
