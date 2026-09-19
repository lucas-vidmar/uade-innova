/* ============================================================
   Header — Top bar with page title and user info
   ============================================================ */
import { auth } from '../services/auth.js';
import { themeManager } from '../services/theme.js';

export function renderHeader(containerOrTitle, titleOrStats = 'Dashboard', showMetrics = true) {
  let container = containerOrTitle;
  let title = titleOrStats;
  let stats = null;
  let actualShowMetrics = showMetrics;

  // Handle backwards compatibility: renderHeader('Title') or renderHeader('Title', stats) or renderHeader('Title', showMetrics)
  if (typeof containerOrTitle === 'string') {
    container = document.getElementById('app-header');
    title = containerOrTitle;
    
    if (typeof titleOrStats === 'object' && titleOrStats !== null) {
      stats = titleOrStats;
    } else if (typeof titleOrStats === 'boolean') {
      actualShowMetrics = titleOrStats;
    }
  }

  if (!container) return;
  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  const subjects = auth.getEnrolledSubjects();
  // Fix #346: same active-subject fallback as the sidebar — prefer the session
  // subject list when the enrollment cache is empty.
  const displayPool = subjects.length > 0 ? subjects : (user.subjects || []);
  const currentSubject = displayPool.find(s => s.id === activeSubjectId) || subjects[0] || displayPool[0] || { name: 'Materia' };

  container.innerHTML = `
    <div class="header-container flex justify-between items-center w-full px-6 py-4 bg-surface-2 border-b border-border">
      <div>
        <h1 class="h3 mb-0">${title}</h1>
        <p class="text-xs text-text-muted">Bienvenido, ${user.name}</p>
      </div>

      ${showMetrics ? `
      <div class="metrics-container hidden lg:flex items-center gap-6">
        <div class="metric-card bg-surface border border-border p-3 rounded-md flex flex-col items-center min-w-[100px]">
          <span class="text-lg font-bold text-primary">8.5</span>
          <span class="text-[10px] uppercase font-bold text-text-muted">Promedio</span>
        </div>
        <div class="metric-card bg-surface border border-border p-3 rounded-md flex flex-col items-center min-w-[100px]">
          <span class="text-lg font-bold text-success">92%</span>
          <span class="text-[10px] uppercase font-bold text-text-muted">Asistencia</span>
        </div>
      </div>
      ` : ''}

      <div class="flex items-center gap-4">
        <div class="custom-dropdown" id="header-subject-dropdown">
          <button class="custom-dropdown-trigger" id="dropdown-trigger">
            <span>${currentSubject.name}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="custom-dropdown-menu">
            ${displayPool.map(s => `
              <div class="custom-dropdown-option ${s.id === activeSubjectId ? 'selected' : ''}" data-value="${s.id}">
                ${s.name}
              </div>
            `).join('') || '<div class="custom-dropdown-option" aria-disabled="true">Sin materias disponibles</div>'}
          </div>
        </div>
      </div>
    </div>
  `;

  // Clean up previous theme listener if it exists
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

  const dropdown = document.getElementById('header-subject-dropdown');
  const trigger = document.getElementById('dropdown-trigger');
  
  if (dropdown && trigger) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('active');
    });

    dropdown.querySelectorAll('.custom-dropdown-option').forEach(option => {
      option.addEventListener('click', () => {
        const val = option.getAttribute('data-value');
        auth.setActiveSubjectId(val);
        window.location.reload();
      });
    });

    // Close on click outside
    const closeDropdown = (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('active');
      }
    };
    
    document.addEventListener('click', closeDropdown);
    
    // Cleanup if title changes (though renderHeader usually re-renders everything)
    dropdown._cleanup = () => document.removeEventListener('click', closeDropdown);
  }
}
