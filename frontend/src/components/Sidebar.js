/* ============================================================
   Sidebar — Role-aware navigation shell (Desktop + Mobile)
   ============================================================ */
import { auth } from '../services/auth.js';

const NAV = {
  student: [
    { id: 'student-dashboard', icon: 'home', label: 'Inicio', path: '#/student/dashboard' },
    { id: 'student-tasks', icon: 'tasks', label: 'Tareas y Notas', path: '#/student/tasks' },
    { id: 'student-calendar', icon: 'calendar', label: 'Calendario', path: '#/student/calendar' },
  ],
  teacher: [
    { id: 'teacher-dashboard', icon: 'home', label: 'Mis Catedras', path: '#/teacher/dashboard' },
    { id: 'teacher-classes', icon: 'stack', label: 'Gestor de Clases', path: '#/teacher/classes' },
    { id: 'teacher-upload', icon: 'upload', label: 'Cargar Materiales', path: '#/teacher/upload' },
    { id: 'teacher-analytics', icon: 'chart', label: 'Analitica', path: '#/teacher/analytics' },
  ],
  director: [
    { id: 'director-dashboard', icon: 'chart', label: 'Panel Directivo', path: '#/director/dashboard' },
    { id: 'director-classes', icon: 'stack', label: 'Gestión de Clases', path: '#/director/classes' },
    { id: 'director-subjects', icon: 'settings', label: 'Gestión de Materias', path: '#/director/subjects' },
  ],
};

