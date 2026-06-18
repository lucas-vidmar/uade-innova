/* ============================================================
   Onboarding Engine — state manager for guided tours
   Dependencies: OnboardingOverlay (renders the UI), Toast (notifications)
   ============================================================ */
import { toast } from '../components/Toast.js';

const STORAGE_KEY_PREFIX = 'onboarding-';
let _activeInstance = null;

function getKey(role) {
  return `${STORAGE_KEY_PREFIX}${role || 'default'}-completed`;
}

function safeStorage(method, key, value) {
  try {
    if (method === 'get') return localStorage.getItem(key);
    if (method === 'set') localStorage.setItem(key, value);
    if (method === 'remove') localStorage.removeItem(key);
  } catch {
    return method === 'get' ? null : undefined;
  }
}

export function isOnboardingCompleted(role = 'teacher') {
  return safeStorage('get', getKey(role)) === 'true';
}

export function markOnboardingCompleted(role = 'teacher') {
  safeStorage('set', getKey(role), 'true');
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
      markOnboardingCompleted(this.role);
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
