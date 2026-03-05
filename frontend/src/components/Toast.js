/* ============================================================
   Toast notification system
   ============================================================ */

function ensureContainer() {
    let el = document.getElementById('toast-container');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast-container';
        document.body.appendChild(el);
    }
    return el;
}

const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

export function toast(type = 'info', title = '', message = '', duration = 4000) {
    const container = ensureContainer();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <div class="toast-body">
      ${title ? `<div class="toast-title">${title}</div>` : ''}
      ${message ? `<div class="toast-msg">${message}</div>` : ''}
    </div>
    <span class="toast-close" id="tc-${Date.now()}">✕</span>
  `;
    container.appendChild(el);
    const closeBtn = el.querySelector('.toast-close');
    const remove = () => { if (el.parentNode) container.removeChild(el); };
    closeBtn.addEventListener('click', remove);
    if (duration > 0) setTimeout(remove, duration);
    return remove;
}