export function renderSidebar() {
  const user = auth.getUser();
  const items = NAV[user.role] || NAV.student;
  const currentHash = window.location.hash || `#/${user.role}/dashboard`;
  const currentPath = currentHash.replace(/^#/, '').split('?')[0] || `/${user.role}/dashboard`;
  const normalizedPath = currentPath.startsWith('/student/class/') ? '/student/class' : currentPath;

  const activeSubjectId = auth.getActiveSubjectId();
  const subjects = user.subjects || [];
  const activeSubject = subjects.find(s => s.id === activeSubjectId) || subjects[0] || { name: 'Materia' };
  const displaySubjectName = activeSubject.name.includes('(2026-1)')
    ? activeSubject.name
    : `${activeSubject.name} (2026-1)`;

  const appEl = document.getElementById('app');
  const existingNav = document.getElementById('top-nav');
  if (existingNav) existingNav.remove();
  const existingSubjectBar = document.getElementById('subject-context-bar');
  if (existingSubjectBar) existingSubjectBar.remove();

  document.body.classList.remove('has-subject-context');

  const topNav = document.createElement('div');
  topNav.id = 'top-nav';
  topNav.className = 'top-nav-shell';
  topNav.innerHTML = `
    <aside class="left-nav-rail" aria-label="Navegación principal">
      <a href="#/${user.role}/dashboard" class="left-nav-brand" aria-label="Ir al inicio">
        <span class="left-nav-brand-mark">UI</span>
        <span class="left-nav-brand-text">UADE Innova</span>
      </a>

      <nav class="left-nav-links">
        ${items.map(item => {
          const itemPath = item.path.replace(/^#/, '');
          const isActive = itemPath === normalizedPath || (normalizedPath === '/student/class' && itemPath === '/student/dashboard');
          return `
            <a href="${item.path}" class="left-nav-link ${isActive ? 'active' : ''}" id="nav-${item.id}-desktop">
              ${getIcon(item.icon)}
              <span class="left-nav-label">${item.label}</span>
            </a>
          `;
        }).join('')}
      </nav>
    </aside>

    <header class="top-utility-bar">
      <div class="top-utility-center">
        <div class="custom-dropdown subject-context-dropdown" id="global-course-dropdown">
          <button class="custom-dropdown-trigger subject-context-trigger" id="global-course-btn" aria-label="Seleccionar materia activa">
            <span>${displaySubjectName}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="custom-dropdown-menu">
            ${subjects.map(s => `
              <div class="custom-dropdown-option ${s.id === activeSubjectId ? 'selected' : ''}" data-value="${s.id}">
                ${s.name} ${s.name.includes('(2026-1)') ? '' : '(2026-1)'}
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="top-utility-actions">
        <button class="btn btn-ghost p-2 text-text-secondary hover:text-primary transition-colors flex items-center justify-center" id="theme-toggle-nav" aria-label="Cambiar tema">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
        </button>

        <div class="flex items-center gap-2 cursor-pointer p-1.5 rounded-lg hover:bg-surface-2 active:bg-surface-2 transition-all relative border border-transparent hover:border-border" id="profile-trigger-nav">
          <div class="profile-initials-badge">
            ${user.avatar || user.name.substring(0, 2).toUpperCase()}
          </div>

          <div class="profile-panel shadow-xl border border-border bg-surface rounded-xl overflow-hidden" id="profile-panel-nav" hidden>
            <div class="profile-panel-section">
              <div class="profile-panel-name">${user.name}</div>
              <div class="profile-panel-role">${user.role === 'student' ? 'Alumno' : (user.role === 'teacher' ? 'Docente' : 'Director')}</div>
            </div>

            <div class="profile-panel-section">
              <div class="profile-data-grid">
                <div>
                  <span class="profile-label">Legajo</span>
                  <span class="profile-value">${user.id}</span>
                </div>
                <div>
                  <span class="profile-label">Email</span>
                  <span class="profile-value">${user.email}</span>
                </div>
              </div>
            </div>

            <div class="profile-panel-section">
              <div class="profile-label mb-2">Cambiar Rol (Demo)</div>
              <div class="profile-role-switcher" id="profile-role-switcher-nav">
                <button class="role-btn ${user.role === 'student' ? 'active' : ''}" data-role="student">Vista Alumno</button>
                <button class="role-btn ${user.role === 'teacher' ? 'active' : ''}" data-role="teacher">Vista Docente</button>
                <button class="role-btn ${user.role === 'director' ? 'active' : ''}" data-role="director">Vista Director</button>
              </div>
            </div>

            <div class="profile-panel-section">
              <button class="btn btn-outline profile-logout-btn" id="profile-logout-nav">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Cerrar Sesión
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <nav class="mobile-bottom-nav" id="mobile-bottom-nav" aria-label="Menu móvil">
      ${items.map(item => {
        const itemPath = item.path.replace(/^#/, '');
        const isActive = itemPath === normalizedPath || (normalizedPath === '/student/class' && itemPath === '/student/dashboard');
        return `
          <a href="${item.path}" class="mobile-bottom-link ${isActive ? 'active' : ''}" id="nav-${item.id}-mobile">
            ${getIcon(item.icon)}
            <span>${item.label}</span>
          </a>
        `;
      }).join('')}
    </nav>
  `;

  appEl.prepend(topNav);

  document.getElementById('theme-toggle-nav')?.addEventListener('click', () => {
    import('../services/theme.js').then(m => m.themeManager.toggle());
  });

  const courseDropdown = document.getElementById('global-course-dropdown');
  const courseTrigger = document.getElementById('global-course-btn');
  if (courseDropdown && courseTrigger) {
    courseTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      courseDropdown.classList.toggle('active');
    });

    courseDropdown.querySelectorAll('.custom-dropdown-option').forEach(option => {
      option.addEventListener('click', () => {
        const val = option.getAttribute('data-value');
        auth.setActiveSubjectId(val);
        window.location.reload();
      });
    });

    document.addEventListener('click', (e) => {
      if (!courseDropdown.contains(e.target)) {
        courseDropdown.classList.remove('active');
      }
    });
  }

  const profileTrigger = document.getElementById('profile-trigger-nav');
  const profilePanel = document.getElementById('profile-panel-nav');

  profileTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    profilePanel?.toggleAttribute('hidden');
  });

  profilePanel?.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('click', () => {
    profilePanel?.setAttribute('hidden', '');
  });

  document.getElementById('profile-logout-nav')?.addEventListener('click', () => {
    auth.mockLogout();
    window.location.reload();
  });

  document.querySelectorAll('#profile-role-switcher-nav .role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const role = btn.dataset.role;
      auth.mockLoginAs(role);
      window.location.hash = `#/${role}/dashboard`;
      window.location.reload();
    });
  });
}

function getIcon(icon) {
  const icons = {
    home: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/></svg>',
    message: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
    tasks: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11h11"/><path d="M9 16h11"/><path d="M9 6h11"/><path d="M4 6h.01"/><path d="M4 11h.01"/><path d="M4 16h.01"/></svg>',
    calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    stack: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4"/><path d="m4 16 8 4 8-4"/></svg>',
    upload: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5-5 5 5"/><path d="M12 5v12"/></svg>',
    chart: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 14v4"/><path d="M12 10v8"/><path d="M17 6v12"/></svg>',
    settings: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 9.91 3.1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  };

  return icons[icon] || icons.home;
}
