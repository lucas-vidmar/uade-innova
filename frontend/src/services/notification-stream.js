import { api } from './api.js';

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;
const BACKOFF_FACTOR = 2;

export function createNotificationStream() {
  let controller = null;
  let retryTimer = null;
  let retryDelay = INITIAL_RETRY_MS;
  let isRunning = false;
  let abortController = null;

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
    controller = null;
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
        if (eventType === 'snapshot' && controller) {
          controller.onSnapshot?.(data);
        }
      });
      if (!isRunning) return;
      retryDelay = INITIAL_RETRY_MS;
    } catch (err) {
      if (!isRunning || signal.aborted) return;
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
      controller = controller || {};
      controller.onSnapshot = fn;
    },
  };
}
