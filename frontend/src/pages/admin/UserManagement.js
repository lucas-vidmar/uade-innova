/* ============================================================
   UserManagement.js — Admin view: full user CRUD + reset password
   (Story 1.4 / 1.5 — app-owned Users table)
   ============================================================ */
import { api } from '../../services/api.js';
import { enrollments as enrollmentService } from '../../services/enrollments.js';
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

/**
 * Permisos vigentes de la fila (UJ-52 pasos 2 y 3): las materias en las que la
 * persona figura con matrícula activa. Es lo que el corte va a dejar sin dueño.
 */
function activePermissionsFor(user) {
    return (user?.enrollments || [])
        .filter((e) => e && e.status === 'active')
        .map((e) => e.subjectId);
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

        <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:var(--space-4)">
            <button class="btn btn-secondary" id="btn-access-review" title="Inventario de permisos con su evidencia, huérfanos y acta">
                Revisión de permisos
            </button>
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
        await loadEnrollmentsForUsers(users);
        renderTable(users);
    };

    const loadEnrollmentsForUsers = async (users) => {
        await Promise.all((users || []).map(async (user) => {
            try {
                const enrollmentsList = await api.getEnrollments(user.id);
                user.enrollments = Array.isArray(enrollmentsList) ? enrollmentsList : (enrollmentsList?.data || []);
            } catch (err) {
                console.warn(`[UserManagement] Error loading enrollments for ${user.id}:`, err);
                user.enrollments = [];
            }
        }));
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
                        <th>Materias</th>
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
                            <td>
                                <span class="user-subjects-count" data-user-id="${escapeHtml(user.id)}">…</span>
                            </td>
                            <td style="text-align:center;white-space:nowrap">
                                <button class="btn btn-secondary btn-sm btn-edit-user" title="Editar usuario">Editar</button>
                                <button class="btn btn-secondary btn-sm btn-manage-subjects" title="Asignar materias">Materias</button>
                                <button class="btn btn-secondary btn-sm btn-reset-pw" title="Resetear contraseña">Reset PW</button>
                                <button class="btn btn-secondary btn-sm btn-identity-audit" title="Ver la constancia de los cambios de esta identidad">Constancia</button>
                                <button class="btn btn-danger btn-sm btn-delete-user" title="Eliminar usuario">Eliminar</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        users.forEach((user) => {
            if (user.enrollments && Array.isArray(user.enrollments)) {
                const countEl = tableContainer.querySelector(`.user-subjects-count[data-user-id="${escapeHtml(user.id)}"]`);
                if (countEl) {
                    const label = user.enrollments.length > 0
                        ? `${user.enrollments.length} materia${user.enrollments.length === 1 ? '' : 's'}`
                        : '—';
                    countEl.innerHTML = `<span class="badge ${user.enrollments.length > 0 ? 'badge-info' : 'badge-neutral'}">${escapeHtml(label)}</span>`;
                }
            }
        });

        tableContainer.querySelectorAll('.btn-edit-user').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                const userId = row?.getAttribute('data-user-id');
                const user = users.find((u) => String(u.id) === userId);
                if (!user) return;
                openEditUserModal(user, refresh);
            });
        });

        tableContainer.querySelectorAll('.btn-manage-subjects').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                const userId = row?.getAttribute('data-user-id');
                const user = users.find((u) => String(u.id) === userId);
                if (!user) return;
                await openManageSubjectsModal(user, refresh);
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

        tableContainer.querySelectorAll('.btn-identity-audit').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                const userId = row?.getAttribute('data-user-id');
                const user = users.find((u) => String(u.id) === userId);
                if (!user) return;
                openIdentityAuditModal(user);
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
                    message: `¿Seguro que querés eliminar a "${user.name || user.id}"? Se revocarán sus sesiones y no podrá volver a ingresar.${
                        activePermissionsFor(user).length > 0
                            ? ` También se retiran sus permisos activos (${activePermissionsFor(user).length}): ${activePermissionsFor(user).join(', ')}.`
                            : ''
                    }`,
                    confirmText: 'Eliminar',
                    cancelText: 'Cancelar',
                    danger: true,
                });
                if (!confirmed) return;
                try {
                    const result = await api.deleteAdminUser(user.id);
                    const retired = result?.revokedEnrollments?.count || 0;
                    toast('success', 'Usuario eliminado',
                        retired > 0
                            ? `El usuario fue eliminado, sus sesiones revocadas y ${retired} permiso${retired === 1 ? '' : 's'} retirado${retired === 1 ? '' : 's'}.`
                            : 'El usuario fue eliminado y sus sesiones revocadas.');
                    await refresh();
                } catch (err) {
                    toast('error', 'Error', err?.message || 'No se pudo eliminar el usuario.');
                }
            });
        });
    };

    async function openManageSubjectsModal(user, onSaved) {
        let overlay = null;

        const buildOptions = (subjects, currentIds) => {
            return subjects.map((subject) => {
                const checked = currentIds.includes(subject.id);
                return `
                    <label class="subject-assign-row" style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--color-border);cursor:pointer;">
                        <input type="checkbox" class="subject-assign-check" value="${escapeHtml(subject.id)}" ${checked ? 'checked' : ''} style="width:16px;height:16px;flex:none;" />
                        <span style="flex:1;font-size:var(--fs-sm);">
                            <span style="display:block;font-weight:600;">${escapeHtml(subject.name || subject.id)}</span>
                            <span style="display:block;font-size:0.75rem;color:var(--color-text-secondary);">${escapeHtml(subject.id)}</span>
                        </span>
                    </label>
                `;
            }).join('');
        };

        const open = () => {
            return new Promise((resolve) => {
                overlay = document.createElement('div');
                overlay.className = 'modal-overlay';
                overlay.innerHTML = `
                    <div class="modal-content" style="max-width:560px;width:94%;">
                        <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                            <h3 class="h4" style="margin:0;">Materias de ${escapeHtml(user.name || user.id)}</h3>
                            <button type="button" class="btn btn-ghost btn-sm ms-close" aria-label="Cerrar">✕</button>
                        </div>
                        <div class="modal-body">
                            <p id="ms-error" style="display:none;color:var(--color-error);font-size:0.85rem;margin:0 0 12px;"></p>
                            <div id="ms-loading" class="loading-state"><div class="animate-pulse">Cargando materias...</div></div>
                            <div id="ms-list" style="display:none;max-height:420px;overflow-y:auto;border:1px solid var(--color-border);border-radius:8px;padding:4px 12px;"></div>
                        </div>
                        <div class="modal-footer">
                            <span id="ms-selected-count" class="text-secondary" style="margin-right:auto;font-size:var(--fs-sm);"></span>
                            <button type="button" class="btn btn-ghost ms-cancel">Cancelar</button>
                            <button type="button" class="btn btn-primary ms-save" disabled>Guardar</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);
                resolve(overlay);
            });
        };

        const close = () => overlay?.remove();

        try {
            const [subjectsList, enrollmentsList] = await Promise.all([
                api.getSubjects(),
                (async () => {
                    try {
                        const data = await api.getEnrollments(user.id);
                        return Array.isArray(data) ? data : (data?.data || []);
                    } catch {
                        return [];
                    }
                })(),
            ]);
            const subjects = Array.isArray(subjectsList) ? subjectsList : [];
            const currentIds = Array.isArray(enrollmentsList)
                ? enrollmentsList
                    .filter((e) => e && e.status === 'active')
                    .map((e) => e.subjectId)
                : [];

            await open();

            const listEl = overlay.querySelector('#ms-list');
            const loadingEl = overlay.querySelector('#ms-loading');
            const errorEl = overlay.querySelector('#ms-error');
            const saveBtn = overlay.querySelector('.ms-save');
            const countEl = overlay.querySelector('#ms-selected-count');

            if (subjects.length === 0) {
                loadingEl.style.display = 'none';
                listEl.style.display = 'block';
                listEl.innerHTML = '<div class="empty-state" style="padding:var(--space-6);text-align:center;"><div class="empty-state-icon">📚</div><p>No hay materias disponibles.</p></div>';
                return;
            }

            let selected = new Set(currentIds);
            listEl.innerHTML = buildOptions(subjects, currentIds);
            listEl.style.display = 'block';
            loadingEl.style.display = 'none';

            const updateCount = () => {
                countEl.textContent = `${selected.size} materia${selected.size === 1 ? '' : 's'} asignada${selected.size === 1 ? '' : 's'}`;
                saveBtn.disabled = false;
            };
            updateCount();

            overlay.querySelectorAll('.subject-assign-check').forEach((checkbox) => {
                checkbox.addEventListener('change', () => {
                    const value = checkbox.value;
                    if (checkbox.checked) {
                        selected.add(value);
                    } else {
                        selected.delete(value);
                    }
                    updateCount();
                });
            });

            const save = async () => {
                const target = new Set(selected);
                saveBtn.disabled = true;
                saveBtn.textContent = 'Guardando...';
                const added = subjects.filter((s) => target.has(s.id) && !currentIds.includes(s.id));
                const removed = currentIds.filter((id) => !target.has(id));
                try {
                    await Promise.all([
                        ...added.map(async (subject) => {
                            try {
                                await api.createEnrollment(subject.id, user.id, 'student', 'active');
                            } catch (err) {
                                console.warn(`[UserManagement] Error enrolling ${user.id} in ${subject.id}:`, err);
                            }
                        }),
                        ...removed.map(async (subjectId) => {
                            try {
                                await api.deleteEnrollment(subjectId, user.id);
                            } catch (err) {
                                console.warn(`[UserManagement] Error unenrolling ${user.id} from ${subjectId}:`, err);
                            }
                        }),
                        ...added.map((subject) => enrollmentService.clearCache(user.id)),
                    ]);
                    enrollmentService.clearCache(user.id);
                    close();
                    toast('success', 'Asignación actualizada',
                        `${user.name || user.id} quedó con ${target.size} materia${target.size === 1 ? '' : 's'} asignada${target.size === 1 ? '' : 's'}.`);
                    await onSaved();
                } catch (err) {
                    errorEl.textContent = err?.message || 'No se pudo guardar la asignación de materias.';
                    errorEl.style.display = 'block';
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Guardar';
                }
            };

            overlay.querySelector('.ms-close')?.addEventListener('click', close);
            overlay.querySelector('.ms-cancel')?.addEventListener('click', close);
            overlay.querySelector('.ms-save')?.addEventListener('click', save);
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) close();
            });
        } catch (err) {
            console.error('[UserManagement] Error opening subject modal:', err);
            await open();
            const listEl = overlay.querySelector('#ms-list');
            const loadingEl = overlay.querySelector('#ms-loading');
            loadingEl.style.display = 'none';
            listEl.style.display = 'block';
            listEl.innerHTML = `<div class="empty-state" style="padding:var(--space-6);text-align:center;"><p>No se pudieron cargar las materias.</p></div>`;
        }
    }

    const AUDIT_ACTION_LABELS = {
        create: 'Alta',
        update: 'Cambio',
        disable: 'Corte de acceso',
        enable: 'Rehabilitación',
        delete: 'Baja',
        'reset-password': 'Reseteo de contraseña',
    };

    /**
     * UJ-52 paso 9: la constancia del corte, legible por alguien que no
     * participó — qué se cerró, cuándo, quién lo hizo, por qué y con qué alcance.
     */
    async function openIdentityAuditModal(user) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width:680px;width:94%;">
                <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                    <h3 class="h4" style="margin:0;">Constancia de ${escapeHtml(user.name || user.id)}</h3>
                    <button type="button" class="btn btn-ghost btn-sm audit-close" aria-label="Cerrar">✕</button>
                </div>
                <div class="modal-body">
                    <div id="audit-loading" class="loading-state"><div class="animate-pulse">Leyendo la constancia...</div></div>
                    <p id="audit-error" style="display:none;color:var(--color-error);font-size:0.85rem;margin:0 0 12px;"></p>
                    <div id="audit-list" style="display:none;max-height:420px;overflow-y:auto;"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-ghost audit-close">Cerrar</button>
                </div>
            </div>
        `;
        const close = () => overlay.remove();
        overlay.querySelectorAll('.audit-close').forEach((b) => b.addEventListener('click', close));
        overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
        document.body.appendChild(overlay);

        const loadingEl = overlay.querySelector('#audit-loading');
        const errorEl = overlay.querySelector('#audit-error');
        const listEl = overlay.querySelector('#audit-list');

        const formatDate = (iso) => {
            if (!iso) return 'sin fecha';
            const d = new Date(iso);
            return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('es-AR');
        };
        const formatScope = (scope) => {
            if (!scope || typeof scope !== 'object') return null;
            const parts = Object.entries(scope).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`);
            return parts.join(' · ');
        };

        try {
            const trail = await api.getIdentityAudit(user.id);
            loadingEl.style.display = 'none';
            if (!trail || trail.length === 0) {
                listEl.style.display = 'block';
                listEl.innerHTML = '<div class="empty-state" style="padding:var(--space-6);text-align:center;"><p>Todavía no hay cambios asentados para esta identidad.</p></div>';
                return;
            }
            listEl.style.display = 'block';
            listEl.innerHTML = trail.map((entry) => `
                <div style="border-bottom:1px solid var(--color-border);padding:10px 4px;">
                    <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;">
                        <strong>${escapeHtml(AUDIT_ACTION_LABELS[entry.action] || entry.action)}</strong>
                        <span class="text-secondary" style="font-size:0.8rem;">${escapeHtml(formatDate(entry.at))}</span>
                    </div>
                    <div style="font-size:0.85rem;margin-top:4px;">
                        ${entry.actor ? `Lo hizo <code>${escapeHtml(entry.actor)}</code>${entry.actorRole ? ` (${escapeHtml(entry.actorRole)})` : ''}.` : 'Autor sin registrar.'}
                        ${entry.reason ? `<div style="margin-top:4px;"><em>Motivo:</em> ${escapeHtml(entry.reason)}</div>` : '<div style="margin-top:4px;" class="text-secondary"><em>Sin motivo asentado.</em></div>'}
                        ${(entry.before || entry.after) ? `<div style="margin-top:4px;" class="text-secondary">Estado: ${escapeHtml(entry.before?.status || '—')} → ${escapeHtml(entry.after?.status || '—')}</div>` : ''}
                        ${formatScope(entry.scope) ? `<div style="margin-top:4px;" class="text-secondary">Alcance: ${formatScope(entry.scope)}</div>` : ''}
                    </div>
                </div>
            `).join('');
        } catch (err) {
            loadingEl.style.display = 'none';
            errorEl.textContent = err?.message || 'No se pudo leer la constancia.';
            errorEl.style.display = 'block';
        }
    }

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
                            <p id="eu-permissions-hint" class="text-secondary" style="font-size:0.8rem;margin:6px 0 0;display:none;"></p>
                        </div>
                        <div class="form-group" style="margin:0" id="eu-reason-group">
                            <label class="form-label" for="eu-reason">Motivo del corte</label>
                            <textarea id="eu-reason" class="form-input" rows="2" placeholder="Por qué se corta el acceso (queda asentado en la constancia)"></textarea>
                        </div>
                        <div class="form-group" style="margin:0">
                            <label class="form-label" for="eu-reason">Motivo del cambio</label>
                            <input id="eu-reason" class="form-input" type="text" placeholder="Por qué cambia el rol o el estado" />
                            <p class="text-secondary" style="font-size:0.75rem;margin:6px 0 0;">
                                ${user.grantReason
                                    ? `Acto vigente: ${escapeHtml(user.grantedBy || 'sin dueño')} · ${escapeHtml(String(user.grantedAt || '').slice(0, 10))} · ${escapeHtml(user.grantReason)}`
                                    : '<span style="color:var(--color-error);">El permiso vigente no tiene acto que lo respalde (huérfano): el motivo de este cambio queda como su evidencia.</span>'}
                            </p>
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

        // UJ-52 paso 9: el motivo del corte se pide cuando se corta y queda
        // asentado; para un cambio que no corta, el campo no aplica.
        const statusSelect = overlay.querySelector('#eu-status');
        const reasonGroup = overlay.querySelector('#eu-reason-group');
        // UJ-52 paso 2/3: antes de cortar, quien opera tiene que ver qué
        // permisos activos van a quedar sin dueño con el corte. La lista sale de
        // las matrículas ya cargadas para la fila, no de una suposición.
        const permissionsHint = overlay.querySelector('#eu-permissions-hint');
        const activePermissions = activePermissionsFor(user);
        const syncReasonGroup = () => {
            const cortando = statusSelect.value === 'disabled';
            reasonGroup.style.display = cortando ? '' : 'none';
        };
        const syncPermissionsHint = () => {
            if (statusSelect.value !== 'disabled' || activePermissions.length === 0) {
                permissionsHint.style.display = 'none';
                return;
            }
            permissionsHint.textContent = `Al deshabilitar, se retiran sus permisos activos (${activePermissions.length}): ${activePermissions.join(', ')}. Reasigná lo que no pueda quedar sin responsable.`;
            permissionsHint.style.display = 'block';
        };
        statusSelect?.addEventListener('change', () => { syncReasonGroup(); syncPermissionsHint(); });
        syncReasonGroup();
        syncPermissionsHint();

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
                // UJ-53: el cambio de rol o estado se asienta con su motivo.
                reason: String(overlay.querySelector('#eu-reason')?.value || '').trim(),
            };
            const reason = String(overlay.querySelector('#eu-reason')?.value || '').trim();
            if (payload.status === 'disabled' && reason) payload.reason = reason;
            const saveBtn = overlay.querySelector('.edit-user-save');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Guardando...';
            try {
                const result = await api.updateAdminUser(user.id, payload);
                close();
                const retired = result?.revokedEnrollments?.count || 0;
                toast('success', 'Usuario actualizado',
                    retired > 0
                        ? `Los cambios se guardaron y se retiraron ${retired} permiso${retired === 1 ? '' : 's'} activo${retired === 1 ? '' : 's'}.`
                        : (payload.status === 'disabled'
                            ? 'Los cambios se guardaron y el corte quedó asentado en la constancia.'
                            : 'Los cambios se guardaron correctamente.'));
                await onSaved();
            } catch (err) {
                showError(err?.message || 'No se pudo guardar los cambios.');
                saveBtn.disabled = false;
                saveBtn.textContent = 'Guardar cambios';
            }
        });

        document.body.appendChild(overlay);
    }

    /**
     * UJ-53 — Revisión periódica de permisos con evidencia.
     *
     * El inventario que se muestra es el que arma el backend con lo que la tabla
     * tiene: cada permiso con su acto (dueño, motivo y fecha) o marcado como
     * huérfano con el dato que le falta. Sobre cada permiso se decide sostener,
     * reducir o retirar; la decisión exige motivo y queda asentada con su efecto.
     * Al final el acta se exporta y se firma contra el digest de lo aplicado.
     */
    async function openAccessReviewModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width:1000px;width:96%;">
                <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                    <h3 class="h4" style="margin:0;">Revisión de permisos</h3>
                    <button type="button" class="btn btn-ghost btn-sm ar-close" aria-label="Cerrar">✕</button>
                </div>
                <div class="modal-body">
                    <p id="ar-error" style="display:none;color:var(--color-error);font-size:0.85rem;margin:0 0 12px;"></p>
                    <div id="ar-head" class="text-secondary" style="font-size:var(--fs-sm);margin-bottom:12px;"></div>
                    <div id="ar-loading" class="loading-state"><div class="animate-pulse">Armando el inventario…</div></div>
                    <div id="ar-table" style="display:none;max-height:420px;overflow:auto;"></div>
                    <div id="ar-decisions" style="display:none;margin-top:16px;"></div>
                </div>
                <div class="modal-footer" style="display:flex;gap:8px;align-items:center;">
                    <span id="ar-firma" class="text-secondary" style="margin-right:auto;font-size:var(--fs-sm);"></span>
                    <button type="button" class="btn btn-ghost ar-export">Exportar acta (CSV)</button>
                    <button type="button" class="btn btn-ghost ar-open-round" style="display:none;">Abrir ronda siguiente</button>
                    <button type="button" class="btn btn-primary ar-sign">Firmar acta</button>
                    <button type="button" class="btn btn-ghost ar-close">Cerrar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        const errorEl = overlay.querySelector('#ar-error');
        const headEl = overlay.querySelector('#ar-head');
        const loadingEl = overlay.querySelector('#ar-loading');
        const tableEl = overlay.querySelector('#ar-table');
        const decisionsEl = overlay.querySelector('#ar-decisions');
        const firmaEl = overlay.querySelector('#ar-firma');
        const signBtn = overlay.querySelector('.ar-sign');
        const openRoundBtn = overlay.querySelector('.ar-open-round');

        const showError = (message) => {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        };
        const clearError = () => { errorEl.style.display = 'none'; };

        const evidenciaDe = (entry) => {
            if (entry.huerfano) {
                return `<span class="badge badge-error" title="Sin acto que respalde el permiso">Huérfano: falta ${escapeHtml((entry.falta || []).join(', '))}</span>`;
            }
            const e = entry.evidencia || {};
            return `<span class="badge badge-success">Con evidencia</span>
                <div style="font-size:0.75rem;color:var(--color-text-secondary);">
                    ${escapeHtml(e.dueño || '')} · ${escapeHtml((e.fecha || '').slice(0, 10))}<br />
                    ${escapeHtml(e.motivo || '')}
                </div>`;
        };

        let inventario = null;

        const load = async () => {
            loadingEl.style.display = 'block';
            tableEl.style.display = 'none';
            decisionsEl.style.display = 'none';
            try {
                inventario = await api.getAccessReview();
            } catch (err) {
                loadingEl.style.display = 'none';
                showError(err?.message || 'No se pudo leer el inventario de permisos.');
                return;
            }
            loadingEl.style.display = 'none';
            if (!inventario) {
                showError('El inventario de permisos llegó vacío.');
                return;
            }

            const r = inventario.resumen || {};
            headEl.innerHTML = `Ronda <code>${escapeHtml(inventario.reviewId)}</code> · acta ${escapeHtml(inventario.estadoActa)} ·
                ${r.activas || 0} identidades activas · ${r.permisosVigentes || 0} permisos vigentes ·
                <strong>${r.huerfanos || 0} huérfanos</strong> ·
                <span title="Un tercero recalcula este digest sobre el inventario y lo compara">digest <code>${escapeHtml(String(inventario.digest || '').slice(0, 16))}…</code></span>`;

            tableEl.innerHTML = `
                <table class="table">
                    <thead>
                        <tr><th>Identidad</th><th>Rol</th><th>Permisos vigentes</th><th>Acto de otorgamiento</th><th style="text-align:center">Decisión</th></tr>
                    </thead>
                    <tbody>
                        ${(inventario.entries || []).map((entry) => `
                            <tr data-ar-user="${escapeHtml(entry.userId)}" ${entry.activa ? '' : 'style="opacity:0.55"'}>
                                <td>
                                    <div><strong>${escapeHtml(`${entry.name || ''}`.trim() || entry.userId)}</strong></div>
                                    <code style="font-size:0.75rem;">${escapeHtml(entry.userId)}</code>
                                </td>
                                <td>${roleBadge(entry.role)}${entry.activa ? '' : ' <span class="badge badge-neutral">Deshabilitado</span>'}</td>
                                <td title="${escapeHtml((entry.permisos || []).join(' · '))}">${(entry.permisos || []).length} permisos</td>
                                <td>${evidenciaDe(entry)}</td>
                                <td style="text-align:center;white-space:nowrap">
                                    ${inventario.estadoActa === 'firmada' ? '<span class="text-secondary" style="font-size:0.75rem;">acta firmada</span>' : `
                                        <button class="btn btn-secondary btn-sm ar-decide" data-decision="sostener">Sostener</button>
                                        <button class="btn btn-secondary btn-sm ar-decide" data-decision="reducir">Reducir</button>
                                        <button class="btn btn-danger btn-sm ar-decide" data-decision="retirar">Retirar</button>
                                    `}
                                </td>
                            </tr>
                            <tr class="ar-reason-row" data-ar-reason="${escapeHtml(entry.userId)}" style="display:none;">
                                <td colspan="5" style="background:var(--color-surface-alt,transparent);">
                                    <div style="display:flex;gap:8px;align-items:flex-start;">
                                        <input class="form-input ar-reason" data-ar-input="${escapeHtml(entry.userId)}" placeholder="Motivo de la decisión (obligatorio)" style="flex:1;" />
                                        <button class="btn btn-primary btn-sm ar-apply" data-ar-apply="${escapeHtml(entry.userId)}">Aplicar</button>
                                        <button class="btn btn-ghost btn-sm ar-cancel" data-ar-cancel="${escapeHtml(entry.userId)}">Cancelar</button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
            tableEl.style.display = 'block';

            const decisiones = inventario.decisiones || [];
            if (decisiones.length > 0) {
                decisionsEl.style.display = 'block';
                decisionsEl.innerHTML = `
                    <h4 class="h4" style="margin:0 0 8px;">Decisiones asentadas (${decisiones.length})</h4>
                    <table class="table">
                        <thead><tr><th>Identidad</th><th>Decisión</th><th>Motivo</th><th>Responsable</th><th>Efecto aplicado</th></tr></thead>
                        <tbody>
                            ${decisiones.map((d) => `
                                <tr>
                                    <td><code>${escapeHtml(d.userId)}</code></td>
                                    <td>${escapeHtml(d.decision)}</td>
                                    <td>${escapeHtml(d.reason || '')}</td>
                                    <td>${escapeHtml(d.decidedBy || '')}<div style="font-size:0.75rem;color:var(--color-text-secondary)">${escapeHtml((d.decidedAt || '').slice(0, 19).replace('T', ' '))}</div></td>
                                    <td><code>${escapeHtml(d.efecto?.rolAntes || '')} → ${escapeHtml(d.efecto?.rolDespues || '')}</code>
                                        <div style="font-size:0.75rem;color:var(--color-text-secondary)"><code>${escapeHtml(d.efecto?.estadoAntes || '')} → ${escapeHtml(d.efecto?.estadoDespues || '')}</code></div></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            }

            if (inventario.estadoActa === 'firmada' && inventario.firma) {
                firmaEl.textContent = `Acta firmada por ${inventario.firma.signedBy || '—'} el ${(inventario.firma.signedAt || '').slice(0, 19).replace('T', ' ')}`;
                signBtn.style.display = 'none';
                openRoundBtn.style.display = 'inline-block';
            } else {
                firmaEl.textContent = 'El acta se puede firmar cuando lo aplicado coincida con lo comprobado.';
                signBtn.style.display = 'inline-block';
                openRoundBtn.style.display = 'none';
            }

            tableEl.querySelectorAll('.ar-decide').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const userId = btn.closest('tr').getAttribute('data-ar-user');
                    const row = tableEl.querySelector(`.ar-reason-row[data-ar-reason="${CSS.escape(userId)}"]`);
                    row.dataset.decision = btn.dataset.decision;
                    row.style.display = 'table-row';
                    row.querySelector('.ar-reason').focus();
                });
            });

            tableEl.querySelectorAll('.ar-cancel').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const row = btn.closest('.ar-reason-row');
                    row.style.display = 'none';
                    row.querySelector('.ar-reason').value = '';
                });
            });

            tableEl.querySelectorAll('.ar-apply').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const userId = btn.dataset.arApply;
                    const row = tableEl.querySelector(`.ar-reason-row[data-ar-reason="${CSS.escape(userId)}"]`);
                    const decision = row.dataset.decision;
                    const motivo = String(row.querySelector('.ar-reason').value || '').trim();
                    clearError();
                    if (!motivo) {
                        showError('Toda decisión sobre un permiso requiere motivo: sin motivo el permiso vuelve a quedar huérfano.');
                        return;
                    }
                    btn.disabled = true;
                    btn.textContent = 'Aplicando…';
                    try {
                        const result = await api.decideAccessReview(userId, decision, motivo);
                        const a = result?.aplicado || {};
                        toast('success', 'Decisión aplicada',
                            `${userId}: ${decision} — quedó ${a.role} / ${a.status}. Responsable: ${result?.decision?.decidedBy || '—'}.`);
                        await load();
                        await refresh();
                    } catch (err) {
                        showError(err?.message || 'No se pudo aplicar la decisión.');
                        btn.disabled = false;
                        btn.textContent = 'Aplicar';
                    }
                });
            });
        };

        overlay.querySelectorAll('.ar-close').forEach((b) => b.addEventListener('click', close));
        overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });

        overlay.querySelector('.ar-export')?.addEventListener('click', async () => {
            clearError();
            try {
                const csv = await api.getAccessReviewCsv();
                const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = `acta-revision-permisos-${(inventario?.reviewId || 'ronda')}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                toast('success', 'Acta exportada', 'El CSV lleva el inventario, la evidencia, los huérfanos, el digest y las decisiones.');
            } catch (err) {
                showError(err?.message || 'No se pudo exportar el acta.');
            }
        });

        overlay.querySelector('.ar-open-round')?.addEventListener('click', async () => {
            clearError();
            try {
                const r = await api.openAccessReview();
                toast('success', 'Ronda abierta', `Nueva ronda ${r?.reviewId} (anterior ${r?.previousReviewId}).`);
                await load();
            } catch (err) {
                showError(err?.message || 'No se pudo abrir la ronda siguiente.');
            }
        });

        signBtn?.addEventListener('click', async () => {
            clearError();
            if (!inventario) return;
            const confirmed = await showConfirmDialog({
                title: 'Firmar el acta de revisión',
                message: `Se va a firmar el acta de la ronda ${inventario.reviewId} con ${inventario.resumen?.huerfanos || 0} faltas heredadas y ${(inventario.decisiones || []).length} decisiones. El acta queda cerrada hasta abrir la ronda siguiente.`,
                confirmText: 'Firmar',
                cancelText: 'Cancelar',
            });
            if (!confirmed) return;
            signBtn.disabled = true;
            signBtn.textContent = 'Firmando…';
            try {
                const result = await api.signAccessReview(inventario.digest, `Revisión de permisos ${inventario.reviewId}`);
                toast('success', 'Acta firmada',
                    `${result?.firma?.signedBy || '—'} · ${result?.decisiones || 0} decisiones · ${(result?.faltasHeredadas || []).length} faltas heredadas.`);
                await load();
            } catch (err) {
                showError(err?.message || 'No se pudo firmar el acta.');
                signBtn.disabled = false;
                signBtn.textContent = 'Firmar acta';
            }
        });

        await load();
    }

    document.getElementById('btn-access-review')?.addEventListener('click', () => {
        openAccessReviewModal();
    });

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
