/* ============================================================
   ChangePasswordForm — self-service password change (Story 1.5)
   Verifies the current password server-side; on success the new
   hash is stored and other sessions are revoked.
   ============================================================ */
import { auth } from '../services/auth.js';
import { toast } from './Toast.js';

export function renderChangePasswordCard(container, options = {}) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
        <div class="card" style="padding:var(--space-6);margin-bottom:var(--space-6)">
            <h3 style="margin:0 0 var(--space-2)">${options.title || 'Cambiar contraseña'}</h3>
            <p style="font-size:var(--fs-sm);color:var(--color-text-secondary);margin:0 0 var(--space-4)">
                Verificá tu contraseña actual para actualizarla.
            </p>
            <form id="change-password-form" novalidate style="display:grid;gap:var(--space-3);max-width:360px">
                <div class="form-group" style="margin:0">
                    <label class="form-label" for="cp-current">Contraseña actual</label>
                    <input id="cp-current" class="form-input" type="password" autocomplete="current-password" required />
                </div>
                <div class="form-group" style="margin:0">
                    <label class="form-label" for="cp-new">Nueva contraseña</label>
                    <input id="cp-new" class="form-input" type="password" autocomplete="new-password" minlength="8" required />
                    <p class="text-xs text-text-muted" style="margin-top:4px">Mínimo 8 caracteres.</p>
                </div>
                <div class="form-group" style="margin:0">
                    <label class="form-label" for="cp-confirm">Confirmar nueva contraseña</label>
                    <input id="cp-confirm" class="form-input" type="password" autocomplete="new-password" minlength="8" required />
                </div>
                <p id="cp-error" class="text-secondary" style="color:var(--color-error);font-size:0.85rem;margin:0;display:none"></p>
                <button type="submit" id="cp-submit" class="btn btn-primary" style="width:100%">Cambiar contraseña</button>
            </form>
        </div>
    `;

    const form = wrapper.querySelector('#change-password-form');
    const errorEl = wrapper.querySelector('#cp-error');
    const submitBtn = wrapper.querySelector('#cp-submit');
    const showError = (message) => {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const current = form.querySelector('#cp-current').value;
        const next = form.querySelector('#cp-new').value;
        const confirm = form.querySelector('#cp-confirm').value;

        if (!current || !next) {
            showError('Completá todos los campos.');
            return;
        }
        if (next.length < 8) {
            showError('La contraseña debe tener al menos 8 caracteres.');
            return;
        }
        if (next !== confirm) {
            showError('Las contraseñas nuevas no coinciden.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Guardando...';
        try {
            await auth.changePassword(current, next);
            form.reset();
            toast('success', 'Contraseña actualizada', 'Tu contraseña fue cambiada correctamente.');
        } catch (err) {
            const message = err?.message || 'No se pudo cambiar la contraseña.';
            if (err?.code === 'INVALID_CURRENT_PASSWORD' || err?.status === 401) {
                showError('La contraseña actual es incorrecta.');
            } else {
                showError(message);
            }
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Cambiar contraseña';
        }
    });

    container.appendChild(wrapper);
}
