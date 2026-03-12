/* ============================================================
   Sidebar — Role-aware collapsible navigation
   ============================================================ */
import { auth } from '../services/auth.js';
import { router } from '../main.js';

const NAV = {
  student: [
    { id: 'student-dashboard', icon: '🏠', label: 'Inicio', path: '#/student/dashboard' },
    { id: 'student-chat', icon: '💬', label: 'Chat RAG', path: '#/student/chat' },
    { id: 'student-tasks', icon: '📋', label: 'Tareas & Notas', path: '#/student/tasks' },
    { id: 'student-calendar', icon: '📅', label: 'Calendario', path: '#/student/calendar' },
  ],
  teacher: [
    { id: 'teacher-dashboard', icon: '🏠', label: 'Mis Cátedras', path: '#/teacher/dashboard' },
    { id: 'teacher-classes', icon: '🗂️', label: 'Gestor de Clases', path: '#/teacher/classes' },
    { id: 'teacher-upload', icon: '📤', label: 'Cargar Materiales', path: '#/teacher/upload' },
    { id: 'teacher-analytics', icon: '📊', label: 'Analítica', path: '#/teacher/analytics' },
  ],
  director: [
    { id: 'director-dashboard', icon: '📈', label: 'Panel Directivo', path: '#/director/dashboard' },
  ],
};

export function renderSidebar() {
  const user = auth.getUser();
  const items = NAV[user.role] || NAV.student;
  const currentHash = window.location.hash || `#/${user.role}/dashboard`;

  const appEl = document.getElementById('app');
  const existingSidebar = document.getElementById('sidebar');
  if (existingSidebar) existingSidebar.remove();

  const sidebar = document.createElement('aside');
  sidebar.id = 'sidebar';
  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <div class="sidebar-logo-icon" aria-hidden="true">🎓</div>
      <span class="sidebar-logo-text">UADE Innova</span>
      <button class="sidebar-toggle" id="sidebar-toggle-btn" title="Colapsar" aria-label="Contraer barra lateral" aria-expanded="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
    </div>

    <nav class="sidebar-nav">
      ${items.map(item => `
        <a href="${item.path}" class="sidebar-item ${currentHash === item.path ? 'active' : ''}" id="nav-${item.id}">
          <span class="sidebar-item-icon" aria-hidden="true">${item.icon}</span>
          <span class="sidebar-item-label">${item.label}</span>
        </a>
      `).join('')}
    </nav>

    <div class="sidebar-footer">
      <div class="sidebar-section-label">Cambiar rol</div>
      <div class="role-switcher">
        <button class="role-btn ${user.role === 'student' ? 'active' : ''}" data-role="student" aria-label="Cambiar a vista Alumno">👨‍🎓</button>
        <button class="role-btn ${user.role === 'teacher' ? 'active' : ''}" data-role="teacher" aria-label="Cambiar a vista Docente">👨‍🏫</button>
        <button class="role-btn ${user.role === 'director' ? 'active' : ''}" data-role="director" aria-label="Cambiar a vista Director">👔</button>
      </div>
      <div class="sidebar-user">
        <div class="avatar" style="width:32px;height:32px;font-size:12px">${user.avatar}</div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">${user.name.split(' ')[0]}</div>
          <div class="sidebar-user-role">${{ student: 'Alumno', teacher: 'Docente', director: 'Director' }[user.role]}</div>
        </div>
      </div>
    </div>
  `;

  // Prepend to #app shell (before main-content)
  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    mainContent.before(sidebar);
  } else {
    appEl.prepend(sidebar);
  }

  // Role switcher
  sidebar.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const role = btn.dataset.role;
      auth.setRole(role);
      const defaultPath = { student: '#/student/dashboard', teacher: '#/teacher/dashboard', director: '#/director/dashboard' }[role];
      window.location.hash = defaultPath;
    });
  });

  // Toggle collapse
  let mini = sessionStorage.getItem('sidebar_mini') === 'true';
  if (mini) toggleMini(sidebar, true);

  document.getElementById('sidebar-toggle-btn').addEventListener('click', () => {
    mini = !mini;
    sessionStorage.setItem('sidebar_mini', mini);
    toggleMini(sidebar, mini);
  });
}

function toggleMini(sidebar, mini) {
  const mainContent = document.querySelector('.main-content');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  if (mini) {
    sidebar.classList.add('mini');
    mainContent?.classList.add('sidebar-mini');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
  } else {
    sidebar.classList.remove('mini');
    mainContent?.classList.remove('sidebar-mini');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
  }
}
