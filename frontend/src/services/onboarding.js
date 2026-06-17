/* ============================================================
   Onboarding Engine — state manager for guided tours
   Dependencies: OnboardingOverlay (renders the UI)
   ============================================================ */
const STORAGE_KEY = 'onboarding-teacher-completed';

export function isOnboardingCompleted() {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function markOnboardingCompleted() {
  localStorage.setItem(STORAGE_KEY, 'true');
}

export function resetOnboarding() {
  localStorage.removeItem(STORAGE_KEY);
}

export class OnboardingEngine {
  constructor({ role, steps }) {
    this.role = role;
    this.steps = steps;
    this.currentIndex = 0;
    this.active = false;
    this.overlay = null;
  }

  get isLastStep() {
    return this.currentIndex >= this.steps.length - 1;
  }

  get currentStep() {
    return this.steps[this.currentIndex] || null;
  }

  start() {
    if (isOnboardingCompleted() || this.active) return;
    this.active = true;
    this.currentIndex = 0;
    import('../components/OnboardingOverlay.js').then(({ OnboardingOverlay }) => {
      this.overlay = new OnboardingOverlay({
        engine: this,
        steps: this.steps,
      });
      this.overlay.show();
      this._dispatch('onboarding:started');
    });
  }

  next() {
    if (this.isLastStep) {
      markOnboardingCompleted();
      this._cleanup();
      this._toast('¡Felicidades!', 'Completaste la guía de inicio. Podés volver a abrirla desde el menú lateral.');
      return;
    }
    this.currentIndex++;
    this.overlay?.renderStep(this.currentIndex);
    this._dispatch('onboarding:step-changed', { index: this.currentIndex });
  }

  prev() {
    if (this.currentIndex <= 0) return;
    this.currentIndex--;
    this.overlay?.renderStep(this.currentIndex);
    this._dispatch('onboarding:step-changed', { index: this.currentIndex });
  }

  skip() {
    this._cleanup();
    this._toast('Guía cerrada', 'Podés volver a ver esta guía desde el menú de ayuda.');
    this._dispatch('onboarding:dismissed');
  }

  goTo(index) {
    if (index < 0 || index >= this.steps.length) return;
    this.currentIndex = index;
    this.overlay?.renderStep(index);
  }

  _cleanup() {
    this.active = false;
    this.overlay?.destroy();
    this.overlay = null;
    this._dispatch('onboarding:finished');
  }

  _toast(title, message) {
    window.dispatchEvent(new CustomEvent('toast:show', {
      detail: { type: 'success', title, message, duration: 5000 }
    }));
  }

  _dispatch(event, detail = {}) {
    window.dispatchEvent(new CustomEvent(event, { detail: { role: this.role, ...detail } }));
  }
}
