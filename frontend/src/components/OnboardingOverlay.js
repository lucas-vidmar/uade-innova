/* ============================================================
   OnboardingOverlay — guided tour tooltip UI component
   Renders the semi-transparent backdrop + step cards with
   positional arrows on desktop, full-screen on mobile.
   ============================================================ */
export class OnboardingOverlay {
  constructor({ engine, steps }) {
    this.engine = engine;
    this.steps = steps;
    this.backdropEl = null;
    this.tooltipEl = null;
    this._onResize = () => this._reposition();
  }

  show() {
    if (!this.steps?.length) return;
    this._createBackdrop();
    this.renderStep(0);
    window.addEventListener('resize', this._onResize);
    document.addEventListener('keydown', this._handleKeyDown);
    this.backdropEl?.addEventListener('click', () => this.engine.skip());
  }

  renderStep(index) {
    const step = this.steps[index];
    if (!step) return;
    this._removeHighlight();
    this._highlightTarget(step);
    if (this.tooltipEl) this.tooltipEl.remove();
    this.tooltipEl = this._createTooltip(step, index);
    document.body.appendChild(this.tooltipEl);
    requestAnimationFrame(() => {
      this._reposition(step);
      this.tooltipEl.classList.add('onboarding-tooltip--visible');
    });
  }

  destroy() {
    this._removeHighlight();
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('keydown', this._handleKeyDown);
    if (this.tooltipEl) { this.tooltipEl.remove(); this.tooltipEl = null; }
    if (this.backdropEl) { this.backdropEl.remove(); this.backdropEl = null; }
  }

  /* ── Backdrop ──────────────────────────────────────────── */
  _createBackdrop() {
    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'onboarding-overlay';
    document.body.appendChild(this.backdropEl);
  }

  /* ── Tooltip DOM ───────────────────────────────────────── */
  _createTooltip(step, index) {
    const isMobile = window.innerWidth < 640;
    const isLast = this.engine.isLastStep;
    const el = document.createElement('div');
    el.className = `onboarding-tooltip ${isMobile ? 'onboarding-tooltip--mobile' : `onboarding-tooltip--${step.position || 'bottom'}`}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `Paso ${index + 1} de ${this.steps.length}`);

    el.innerHTML = `
      <div class="onboarding-tooltip-header">
        <span class="onboarding-step-indicator">${index + 1} / ${this.steps.length}</span>
        <button class="onboarding-close-btn" aria-label="Cerrar guía">✕</button>
      </div>
      <div class="onboarding-tooltip-body">
        ${step.icon ? `<div class="onboarding-step-icon">${step.icon}</div>` : ''}
        <h3 class="onboarding-step-title">${step.title}</h3>
        <p class="onboarding-step-desc">${step.description}</p>
        ${isMobile && step.sectionName ? `<p class="onboarding-step-location">📍 ${step.sectionName}</p>` : ''}
      </div>
      <div class="onboarding-tooltip-footer">
        ${index > 0 ? '<button class="btn onboarding-btn onboarding-btn-prev" type="button">Anterior</button>' : '<div></div>'}
        <button class="btn onboarding-btn onboarding-btn-next" type="button">${isLast ? 'Entendido' : 'Siguiente'}</button>
      </div>
    `;

    el.querySelector('.onboarding-close-btn').addEventListener('click', () => this.engine.skip());
    el.querySelector('.onboarding-btn-next').addEventListener('click', () => this.engine.next());
    const prevBtn = el.querySelector('.onboarding-btn-prev');
    if (prevBtn) prevBtn.addEventListener('click', () => this.engine.prev());

    return el;
  }

  /* ── Positioning ───────────────────────────────────────── */
  _reposition(step) {
    if (!this.tooltipEl) return;
    const isMobile = window.innerWidth < 640;
    const stepData = step || this.engine.currentStep;
    const targetSel = isMobile && stepData?.targetSelectorMobile ? stepData.targetSelectorMobile : (stepData?.targetSelector || this.engine.currentStep?.targetSelector);
    if (!targetSel) return;
    const target = document.querySelector(targetSel);
    if (!target) return;
    if (isMobile) return;
    const position = stepData?.position || 'bottom';
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = this.tooltipEl.getBoundingClientRect();
    const gap = 14;
    let top, left;

    switch (position) {
      case 'top':
        top = targetRect.top - tooltipRect.height - gap;
        left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        break;
      case 'left':
        top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
        left = targetRect.left - tooltipRect.width - gap;
        break;
      case 'right':
        top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
        left = targetRect.right + gap;
        break;
      case 'bottom':
      default:
        top = targetRect.bottom + gap;
        left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        break;
    }

    top = Math.max(gap, Math.min(top, window.innerHeight - tooltipRect.height - gap));
    left = Math.max(gap, Math.min(left, window.innerWidth - tooltipRect.width - gap));

    this.tooltipEl.style.top = `${top + window.scrollY}px`;
    this.tooltipEl.style.left = `${left + window.scrollX}px`;
  }

  /* ── Highlight ─────────────────────────────────────────── */
  _highlightTarget(step) {
    const isMobile = window.innerWidth < 640;
    const sel = isMobile && step.targetSelectorMobile ? step.targetSelectorMobile : step.targetSelector;
    if (sel) {
      const target = document.querySelector(sel);
      if (target) {
        target.classList.add('onboarding-highlight');
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  _removeHighlight() {
    document.querySelectorAll('.onboarding-highlight').forEach(el => el.classList.remove('onboarding-highlight'));
  }

  /* ── Keyboard ──────────────────────────────────────────── */
  _handleKeyDown = (e) => {
    if (!this.engine.active) return;
    if (e.key === 'Escape') {
      this.engine.skip();
    } else if (e.key === 'ArrowRight' || (e.key === 'Enter' && e.target.closest('.onboarding-tooltip'))) {
      e.preventDefault();
      this.engine.next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.engine.prev();
    }
  }
}
