/* ============================================================
   BottomNav — Mobile navigation bar
   ============================================================ */
import { auth } from '../services/auth.js';

export function renderBottomNav() {
  if (document.getElementById('mobile-bottom-nav')) {
    return;
  }

  const user = auth.getUser();
  const currentHash = window.location.hash || `#/${user.role}/dashboard`;

  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.innerHTML = `
    <a href="#/student/dashboard" class="bottom-nav-item ${currentHash.includes('dashboard') ? 'active' : ''}">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
      <span>Inicio</span>
    </a>
    <a href="#/student/chat" class="bottom-nav-item ${currentHash.includes('chat') ? 'active' : ''}">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
      <span>Chat RAG</span>
    </a>
    <a href="#/student/tasks" class="bottom-nav-item ${currentHash.includes('tasks') ? 'active' : ''}">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
      <span>Tareas</span>
    </a>
    <a href="#/student/reports" class="bottom-nav-item ${currentHash.includes('reports') ? 'active' : ''}">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
      <span>Reportes</span>
    </a>
    <a href="#/student/calendar" class="bottom-nav-item ${currentHash.includes('calendar') ? 'active' : ''}">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
      <span>Calendario</span>
    </a>
  `;

  document.querySelector('.main-content')?.appendChild(nav);
}
