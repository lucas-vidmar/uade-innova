/* ============================================================
   dialog-focus.js — foco para diálogos modales (issue #377)
   Mueve el foco al diálogo, contiene el tabulador, marca el fondo
   como inerte y devuelve el foco al cerrar. Escape queda a cargo
   del llamador, que decide si eso cierra o cancela.
   ============================================================ */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE)].filter(el => {
    if (el.closest('[hidden]') || el.getAttribute('aria-hidden') === 'true') return false;
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
  });
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.dialog        contenedor del diálogo (recibe el foco si no hay focos internos)
 * @param {HTMLElement[]} [opts.background] elementos del fondo a marcar como `inert`
 * @param {string} [opts.initialFocus]     selector del primer foco dentro del diálogo
 * @param {() => void} [opts.onEscape]     qué hacer con Escape
 * @returns {() => void} release()         quita el manejo, restaura el fondo y el foco previo
 */
export function createDialogFocus({ dialog, background = [], initialFocus, onEscape }) {
  const previouslyFocused = document.activeElement;
  const inerted = [];

  for (const el of background) {
    if (!el || el.hasAttribute('inert')) continue;
    el.setAttribute('inert', '');
    inerted.push(el);
  }

  const focusFirst = () => {
    if (initialFocus === 'dialog') {
      if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
      dialog.focus({ preventScroll: true });
      return;
    }
    const target = (initialFocus && dialog.querySelector(initialFocus)) || focusableWithin(dialog)[0];
    if (target) { target.focus({ preventScroll: true }); return; }
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    dialog.focus({ preventScroll: true });
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onEscape === 'function') onEscape();
      return;
    }
    if (event.key !== 'Tab') return;

    const items = focusableWithin(dialog);
    if (items.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
      return;
    }
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus({ preventScroll: true }); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus({ preventScroll: true }); }
  };

  document.addEventListener('keydown', onKeyDown, true);
  focusFirst();

  return function release() {
    document.removeEventListener('keydown', onKeyDown, true);
    for (const el of inerted) el.removeAttribute('inert');
    if (previouslyFocused && document.contains(previouslyFocused) && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus({ preventScroll: true });
    }
  };
}
