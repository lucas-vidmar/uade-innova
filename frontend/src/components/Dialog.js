export function showConfirmDialog({
    title = 'Confirmar accion',
    message = '',
    detailsHtml = '',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    danger = false,
    confirmCheckbox = '',
}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 460px; width: 92%;">
                <div class="modal-header" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                    <h3 class="h4" style="margin:0;">${escapeHtml(title)}</h3>
                    <button type="button" class="btn btn-ghost btn-sm dialog-close" aria-label="Cerrar">✕</button>
                </div>
                <div class="modal-body">
                    <p style="margin:0 0 ${detailsHtml ? '12px' : '0'}; color:var(--color-text-secondary);">${escapeHtml(message)}</p>
                    ${detailsHtml ? `<div style="background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-3);font-size:var(--font-size-xs);color:var(--color-text-secondary);">${detailsHtml}</div>` : ''}
                    ${confirmCheckbox ? `
                        <label class="dialog-checkbox-row">
                            <input type="checkbox" class="dialog-confirm-checkbox" />
                            <span class="dialog-checkbox-label">${escapeHtml(confirmCheckbox)}</span>
                        </label>
                    ` : ''}
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-ghost dialog-cancel">${escapeHtml(cancelText)}</button>
                    <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} dialog-confirm" ${confirmCheckbox ? 'disabled' : ''}>${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        const confirmBtn = overlay.querySelector('.dialog-confirm');
        const checkbox = overlay.querySelector('.dialog-confirm-checkbox');
        if (confirmBtn && checkbox) {
            const syncDisabled = () => {
                confirmBtn.disabled = !checkbox.checked;
            };
            checkbox.addEventListener('change', syncDisabled);
            syncDisabled();
        }

        overlay.querySelector('.dialog-close')?.addEventListener('click', () => cleanup(false));
        overlay.querySelector('.dialog-cancel')?.addEventListener('click', () => cleanup(false));
        overlay.querySelector('.dialog-confirm')?.addEventListener('click', () => {
            if (confirmBtn?.disabled) return;
            cleanup(true);
        });
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) cleanup(false);
        });

        document.body.appendChild(overlay);
    });
}

export function showPromptDialog({
    title = 'Ingresar valor',
    label = 'Valor',
    initialValue = '',
    placeholder = '',
    confirmText = 'Guardar',
    cancelText = 'Cancelar',
    required = true,
}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 520px; width: 92%;">
                <div class="modal-header" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                    <h3 class="h4" style="margin:0;">${escapeHtml(title)}</h3>
                    <button type="button" class="btn btn-ghost btn-sm dialog-close" aria-label="Cerrar">✕</button>
                </div>
                <div class="modal-body">
                    <label class="form-label" for="dialog-prompt-input">${escapeHtml(label)}</label>
                    <input id="dialog-prompt-input" class="form-input" type="text" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(initialValue)}" />
                    <p class="text-secondary" id="dialog-prompt-error" style="display:none; margin-top:8px; color:var(--color-error);"></p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-ghost dialog-cancel">${escapeHtml(cancelText)}</button>
                    <button type="button" class="btn btn-primary dialog-confirm">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;

        const input = overlay.querySelector('#dialog-prompt-input');
        const errorEl = overlay.querySelector('#dialog-prompt-error');

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        const validateAndResolve = () => {
            const value = String(input?.value || '').trim();
            if (required && !value) {
                if (errorEl) {
                    errorEl.textContent = 'Este campo es obligatorio.';
                    errorEl.style.display = 'block';
                }
                input?.focus();
                return;
            }
            cleanup(value);
        };

        overlay.querySelector('.dialog-close')?.addEventListener('click', () => cleanup(null));
        overlay.querySelector('.dialog-cancel')?.addEventListener('click', () => cleanup(null));
        overlay.querySelector('.dialog-confirm')?.addEventListener('click', validateAndResolve);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) cleanup(null);
        });

        input?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                validateAndResolve();
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                cleanup(null);
            }
        });

        document.body.appendChild(overlay);
        input?.focus();
        input?.select();
    });
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
