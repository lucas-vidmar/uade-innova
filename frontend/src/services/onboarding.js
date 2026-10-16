/* ============================================================
   Onboarding Engine — state manager for guided tours
   Dependencies: OnboardingOverlay (renders the UI), Toast (notifications)
   Issue #375: la constancia de la entrada guiada es un registro con
   estado (completada | omitida) y fecha, legible y persistido en el
   perfil del servidor, no un booleano suelto del navegador.
   ============================================================ */
import { toast } from '../components/Toast.js';
import { api } from './api.js';
import { safeSetItem, safeGetItem, safeRemoveItem } from './local-storage.js';

const STORAGE_KEY_PREFIX = 'onboarding-';
const RECORD_STATUSES = ['completed', 'dismissed'];
let _activeInstance = null;

function getKey(role) {
  return `${STORAGE_KEY_PREFIX}${role || 'default'}-completed`;
}

function safeStorage(method, key, value) {
  if (method === 'get') return safeGetItem(key);
  if (method === 'set') { safeSetItem(key, value); return; }
  if (method === 'remove') { safeRemoveItem(key); return; }
}

/**
 * Constancia de la entrada guiada para un rol:
 * `{ status: 'completed' | 'dismissed', at: ISO-8601 | null, step: number | null }`.
 * Devuelve `null` si la persona todavía no la vio ni la omitió.
 * Compatibilidad: el valor legado `'true'` se lee como completada sin fecha.
 */
export function getOnboardingRecord(role = 'teacher') {
  const raw = safeStorage('get', getKey(role));
  if (!raw) return null;
  if (raw === 'true') return { status: 'completed', at: null, step: null, legacy: true };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && RECORD_STATUSES.includes(parsed.status)) {
      return {
        status: parsed.status,
        at: typeof parsed.at === 'string' ? parsed.at : null,
        step: Number.isInteger(parsed.step) ? parsed.step : null,
      };
    }
  } catch { /* valor corrupto: se trata como sin constancia */ }
  return null;
}

function writeRecord(role, status, step) {
  const record = {
    status,
    at: new Date().toISOString(),
    step: Number.isInteger(step) ? step : null,
  };
  safeStorage('set', getKey(role), JSON.stringify(record));
  syncOnboardingRecord(record);
  return record;
}

/** La entrada guiada se completó (se recorrió hasta el final). */
export function markOnboardingCompleted(role = 'teacher', step = null) {
  return writeRecord(role, 'completed', step);
}

/** La entrada guiada se omitió: no es una constancia de recorrido. */
export function markOnboardingDismissed(role = 'teacher', step = null) {
  return writeRecord(role, 'dismissed', step);
}

/** ¿Se recorrió hasta el final? (omitir no cuenta como completar) */
export function isOnboardingCompleted(role = 'teacher') {
  return getOnboardingRecord(role)?.status === 'completed';
}

/** ¿La persona ya vio o descartó la guía? (no volver a abrirla sola) */
export function hasOnboardingRecord(role = 'teacher') {
  return getOnboardingRecord(role) !== null;
}

/** La guía solo se abre sola la primera vez, no después de omitirla. */
export function shouldAutoStartOnboarding(role = 'teacher') {
  return !hasOnboardingRecord(role);
}

// Persistir en el perfil del servidor para que la constancia viaje con la
// persona y sea legible fuera del dispositivo. Best-effort: el registro local
// ya quedó escrito y la sesión sigue funcionando sin conexión.
function syncOnboardingRecord(record) {
  try {
    Promise.resolve(api.saveProfile({ onboarding: record })).catch(() => {});
  } catch { /* nunca bloquea la UI */ }
}

/** Hidrata la constancia desde el perfil del servidor (otro equipo). */
export function hydrateOnboardingRecord(profile) {
  if (!profile) return;
  const status = profile.onboardingStatus;
  if (!RECORD_STATUSES.includes(status)) return;
  const at = typeof profile.onboardingAt === 'string' ? profile.onboardingAt : null;
  const step = Number.isInteger(profile.onboardingStep) ? profile.onboardingStep : null;
  const local = getOnboardingRecord();
  // No pisar una constancia local más nueva que la del servidor.
  if (local && local.at && at && Date.parse(local.at) > Date.parse(at)) return;
  safeStorage('set', getKey(profile.role || 'student'), JSON.stringify({ status, at, step }));
}

export function resetOnboarding(role = 'teacher') {
  safeStorage('remove', getKey(role));
}

export class OnboardingEngine {
  constructor({ role, steps }) {
    this.role = role;
    this.steps = steps;
    this.currentIndex = 0;
    this.active = false;
    this.overlay = null;
    this._busy = false;
  }

  get isLastStep() {
    return this.currentIndex >= this.steps.length - 1;
  }

  get currentStep() {
    return this.steps[this.currentIndex] || null;
  }

  start() {
    if (isOnboardingCompleted(this.role) || this.active) return;
    if (_activeInstance) _activeInstance.skip();
    this.active = true;
    _activeInstance = this;
    this.currentIndex = 0;
    import('../components/OnboardingOverlay.js').then(({ OnboardingOverlay }) => {
      this.overlay = new OnboardingOverlay({
        engine: this,
        steps: this.steps,
      });
      this.overlay.show();
      this._dispatch('onboarding:started');
    }).catch(() => {
      this.active = false;
      _activeInstance = null;
    });
  }

  next() {
    if (this._busy || !this.active) return;
    this._busy = true;
    if (this.isLastStep) {
      markOnboardingCompleted(this.role, this.currentIndex);
      this._cleanup();
      toast('success', '¡Felicidades!', 'Completaste la guía de inicio. Podés volver a abrirla desde el menú lateral.');
      this._busy = false;
      return;
    }
    this.currentIndex++;
    this.overlay?.renderStep(this.currentIndex);
    this._dispatch('onboarding:step-changed', { index: this.currentIndex });
    this._busy = false;
  }

  prev() {
    if (this._busy || this.currentIndex <= 0) return;
    this._busy = true;
    this.currentIndex--;
    this.overlay?.renderStep(this.currentIndex);
    this._dispatch('onboarding:step-changed', { index: this.currentIndex });
    this._busy = false;
  }

  skip() {
    if (!this.active) return;
    // Omitir deja constancia de la omisión, no de un recorrido completo.
    markOnboardingDismissed(this.role, this.currentIndex);
    this._cleanup();
    toast('success', 'Guía cerrada', 'Podés volver a ver esta guía desde el menú de ayuda.');
    this._dispatch('onboarding:dismissed');
  }

  goTo(index) {
    if (!this.active || index < 0 || index >= this.steps.length) return;
    this.currentIndex = index;
    this.overlay?.renderStep(index);
  }

  _cleanup() {
    this.active = false;
    if (_activeInstance === this) _activeInstance = null;
    this.overlay?.destroy();
    this.overlay = null;
    this._dispatch('onboarding:finished');
  }

  _dispatch(event, detail = {}) {
    window.dispatchEvent(new CustomEvent(event, { detail: { role: this.role, ...detail } }));
  }
}
