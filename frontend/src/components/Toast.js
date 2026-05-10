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

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function toast(type = 'info', title = '', message = '', duration = 4000, details = []) {
    const container = ensureContainer();
    const el = document.createElement('div');
    el.className = `toast ${type}`;

    const safeDetails = Array.isArray(details) ? details.filter((d) => d != null && String(d) !== '') : [];
    const detailsHtml = safeDetails.length > 0
        ? `<ul class="toast-details">${safeDetails.slice(0, 3).map((d) => `<li>${escapeHtml(String(d))}</li>`).join('')}${safeDetails.length > 3 ? `<li>y ${safeDetails.length - 3} más...</li>` : ''}</ul>`
        : '';

    el.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <div class="toast-body">
      ${title ? `<div class="toast-title">${escapeHtml(String(title))}</div>` : ''}
      ${message ? `<div class="toast-msg">${escapeHtml(String(message))}</div>` : ''}
      ${detailsHtml}
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
