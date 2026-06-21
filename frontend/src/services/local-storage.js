import { toast } from '../components/Toast.js';

let toastShownThisSession = false;

try {
  if (sessionStorage.getItem('uade.storage-warning-shown') === 'true') {
    toastShownThisSession = true;
  }
} catch {
  // sessionStorage unavailable — proceed without dedup recovery
}

function showStorageWarning() {
  if (toastShownThisSession) return;
  toastShownThisSession = true;
  try { sessionStorage.setItem('uade.storage-warning-shown', 'true'); } catch {}
  toast(
    'warning',
    'Almacenamiento local no disponible',
    'No se pudieron guardar tus datos localmente. Es posible que algunas funciones no estén disponibles offline.',
    6000
  );
}

export function safeSetItem(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    console.warn('[LocalStorage] Write failed', { key, error: err.message });
    showStorageWarning();
  }
}

export function safeGetItem(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ?? fallback;
  } catch {
    return fallback;
  }
}

export function safeRemoveItem(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    console.warn('[LocalStorage] Remove failed', { key, error: err.message });
  }
}
