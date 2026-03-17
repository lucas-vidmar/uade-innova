/* ============================================================
   UserManagement.js — Admin View for managing users
   ============================================================ */
import { api } from '../../services/api.js';

export async function renderUserManagement(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="h2">Administración de Usuarios</h1>
            <p class="text-secondary">Visualización y auditoría de perfiles registrados en la institución.</p>
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
            tableContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">👥</div>
                    <p>No hay usuarios registrados todavía.</p>
                </div>
            `;
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
                                <button class="btn btn-secondary btn-sm" onclick="alert('Funcionalidad de edición reservada para Fase 2')">Detalles</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

    } catch (err) {
        console.error('Error rendering User Management:', err);
        document.getElementById('users-table-container').innerHTML = `
            <div class="alert alert-error">
                <p>Error al cargar la lista de usuarios: ${err.message}</p>
            </div>
        `;
    }
}
