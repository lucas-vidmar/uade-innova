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
  const isLoggedIn = auth.isLoggedIn();
  const activeSubjectId = auth.getActiveSubjectId();
  const isDirector = user.role === 'director';
  const theme = themeManager.getTheme();
  const roleLabel = { student: 'Alumno', teacher: 'Docente', director: 'Director' }[user.role] || 'Alumno';
  const career = user.role === 'director' ? 'Direccion Academica' : 'Ingenieria en Informatica';
  const legajo = user.id || '000000';

  header.innerHTML = `
    <div class="header-left">
      <h1 class="header-title" id="page-main-title">${title}</h1>
      ${!isDirector && user.subjects && user.subjects.length > 0 ? `
        <div class="header-subject-wrap">
          <select id="header-subject-select" class="form-select form-select-sm header-subject-select">
            ${user.subjects.map(s => `<option value="${s.id}" ${s.id === activeSubjectId ? 'selected' : ''}>${s.name}</option>`).join('')}
          </select>
        </div>
      ` : ''}
    </div>

    <div class="header-right">
      <button class="btn btn-icon btn-ghost" id="theme-toggle" title="Cambiar tema" aria-label="Cambiar tema">
        ${theme === 'dark'
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
    }
      </button>

      <button class="profile-trigger" id="profile-trigger" aria-label="Abrir perfil" aria-expanded="false">
        <span class="avatar">${user.avatar}</span>
      </button>

      <div class="profile-panel" id="profile-panel" hidden>
        ${isLoggedIn ? `
          <div class="profile-panel-section">
            <div class="profile-panel-name">${user.name}</div>
            <div class="profile-panel-role">${roleLabel}</div>
          </div>
          <div class="profile-panel-section profile-data-grid">
            <div><span class="profile-label">Nombre</span><span class="profile-value">${user.name}</span></div>
            <div><span class="profile-label">Carrera</span><span class="profile-value">${career}</span></div>
            <div><span class="profile-label">Legajo</span><span class="profile-value">${legajo}</span></div>
            <div><span class="profile-label">Email</span><span class="profile-value">usuario@uade.edu.ar</span></div>
          </div>
          <div class="profile-panel-section">
            <button class="btn btn-secondary profile-logout-btn" id="profile-logout">Cerrar sesion</button>
          </div>
        ` : `
          <div class="profile-panel-section">
            <div class="profile-panel-name">Sesion cerrada</div>
            <div class="profile-panel-role">Elegi un perfil para continuar</div>
          </div>
          <div class="profile-panel-section profile-role-switcher" id="profile-role-switcher">
            <button class="role-btn" data-role="student">Alumno</button>
            <button class="role-btn" data-role="teacher">Docente</button>
            <button class="role-btn" data-role="director">Director</button>
          </div>
        `}
      </div>
    </div>
  `;

  document.getElementById('theme-toggle')?.addEventListener('click', () => themeManager.toggle());

  if (renderHeader._themeListener) {
    window.removeEventListener('themeChanged', renderHeader._themeListener);
  }
  renderHeader._themeListener = (e) => {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const isDark = e.detail.theme === 'dark';
    btn.innerHTML = isDark
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  };
  window.addEventListener('themeChanged', renderHeader._themeListener);

  document.getElementById('header-subject-select')?.addEventListener('change', e => {
    auth.setActiveSubjectId(e.target.value);
    window.location.reload();
  });

  const profileTrigger = document.getElementById('profile-trigger');
  const profilePanel = document.getElementById('profile-panel');
  const closePanel = () => {
    if (!profilePanel || !profileTrigger) return;
    profilePanel.hidden = true;
    profileTrigger.setAttribute('aria-expanded', 'false');
  };

  profileTrigger?.addEventListener('click', (event) => {
    event.stopPropagation();
    const nextState = profilePanel.hidden;
    profilePanel.hidden = !nextState;
    profileTrigger.setAttribute('aria-expanded', String(nextState));
  });

  profilePanel?.addEventListener('click', (event) => event.stopPropagation());

  if (renderHeader._outsideClickListener) {
    document.removeEventListener('click', renderHeader._outsideClickListener);
  }
  renderHeader._outsideClickListener = () => closePanel();
  document.addEventListener('click', renderHeader._outsideClickListener);

  if (renderHeader._escapeListener) {
    document.removeEventListener('keydown', renderHeader._escapeListener);
  }
  renderHeader._escapeListener = (event) => {
    if (event.key === 'Escape') closePanel();
  };
  document.addEventListener('keydown', renderHeader._escapeListener);

  document.getElementById('profile-logout')?.addEventListener('click', () => {
    auth.mockLogout();
    closePanel();
    renderHeader(title);
  });

  document.querySelectorAll('#profile-role-switcher .role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const role = btn.dataset.role;
      auth.mockLoginAs(role);
      closePanel();
      window.location.hash = `#/${role}/dashboard`;
    });
  });
}
