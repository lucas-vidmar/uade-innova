/* ============================================================
   UserManagement.js — Admin view: full user CRUD + reset password
   (Story 1.4 / 1.5 — app-owned Users table)
   ============================================================ */
import { api } from '../../services/api.js';
import { toast } from '../../components/Toast.js';
import { showConfirmDialog } from '../../components/Dialog.js';

const ROLE_BADGE = {
    student: 'badge-info',
    teacher: 'badge-primary',
    director: 'badge-warning',
    admin: 'badge-error',
};

const ROLE_LABELS = {
    student: 'Alumno',
    teacher: 'Docente',
    director: 'Director',
    admin: 'Admin',
};

function roleBadge(role) {
    const label = String(role || 'student').toLowerCase();
    const cls = ROLE_BADGE[label] || 'badge-neutral';
    return `<span class="badge ${cls}">${ROLE_LABELS[label] || label}</span>`;
}

function statusBadge(status) {
    if (status === 'disabled') {
        return '<span class="badge badge-neutral">Deshabilitado</span>';
    }
    return '<span class="badge badge-success">Activo</span>';
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function openCreateUserModal() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width:560px;width:94%;">
                <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                    <h3 class="h4" style="margin:0;">Nuevo usuario</h3>
                    <button type="button" class="btn btn-ghost btn-sm create-user-close" aria-label="Cerrar">✕</button>
                </div>
                <div class="modal-body">
                    <p id="create-user-error" style="display:none;color:var(--color-error);font-size:0.85rem;margin:0 0 12px;"></p>
                    <div style="display:grid;gap:12px;">
                        <div class="form-group" style="margin:0">
                            <label class="form-label" for="cu-userId">ID de usuario</label>
                            <input id="cu-userId" class="form-input" type="text" placeholder="Ej: alu-010" autocomplete="off" />
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                            <div class="form-group" style="margin:0">
                                <label class="form-label" for="cu-name">Nombre</label>
                                <input id="cu-name" class="form-input" type="text" placeholder="Nombre" />
                            </div>
                            <div class="form-group" style="margin:0">
                                <label class="form-label" for="cu-surname">Apellido</label>
                                <input id="cu-surname" class="form-input" type="text" placeholder="Apellido" />
                            </div>
                        </div>
                        <div class="form-group" style="margin:0">
                            <label class="form-label" for="cu-email">Email institucional</label>
                            <input id="cu-email" class="form-input" type="email" placeholder="nombre@uade.edu.ar" />
                        </div>
                        <div class="form-group" style="margin:0">
                            <label class="form-label" for="cu-role">Rol</label>
                            <select id="cu-role" class="form-input">
                                <option value="student">Alumno</option>
                                <option value="teacher">Docente</option>
                                <option value="director">Director</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;">
                            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:var(--fs-sm)">
                                <input type="checkbox" id="cu-random-password" /> Generar contraseña aleatoria
                            </label>
                        </div>
                        <div class="form-group" style="margin:0" id="cu-password-group">
                            <label class="form-label" for="cu-password">Contraseña</label>
                            <input id="cu-password" class="form-input" type="text" placeholder="Mínimo 8 caracteres" />
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-ghost create-user-cancel">Cancelar</button>
                    <button type="button" class="btn btn-primary create-user-confirm">Crear usuario</button>
                </div>
            </div>
        `;

        const close = (payload) => {
            overlay.remove();
            resolve(payload);
        };

        const passwordGroup = overlay.querySelector('#cu-password-group');
        const randomCheckbox = overlay.querySelector('#cu-random-password');
        const syncPasswordField = () => {
            if (randomCheckbox.checked) {
                passwordGroup.style.opacity = '0.5';
                passwordGroup.querySelector('input').disabled = true;
            } else {
                passwordGroup.style.opacity = '1';
                passwordGroup.querySelector('input').disabled = false;
            }
        };
        randomCheckbox.addEventListener('change', syncPasswordField);
        syncPasswordField();

        overlay.querySelector('.create-user-close')?.addEventListener('click', () => close(null));
        overlay.querySelector('.create-user-cancel')?.addEventListener('click', () => close(null));
        overlay.querySelector('.create-user-confirm')?.addEventListener('click', async () => {
            const payload = {
                userId: String(overlay.querySelector('#cu-userId').value || '').trim(),
                name: String(overlay.querySelector('#cu-name').value || '').trim(),
                surname: String(overlay.querySelector('#cu-surname').value || '').trim(),
                email: String(overlay.querySelector('#cu-email').value || '').trim(),
                role: overlay.querySelector('#cu-role').value,
                generatePassword: randomCheckbox.checked,
                password: randomCheckbox.checked ? undefined : overlay.querySelector('#cu-password').value,
            };

            const errorEl = overlay.querySelector('#create-user-error');
            const showError = (message) => {
                errorEl.textContent = message;
                errorEl.style.display = 'block';
            };
            errorEl.style.display = 'none';

            if (!payload.userId || !payload.name || !payload.email) {
                showError('Completá userId, nombre y email.');
                return;
            }
            if (!payload.generatePassword && !payload.password) {
                showError('Ingresá una contraseña o elegí generarla aleatoriamente.');
                return;
            }

            const confirmBtn = overlay.querySelector('.create-user-confirm');
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Creando...';
            try {
                const result = await api.createAdminUser(payload);
                const generated = result?.generatedPassword;
                close({ created: result?.data, generatedPassword: generated });
            } catch (err) {
                showError(err?.message || 'No se pudo crear el usuario.');
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Crear usuario';
            }
        });
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close(null);
        });

        document.body.appendChild(overlay);
        overlay.querySelector('#cu-userId')?.focus();
    });
}

export async function renderUserManagement(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="h2">Administración de Usuarios</h1>
            <p class="text-secondary">Gestioná las cuentas institucionales, roles y contraseñas de la plataforma.</p>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-bottom:var(--space-4)">
            <button class="btn btn-primary" id="btn-create-user">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:6px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Nuevo usuario
            </button>
        </div>

        <div class="card animate-in">
            <div id="users-table-container">
                <div class="loading-state">
                    <div class="animate-pulse">Cargando usuarios...</div>
                </div>
            </div>
        </div>
    `;

    const tableContainer = document.getElementById('users-table-container');

    const refresh = async () => {
        tableContainer.innerHTML = `
            <div class="loading-state"><div class="animate-pulse">Cargando usuarios...</div></div>
        `;
        const users = await api.getAdminUsers();
        renderTable(users);
    };

    const renderTable = (users) => {
        if (!users || users.length === 0) {
            tableContainer.innerHTML = `
                <div class="empty-state" style="padding:var(--space-8);text-align:center">
                    <div class="empty-state-icon">👤</div>
                    <p>No hay usuarios registrados todavía.</p>
                </div>
            `;
            return;
        }

        tableContainer.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>Usuario</th>
                        <th>Email</th>
                        <th>Rol</th>
                        <th>Estado</th>
                        <th>Contraseña</th>
                        <th style="text-align:center">Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map((user) => `
                        <tr data-user-id="${escapeHtml(user.id)}">
                            <td>
                                <div style="display:flex;align-items:center;gap:var(--space-2);">
                                    <div class="avatar-sm" style="background:var(--color-primary);color:white;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:bold;border-radius:4px;width:28px;height:28px;">
                                        ${escapeHtml(String(user.name || user.id).substring(0, 2).toUpperCase())}
                                    </div>
                                    <div>
                                        <div><strong>${escapeHtml(`${user.name || ''} ${user.surname || ''}`.trim() || user.id)}</strong></div>
                                        <code style="font-size:0.75rem;color:var(--color-text-secondary)">${escapeHtml(user.id)}</code>
                                    </div>
                                </div>
                            </td>
                            <td>${escapeHtml(user.email || '—')}</td>
                            <td>${roleBadge(user.role)}</td>
                            <td>${statusBadge(user.status)}</td>
                            <td>
                                ${user.mustChangePassword
                                    ? '<span class="badge badge-warning">Requiere cambio</span>'
                                    : '<span class="badge badge-neutral">—</span>'}
                            </td>
                            <td style="text-align:center;white-space:nowrap">
                                <button class="btn btn-secondary btn-sm btn-edit-user" title="Editar rol/estado">Editar</button>
                                <button class="btn btn-secondary btn-sm btn-reset-pw" title="Resetear contraseña">Reset PW</button>
                                <button class="btn btn-danger btn-sm btn-delete-user" title="Eliminar usuario">Eliminar</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        tableContainer.querySelectorAll('.btn-edit-user').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                const userId = row?.getAttribute('data-user-id');
                const user = users.find((u) => String(u.id) === userId);
                if (!user) return;
                openEditUserModal(user, refresh);
            });
        });

        tableContainer.querySelectorAll('.btn-reset-pw').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                const userId = row?.getAttribute('data-user-id');
                const user = users.find((u) => String(u.id) === userId);
                if (!user) return;
                const confirmed = await showConfirmDialog({
                    title: 'Resetear contraseña',
                    message: `Se va a resetear la contraseña de "${user.name || user.id}". El usuario deberá cambiarla al iniciar sesión.`,
                    confirmText: 'Resetear',
                    cancelText: 'Cancelar',
                });
                if (!confirmed) return;
                try {
                    const result = await api.resetAdminUserPassword(user.id);
                    const generated = result?.generatedPassword;
                    toast('success', 'Contraseña reseteada',
                        generated
                            ? `Nueva contraseña: ${generated}. Mostrala al usuario y luego guardala de forma segura.`
                            : 'La contraseña fue reseteada. El usuario deberá cambiarla.');
                    await refresh();
                } catch (err) {
                    toast('error', 'Error', err?.message || 'No se pudo resetear la contraseña.');
                }
            });
        });

        tableContainer.querySelectorAll('.btn-delete-user').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                const userId = row?.getAttribute('data-user-id');
                const user = users.find((u) => String(u.id) === userId);
                if (!user) return;
                const confirmed = await showConfirmDialog({
                    title: 'Eliminar usuario',
                    message: `¿Seguro que querés eliminar a "${user.name || user.id}"? Se revocarán sus sesiones y no podrá volver a ingresar.`,
                    confirmText: 'Eliminar',
                    cancelText: 'Cancelar',
                    danger: true,
                });
                if (!confirmed) return;
                try {
                    await api.deleteAdminUser(user.id);
                    toast('success', 'Usuario eliminado', 'El usuario fue eliminado y sus sesiones revocadas.');
                    await refresh();
                } catch (err) {
                    toast('error', 'Error', err?.message || 'No se pudo eliminar el usuario.');
                }
            });
        });
    };

    function openEditUserModal(user, onSaved) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width:480px;width:94%;">
                <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                    <h3 class="h4" style="margin:0;">Editar ${escapeHtml(user.name || user.id)}</h3>
                    <button type="button" class="btn btn-ghost btn-sm edit-user-close" aria-label="Cerrar">✕</button>
                </div>
                <div class="modal-body">
                    <p id="edit-user-error" style="display:none;color:var(--color-error);font-size:0.85rem;margin:0 0 12px;"></p>
                    <div style="display:grid;gap:12px;">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                            <div class="form-group" style="margin:0">
                                <label class="form-label" for="eu-name">Nombre</label>
                                <input id="eu-name" class="form-input" type="text" value="${escapeHtml(user.name || '')}" />
                            </div>
                            <div class="form-group" style="margin:0">
                                <label class="form-label" for="eu-surname">Apellido</label>
                                <input id="eu-surname" class="form-input" type="text" value="${escapeHtml(user.surname || '')}" />
                            </div>
                        </div>
                        <div class="form-group" style="margin:0">
                            <label class="form-label" for="eu-email">Email institucional</label>
                            <input id="eu-email" class="form-input" type="email" value="${escapeHtml(user.email || '')}" />
                        </div>
                        <div class="form-group" style="margin:0">
                            <label class="form-label" for="eu-role">Rol</label>
                            <select id="eu-role" class="form-input">
                                <option value="student" ${user.role === 'student' ? 'selected' : ''}>Alumno</option>
                                <option value="teacher" ${user.role === 'teacher' ? 'selected' : ''}>Docente</option>
                                <option value="director" ${user.role === 'director' ? 'selected' : ''}>Director</option>
                                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                            </select>
                        </div>
                        <div class="form-group" style="margin:0">
                            <label class="form-label" for="eu-status">Estado</label>
                            <select id="eu-status" class="form-input">
                                <option value="active" ${user.status !== 'disabled' ? 'selected' : ''}>Activo</option>
                                <option value="disabled" ${user.status === 'disabled' ? 'selected' : ''}>Deshabilitado</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-ghost edit-user-cancel">Cancelar</button>
                    <button type="button" class="btn btn-primary edit-user-save">Guardar cambios</button>
                </div>
            </div>
        `;

        const close = () => overlay.remove();
        const errorEl = overlay.querySelector('#edit-user-error');
        const showError = (message) => {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        };

        overlay.querySelector('.edit-user-close')?.addEventListener('click', close);
        overlay.querySelector('.edit-user-cancel')?.addEventListener('click', close);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close();
        });

        overlay.querySelector('.edit-user-save')?.addEventListener('click', async () => {
            errorEl.style.display = 'none';
            const payload = {
                name: String(overlay.querySelector('#eu-name').value || '').trim(),
                surname: String(overlay.querySelector('#eu-surname').value || '').trim(),
                email: String(overlay.querySelector('#eu-email').value || '').trim(),
                role: overlay.querySelector('#eu-role').value,
                status: overlay.querySelector('#eu-status').value,
            };
            const saveBtn = overlay.querySelector('.edit-user-save');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Guardando...';
            try {
                await api.updateAdminUser(user.id, payload);
                close();
                toast('success', 'Usuario actualizado', 'Los cambios se guardaron correctamente.');
                await onSaved();
            } catch (err) {
                showError(err?.message || 'No se pudo guardar los cambios.');
                saveBtn.disabled = false;
                saveBtn.textContent = 'Guardar cambios';
            }
        });

        document.body.appendChild(overlay);
    }

    document.getElementById('btn-create-user')?.addEventListener('click', async () => {
        const result = await openCreateUserModal();
        if (!result) return;
        if (result.generatedPassword) {
            toast('success', 'Usuario creado',
                `Contraseña generada: ${result.generatedPassword}. Mostrala al usuario y luego guardala de forma segura.`);
        } else {
            toast('success', 'Usuario creado', 'El usuario fue creado correctamente.');
        }
        await refresh();
    });

    await refresh();
}
