/* ============================================================
   UserManagement.js — Admin View for managing users
   ============================================================ */
import { api } from '../../services/api.js';
import { USERS } from '../../services/auth.js';
import { toast } from '../../components/Toast.js';

// Static fallback allowlist — authorized pilot university accounts. Shown when
// the remote `/api/manage/users` list is empty or the fetch fails.
const FALLBACK_SCOPE = 'Arquitectura de Software (2026-1)';

const ROLE_BADGE = {
    student: 'badge-info',
    teacher: 'badge-primary',
    director: 'badge-warning',
    admin: 'badge-error',
};

function roleBadge(role) {
    const label = String(role || 'student').toLowerCase();
    const cls = ROLE_BADGE[label] || 'badge-neutral';
    return `<span class="badge ${cls}">${label}</span>`;
}

function fallbackUsers() {
    return Object.values(USERS);
}

function renderFallbackUsers(tableContainer) {
    tableContainer.innerHTML = `
        <p class="text-secondary" style="margin-bottom: var(--space-3); font-size: 0.85rem;">
            La API remota no devolvió usuarios. Mostrando la allowlist estática de
            cuentas autorizadas del piloto.
        </p>
        <table class="table">
            <thead>
                <tr>
                    <th>Usuario</th>
                    <th>Email</th>
                    <th>Rol</th>
                    <th>Materia / Alcance</th>
                </tr>
            </thead>
            <tbody>
                ${fallbackUsers().map(user => `
                    <tr>
                        <td>
                            <div style="display: flex; align-items: center; gap: var(--space-2);">
                                <div class="avatar-sm" style="background: var(--color-primary); color: white; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: bold; border-radius: 4px; width: 24px; height: 24px;">
                                    ${user.avatar || user.name.substring(0, 2).toUpperCase()}
                                </div>
                                <strong>${user.name}</strong>
                            </div>
                        </td>
                        <td>${user.email}</td>
                        <td>${roleBadge(user.role)}</td>
                        <td><span class="badge badge-neutral">${FALLBACK_SCOPE}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

export async function renderUserManagement(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="h2">Administración de Usuarios</h1>
            <p class="text-secondary">Visualización y auditoría de perfiles registrados en la institución.</p>
        </div>

        <div class="card animate-in" id="anomalous-usage-alert-card">
            <h3 style="margin-bottom: var(--space-2);">🚨 Alerta de uso anómalo de tokens</h3>
            <p class="text-secondary" style="margin-bottom: var(--space-2);">
                Operaciones recibe un email automático desde Azure Monitor cuando un usuario supera
                <strong>1.000.000 tokens en 24 horas</strong>.
            </p>
            <p class="text-secondary" style="font-size: 0.85rem; margin: 0;">
                Regla: <code>customEvents | where name == "RAGInteraction" | summarize sum(totalTokens) by userId</code>
            </p>
        </div>

        <div class="card animate-in">
            <div id="users-table-container">
                <div class="loading-state">
                    <div class="animate-pulse">Cargando usuarios...</div>
                </div>
            </div>
        </div>
    `;

    try {
        const users = await api.getAdminUsers();
        const tableContainer = document.getElementById('users-table-container');

        if (users.length === 0) {
            renderFallbackUsers(tableContainer);
            return;
        }

        tableContainer.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>ID de Usuario</th>
                        <th>Preferencia Tema</th>
                        <th>Idioma</th>
                        <th>Consentimiento</th>
                        <th>Última Actividad</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(user => `
                        <tr>
                            <td>
                                <div style="display: flex; align-items: center; gap: var(--space-2);">
                                    <div class="avatar-sm" style="background: var(--color-primary); color: white; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: bold; border-radius: 4px; width: 24px; height: 24px;">
                                        ${user.id.substring(0, 2).toUpperCase()}
                                    </div>
                                    <code>${user.id}</code>
                                </div>
                            </td>
                            <td><span class="badge ${user.theme === 'dark' ? 'badge-dark' : 'badge-light'}">${user.theme || 'light'}</span></td>
                            <td>${user.language || 'es'}</td>
                            <td>
                                ${user.consentAccepted 
                                    ? '<span style="color: var(--color-success); display: flex; align-items: center; gap: 4px;">✅ Aceptado</span>' 
                                    : '<span style="color: var(--color-warning); display: flex; align-items: center; gap: 4px;">⏳ Pendiente</span>'}
                            </td>
                            <td class="text-secondary" style="font-size: 0.85rem;">
                                ${user.lastActive ? new Date(user.lastActive).toLocaleString() : 'N/A'}
                            </td>
                            <td>
                                <button class="btn btn-secondary btn-sm btn-user-details">Detalles</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        tableContainer.querySelectorAll('.btn-user-details').forEach((btn) => {
            btn.addEventListener('click', () => {
                toast('info', 'Proximamente', 'La edicion detallada de usuarios llega en Fase 2.');
            });
        });

    } catch (err) {
        console.error('Error rendering User Management:', err);
        const tableContainer = document.getElementById('users-table-container');
        if (tableContainer) {
            renderFallbackUsers(tableContainer);
        }
    }
}
