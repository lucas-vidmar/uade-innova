/* ============================================================
   Sidebar — Role-aware collapsible navigation
   ============================================================ */
import { auth } from '../services/auth.js';

const NAV = {
  student: [
    { id: 'student-dashboard', icon: 'home', label: 'Inicio', path: '#/student/dashboard' },
    { id: 'student-chat', icon: 'message', label: 'Chat RAG', path: '#/student/chat' },
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
  ],
};

export function renderSidebar() {
  const user = auth.getUser();
  const items = NAV[user.role] || NAV.student;
  const currentHash = window.location.hash || `#/${user.role}/dashboard`;

  const appEl = document.getElementById('app');
  const existingNav = document.getElementById('top-nav');
  if (existingNav) existingNav.remove();

  const topNav = document.createElement('header');
  topNav.id = 'top-nav';
  topNav.innerHTML = `
    <div class="top-nav-inner">
      <a href="#/${user.role}/dashboard" class="top-nav-brand" aria-label="Ir al inicio">
        <span class="top-nav-brand-mark" aria-hidden="true">U</span>
        <span class="top-nav-brand-text">UADE Innova</span>
      </a>

      <button class="top-nav-menu-btn" id="mobile-menu-btn" title="Menu" aria-label="Abrir menu" aria-expanded="false">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>

      <nav class="top-nav-links" aria-label="Navegacion principal">
        ${items.map(item => `
          <a href="${item.path}" class="sidebar-item ${currentHash === item.path ? 'active' : ''}" id="nav-${item.id}-desktop">
            <span class="top-nav-icon" aria-hidden="true">${getIcon(item.icon)}</span>
            <span>${item.label}</span>
          </a>
        `).join('')}
      </nav>
    </div>

    <nav class="top-nav-mobile" id="top-nav-mobile" aria-label="Menu movil">
      ${items.map(item => `
        <a href="${item.path}" class="sidebar-item ${currentHash === item.path ? 'active' : ''}" id="nav-${item.id}-mobile">
          <span class="top-nav-icon" aria-hidden="true">${getIcon(item.icon)}</span>
          <span>${item.label}</span>
        </a>
      `).join('')}
    </nav>
  `;

  let overlay = document.querySelector('.top-nav-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'top-nav-overlay';
    document.body.appendChild(overlay);
  }

  appEl.prepend(topNav);

  overlay.onclick = () => {
    document.body.classList.remove('top-nav-mobile-open');
    const trigger = document.getElementById('mobile-menu-btn');
    trigger?.setAttribute('aria-expanded', 'false');
  };

  topNav.querySelectorAll('.top-nav-mobile .sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        document.body.classList.remove('top-nav-mobile-open');
        const trigger = document.getElementById('mobile-menu-btn');
        trigger?.setAttribute('aria-expanded', 'false');
      }
    });
  });

  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    const isOpen = document.body.classList.toggle('top-nav-mobile-open');
    const trigger = document.getElementById('mobile-menu-btn');
    trigger?.setAttribute('aria-expanded', String(isOpen));
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
  };

  return icons[icon] || icons.home;
}
