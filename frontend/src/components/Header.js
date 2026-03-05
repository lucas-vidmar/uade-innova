/* ============================================================
   Header — Top bar with page title and user info
   ============================================================ */
import { auth } from '../services/auth.js';

export function renderHeader(title = 'Dashboard') {
    let header = document.getElementById('app-header');
    if (!header) {
        header = document.createElement('header');
        header.id = 'app-header';
        document.querySelector('.main-content')?.prepend(header);
    }
    const user = auth.getUser();
    header.innerHTML = `
    <div class="header-left">
      <button class="btn btn-icon btn-ghost" id="mobile-menu-btn" title="Menú" style="display:none">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div class="header-title">${title}</div>
    </div>
    <div class="header-right">
      <div class="header-badge">${{ student: '👨‍🎓 Alumno', teacher: '👨‍🏫 Docente', director: '👔 Director' }[user.role]}</div>
      <button class="btn btn-icon btn-ghost" title="Notificaciones">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      </button>
      <div class="avatar">${user.avatar}</div>
    </div>
  `;
}
