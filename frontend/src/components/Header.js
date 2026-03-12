/* ============================================================
   Header — Top bar with page title and user info
   ============================================================ */
import { auth } from '../services/auth.js';
import { themeManager } from '../services/theme.js';

export function renderHeader(title = 'Dashboard') {
  let header = document.getElementById('app-header');
  if (!header) {
    header = document.createElement('header');
    header.id = 'app-header';
    document.querySelector('.main-content')?.prepend(header);
  }
  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  const isDirector = user.role === 'director';
  const theme = themeManager.getTheme();

  header.innerHTML = `
    <div class="header-left" style="display:flex; align-items:center; gap:var(--space-4)">
      <button class="btn btn-icon btn-ghost" id="mobile-menu-btn" title="Menú" style="display:none">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <h1 class="header-title" id="page-main-title">${title}</h1>
      ${!isDirector && user.subjects && user.subjects.length > 0 ? `
        <div style="margin-left:var(--space-4); border-left:1px solid var(--color-border); padding-left:var(--space-4);">
            <select id="header-subject-select" class="form-select form-select-sm" style="background:var(--color-bg-secondary); border-color:var(--color-border); max-width:250px;">
              ${user.subjects.map(s => `<option value="${s.id}" ${s.id === activeSubjectId ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
        </div>
      ` : ''}
    </div>
    <div class="header-right">
      <button class="btn btn-icon btn-ghost" id="theme-toggle" title="Cambiar tema">
        ${theme === 'dark'
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
    }
      </button>
      <div class="header-badge">${{ student: '👨‍🎓 Alumno', teacher: '👨‍🏫 Docente', director: '👔 Director' }[user.role]}</div>
      <button class="btn btn-icon btn-ghost" title="Notificaciones" aria-label="Notificaciones">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      </button>
      <div class="avatar">${user.avatar}</div>
    </div>
  `;

  // Listeners
  document.getElementById('theme-toggle')?.addEventListener('click', () => themeManager.toggle());

  window.addEventListener('themeChanged', (e) => {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const isDark = e.detail.theme === 'dark';
    btn.innerHTML = isDark
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  });

  document.getElementById('header-subject-select')?.addEventListener('change', e => {
    auth.setActiveSubjectId(e.target.value);
    window.location.reload();
  });
}
