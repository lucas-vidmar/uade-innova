import { api } from './api.js';

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;
const BACKOFF_FACTOR = 2;

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
  let retryDelay = INITIAL_RETRY_MS;
  let isRunning = false;
  let abortController = null;
  // Callbacks registered by the consumer (onSnapshot/onError) must survive
  // stop()/start() cycles — never null them out.
  const controller = {};

  function stop() {
    isRunning = false;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
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

    try {
      await api.subscribeNotificationStream({ userId, subjectId, signal }, (eventType, data) => {
        if (signal.aborted) return;
        if (eventType === 'notification') {
          window.dispatchEvent(new CustomEvent('student:trigger-notification', { detail: data }));
        }
        if (eventType === 'snapshot') {
          controller.onSnapshot?.(data);
        }
      });
      if (!isRunning) return;
      retryDelay = INITIAL_RETRY_MS;
    } catch (err) {
      if (!isRunning || signal.aborted) return;
      if (isHardAuthFailure(err)) {
        console.warn('[NotificationStream] Hard authorization failure, stopping reconnects:', err.status, err.code);
        stop();
        notifyError(err);
        return;
      }
      console.warn('[NotificationStream] Connection lost, reconnecting in', retryDelay, 'ms:', err.message);
    }

    if (!isRunning) return;
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
  };
}