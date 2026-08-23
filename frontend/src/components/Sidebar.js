/* ============================================================
   Sidebar — Role-aware navigation shell (Desktop + Mobile)
   ============================================================ */
import { auth, isDevMockEnabled } from '../services/auth.js';
import { api } from '../services/api.js';
import { toast } from './Toast.js';
import { OnboardingEngine, resetOnboarding } from '../services/onboarding.js';
import { TEACHER_ONBOARDING_STEPS } from '../pages/teacher/OnboardingSteps.js';
import { STUDENT_ONBOARDING_STEPS } from '../pages/student/OnboardingSteps.js';
import { createNotificationStream } from '../services/notification-stream.js';

const NAV = {
  student: [
    { id: 'student-dashboard', icon: 'home', label: 'Inicio', path: '#/student/dashboard' },
    { id: 'student-notifications', icon: 'bell', label: 'Notificaciones', path: '#/student/notifications' },
    { id: 'student-tasks', icon: 'tasks', label: 'Tareas y Notas', path: '#/student/tasks' },
    { id: 'student-reports', icon: 'alert', label: 'Mis Reportes', path: '#/student/reports' },
    { id: 'student-calendar', icon: 'calendar', label: 'Calendario', path: '#/student/calendar' },
    { id: 'student-settings', icon: 'settings', label: 'Configuración', path: '#/student/settings' },
  ],
  teacher: [
    { id: 'teacher-dashboard', icon: 'home', label: 'Mis Catedras', path: '#/teacher/dashboard' },
    { id: 'teacher-classes', icon: 'stack', label: 'Gestor de Clases', path: '#/teacher/classes' },
    { id: 'teacher-students', icon: 'users', label: 'Estudiantes', path: '#/teacher/students' },
    { id: 'teacher-upload', icon: 'upload', label: 'Cargar Materiales', path: '#/teacher/upload' },
    { id: 'teacher-materials', icon: 'files', label: 'Gestión de Materiales', path: '#/teacher/materials' },
    { id: 'teacher-corrections', icon: 'alert', label: 'Bandeja de Correcciones', path: '#/teacher/corrections' },
    { id: 'teacher-transcription-corrections', icon: 'edit', label: 'Correcciones Transcripción', path: '#/teacher/transcription-corrections' },
    { id: 'teacher-glossary', icon: 'book', label: 'Glosario', path: '#/teacher/glossary' },
    { id: 'teacher-rag-sandbox', icon: 'flask', label: 'RAG Sandbox', path: '#/teacher/rag-sandbox' },
    { id: 'teacher-analytics', icon: 'chart', label: 'Analitica', path: '#/teacher/analytics' },
  ],
  director: [
    { id: 'director-dashboard', icon: 'chart', label: 'Panel Directivo', path: '#/director/dashboard' },
    { id: 'director-sat-analytics', icon: 'chart', label: 'SAT por Prompt', path: '#/director/sat-analytics' },
    { id: 'director-interventions', icon: 'alert', label: 'Intervenciones', path: '#/director/interventions' },
    { id: 'director-classes', icon: 'stack', label: 'Gestión de Clases', path: '#/director/classes' },
    { id: 'director-subjects', icon: 'settings', label: 'Gestión de Materias', path: '#/director/subjects' },
    { id: 'director-students', icon: 'users', label: 'Alumnos', path: '#/director/students' },
  ],
  admin: [
    { id: 'admin-dashboard', icon: 'chart', label: 'Panel Técnico', path: '#/admin/dashboard' },
    { id: 'admin-users', icon: 'users', label: 'Usuarios', path: '#/admin/users' },
    { id: 'admin-settings', icon: 'settings', label: 'Configuración Técnica', path: '#/admin/settings' },
    { id: 'admin-model', icon: 'cpu', label: 'Modelo de IA', path: '#/admin/model-config' },
    { id: 'admin-retention', icon: 'shield', label: 'Retención', path: '#/admin/retention' },
    { id: 'admin-prompts', icon: 'edit', label: 'Gestión de Prompts', path: '#/admin/prompts' },
    { id: 'admin-compliance', icon: 'shield', label: 'Cumplimiento', path: '#/admin/compliance' },
    { id: 'admin-archive-usage', icon: 'database', label: 'Archivo en Frío', path: '#/admin/archive-usage' },
  ],
};

export function renderSidebar() {
  if (typeof renderSidebar._notificationCleanup === 'function') {
    renderSidebar._notificationCleanup();
    renderSidebar._notificationCleanup = null;
  }

  const user = auth.getUser();
  const items = NAV[user.role] || NAV.student;
  const currentHash = window.location.hash || `#/${user.role}/dashboard`;
  const currentPath = currentHash.replace(/^#/, '').split('?')[0] || `/${user.role}/dashboard`;
  const normalizedPath = currentPath.startsWith('/student/class/') ? '/student/class' : currentPath;

  const activeSubjectId = auth.getActiveSubjectId();
  const subjects = auth.getEnrolledSubjects();
  const activeSubject = subjects.find(s => s.id === activeSubjectId) || subjects[0] || { name: 'Sin materias asignadas', id: null };
  const displaySubjectName = subjects.length === 0
    ? 'Sin materias asignadas'
    : (activeSubject.name.includes('(2026-1)')
        ? activeSubject.name
        : `${activeSubject.name} (2026-1)`);

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
          if (item.separator) {
            return '<div class="left-nav-divider" style="margin:var(--space-2) 0"></div>';
          }
          const itemPath = item.path.replace(/^#/, '');
          const isActive = itemPath === normalizedPath || (normalizedPath === '/student/class' && itemPath === '/student/dashboard');
          return `
            <a href="${item.path}" class="left-nav-link ${isActive ? 'active' : ''}" id="nav-${item.id}-desktop">
              ${getIcon(item.icon)}
              <span class="left-nav-label">${item.label}</span>
            </a>
          `;
        }).join('')}

        ${user.role === 'teacher' || user.role === 'student' ? `
          <div class="left-nav-divider"></div>
          <button class="left-nav-link left-nav-link--help" id="nav-${user.role}-onboarding-desktop" type="button">
            ${getIcon('help')}
            <span class="left-nav-label">Guía de inicio</span>
          </button>
        ` : ''}
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

        ${user.role === 'student' ? `
          <div class="notification-center" id="notification-center">
            <button class="notification-bell-btn" id="notification-bell-btn" aria-label="Abrir centro de notificaciones" aria-expanded="false" aria-controls="notification-dropdown">
              ${getIcon('bell')}
              <span class="notification-badge" id="notification-badge" hidden>0</span>
            </button>
            <div class="notification-dropdown" id="notification-dropdown" hidden>
              <div class="notification-dropdown-head">
                <h3>Notificaciones</h3>
                <button class="notification-mark-read" id="notification-mark-read">Marcar todas leídas</button>
              </div>
              <div class="notification-dropdown-filters" id="notification-dropdown-filters"></div>
              <div class="notification-list" id="notification-list">
                <div class="notification-empty">Cargando notificaciones...</div>
              </div>
              <div class="notification-dropdown-foot">
                <a href="#/student/notifications" class="notification-view-all">Ver todo</a>
                ${import.meta.env.VITE_MOCK_AUTH_ENABLED === 'true' ? `<button class="notification-simulate" id="notification-simulate">Simular notificación</button>` : ''}
              </div>
            </div>
          </div>
        ` : ''}

        <div class="flex items-center gap-2 cursor-pointer p-1.5 rounded-lg hover:bg-surface-2 active:bg-surface-2 transition-all relative border border-transparent hover:border-border" id="profile-trigger-nav">
          <div class="profile-initials-badge">
            ${user.avatar || user.name.substring(0, 2).toUpperCase()}
          </div>

          <div class="profile-panel shadow-xl border border-border bg-surface rounded-xl overflow-hidden" id="profile-panel-nav" hidden>
            <div class="profile-panel-section">
              <div class="profile-panel-name">${user.name}</div>
              <div class="profile-panel-role">${user.role === 'student' ? 'Alumno' : user.role === 'teacher' ? 'Docente' : user.role === 'director' ? 'Director' : 'Admin Técnico'}</div>
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

            ${isDevMockEnabled() ? `
            <div class="profile-panel-section">
              <div class="profile-label mb-2">Cambiar Rol (Demo)</div>
              <div class="profile-role-switcher" id="profile-role-switcher-nav">
                <button class="role-btn ${user.role === 'student' ? 'active' : ''}" data-role="student">Alumno</button>
                <button class="role-btn ${user.role === 'teacher' ? 'active' : ''}" data-role="teacher">Docente</button>
                <button class="role-btn ${user.role === 'director' ? 'active' : ''}" data-role="director">Director</button>
                <button class="role-btn ${user.role === 'admin' ? 'active' : ''}" data-role="admin">Admin Técnico</button>
              </div>
              ${user.role === 'student' ? `
                <div class="profile-label mt-2 mb-1" style="font-size:0.75rem;">Seleccionar Alumno</div>
                <div class="profile-student-picker" id="profile-student-picker-nav">
                  ${auth.getMockStudents().map(s => `
                    <button class="role-btn ${s.id === user.id ? 'active' : ''}" data-student-key="${s._key}">
                      ${s.name}
                    </button>
                  `).join('')}
                </div>
              ` : ''}
            </div>
            ` : ''}

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
      ${items.filter(item => !item.separator).map(item => {
        const itemPath = item.path.replace(/^#/, '');
        const isActive = itemPath === normalizedPath || (normalizedPath === '/student/class' && itemPath === '/student/dashboard');
        return `
          <a href="${item.path}" class="mobile-bottom-link ${isActive ? 'active' : ''}" id="nav-${item.id}-mobile" aria-label="${escapeHtml(item.label)}">
            ${getIcon(item.icon)}
            <span>${item.label}</span>
          </a>
        `;
      }).join('')}

      ${user.role === 'teacher' || user.role === 'student' ? `
        <button class="mobile-bottom-link mobile-bottom-link--help" id="nav-${user.role}-onboarding-mobile" type="button" aria-label="Guía de inicio">
          ${getIcon('help')}
          <span>Guía de inicio</span>
        </button>
      ` : ''}
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
    auth.performLogout();
  });

  if (isDevMockEnabled()) {
    document.querySelectorAll('#profile-role-switcher-nav .role-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const role = btn.dataset.role;
        auth.mockLoginAs(role);
        window.location.hash = `#/${role}/dashboard`;
        window.location.reload();
      });
    });

    document.querySelectorAll('#profile-student-picker-nav .role-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const studentKey = btn.dataset.studentKey;
        auth.mockLoginAs(studentKey);
        window.location.hash = '#/student/dashboard';
        window.location.reload();
      });
    });
  }

  /* ── Onboarding re-trigger (Guía de inicio) ──────────── */
  const role = user.role;
  const steps = role === 'student' ? STUDENT_ONBOARDING_STEPS : TEACHER_ONBOARDING_STEPS;
  const onboardingBtns = [
    document.getElementById(`nav-${role}-onboarding-desktop`),
    document.getElementById(`nav-${role}-onboarding-mobile`),
  ].filter(Boolean);

  onboardingBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      resetOnboarding(role);
      const engine = new OnboardingEngine({ role, steps });
      engine.start();
    });
  });

  if (user.role === 'student') {
    initializeNotificationCenter({ userId: user.id, subjectId: activeSubjectId });
  }
}

const DROPDOWN_FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'grade', label: 'Nota' },
  { id: 'summary', label: 'Resumen' },
  { id: 'material', label: 'Material' },
];
const DROPDOWN_PAGE_SIZE = 8;

async function initializeNotificationCenter({ userId, subjectId }) {
  const center = document.getElementById('notification-center');
  const bellButton = document.getElementById('notification-bell-btn');
  const badge = document.getElementById('notification-badge');
  const dropdown = document.getElementById('notification-dropdown');
  const listEl = document.getElementById('notification-list');
  const markReadBtn = document.getElementById('notification-mark-read');
  const simulateBtn = document.getElementById('notification-simulate');

  if (!center || !bellButton || !badge || !dropdown || !listEl) return;

  let allNotifications = [];
  let activeFilter = 'all';
  let hasMore = true;
  // Set when the notification backend reports a hard auth/config failure (403):
  // the dropdown renders an actionable message instead of a silent empty state.
  let streamError = null;

  const getFiltered = () => {
    if (activeFilter === 'all') return allNotifications;
    return allNotifications.filter((n) => n.type === activeFilter);
  };

  const render = () => {
    const unreadCount = allNotifications.filter((item) => item.unread).length;
    badge.textContent = String(unreadCount);
    badge.hidden = unreadCount === 0;

    const dropFiltersEl = document.getElementById('notification-dropdown-filters');
    if (dropFiltersEl) {
      dropFiltersEl.innerHTML = DROPDOWN_FILTERS.map((f) => `
        <button class="notif-dropdown-pill ${activeFilter === f.id ? 'active' : ''}" data-filter="${f.id}">${f.label}</button>
      `).join('');
    }

    const filtered = getFiltered();

    if (streamError) {
      listEl.innerHTML = `
        <div class="notification-empty" role="alert">
          <div style="margin-bottom:6px;font-weight:600">No se pudieron cargar las notificaciones</div>
          <div style="color:var(--color-text-secondary);font-size:var(--font-size-xs)">
            ${escapeHtml(streamError.message || 'Tu sesión no tiene acceso al canal de notificaciones.')}
          </div>
          <button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="window.location.reload()">Reintentar</button>
        </div>`;
      return;
    }

    if (allNotifications.length === 0) {
      listEl.innerHTML = '<div class="notification-empty">No hay notificaciones nuevas.</div>';
      return;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="notification-empty">No hay notificaciones de este tipo.</div>';
      return;
    }

    listEl.innerHTML = filtered
      .map((item) => {
        const icon = item.type === 'grade'
          ? '📝'
          : item.type === 'summary'
            ? '📘'
            : item.type === 'deadline'
              ? '⏰'
              : '📂';
        const typeLabel = item.type === 'grade'
          ? 'Nota'
          : item.type === 'summary'
            ? 'Resumen'
            : item.type === 'deadline'
              ? 'Deadline'
              : 'Material';
        return `
          <button class="notification-item ${item.unread ? 'unread' : ''}" data-notification-id="${item.id}" data-target-hash="${item.targetHash || '#/student/dashboard'}">
            <div class="notification-item-top">
              <span class="notification-type">${icon} ${typeLabel}</span>
              <span class="notification-time">${formatNotificationDate(item.createdAt)}</span>
            </div>
            <div class="notification-title">${escapeHtml(item.title)}</div>
            <div class="notification-message">${escapeHtml(item.message)}</div>
            ${item.unread ? `
              <div class="notification-actions">
                <span class="notification-quick-label">Acciones rápidas</span>
                <span class="notification-action-btn" role="button" tabindex="0" data-notification-action="mark-read">Marcar leída</span>
              </div>
            ` : ''}
          </button>
        `;
      })
      .join('') + (hasMore ? `
        <button class="notification-load-more" id="notif-dropdown-load-more">Cargar más</button>
      ` : '');
  };

  const setOpen = (open) => {
    dropdown.hidden = !open;
    bellButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const onBellClick = (e) => {
    e.stopPropagation();
    setOpen(dropdown.hidden);
  };

  const onOutsideClick = (e) => {
    if (!center.contains(e.target)) {
      setOpen(false);
    }
  };

  const onMarkAllRead = (e) => {
    e.stopPropagation();
    const unreadIds = allNotifications.filter((item) => item.unread).map((item) => item.id);
    if (unreadIds.length === 0) {
      toast('success', 'Notificaciones actualizadas', 'No había notificaciones pendientes de lectura.');
      return;
    }

    const before = allNotifications;
    allNotifications = allNotifications.map((item) => ({ ...item, unread: false }));
    render();

    api.markNotificationsRead({ notificationIds: unreadIds, userId, subjectId })
      .then(() => {
        toast('success', 'Notificaciones actualizadas', 'Se marcaron todas como leídas.');
      })
      .catch((err) => {
        allNotifications = before;
        render();
        toast('error', 'No se pudo actualizar', err?.message || 'Intentá nuevamente en unos segundos.');
      });
  };

  const onSimulate = (e) => {
    if (import.meta.env.VITE_MOCK_AUTH_ENABLED !== 'true') return;
    e.stopPropagation();
    allNotifications = [
      {
        id: `notif-sim-${Date.now()}`,
        type: 'material',
        title: 'Nuevo material disponible',
        message: 'Se agregó un nuevo recurso para tu clase activa.',
        createdAt: new Date().toISOString(),
        unread: true,
        targetHash: '#/student/dashboard',
        subjectId,
      },
      ...allNotifications,
    ];
    render();
  };

  const onListClick = async (e) => {
    const loadMoreBtn = e.target.closest('#notif-dropdown-load-more');
    if (loadMoreBtn) {
      e.stopPropagation();
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = 'Cargando...';
      try {
        const newItems = await api.getNotifications({ userId, subjectId, limit: DROPDOWN_PAGE_SIZE, skip: allNotifications.length });
        if (!Array.isArray(newItems) || newItems.length === 0) {
          hasMore = false;
        } else {
          allNotifications = [...allNotifications, ...newItems];
          hasMore = newItems.length >= DROPDOWN_PAGE_SIZE;
        }
      } catch {
        hasMore = false;
      }
      render();
      return;
    }

    const item = e.target.closest('[data-notification-id]');
    if (!item) return;
    const id = item.getAttribute('data-notification-id');
    const markReadAction = e.target.closest('[data-notification-action="mark-read"]');
    const before = allNotifications;
    allNotifications = allNotifications.map((notif) => (notif.id === id ? { ...notif, unread: false } : notif));
    render();

    const clicked = allNotifications.find((notif) => notif.id === id);
    if (clicked?.subjectId && userId) {
      try {
        await api.markNotificationRead({ notificationId: id, userId, subjectId: clicked.subjectId });
        toast('success', 'Notificación leída', 'Tu acción se guardó correctamente.');
      } catch (err) {
        allNotifications = before;
        render();
        toast('error', 'No se pudo actualizar', err?.message || 'Intentá nuevamente en unos segundos.');
        if (markReadAction) return;
      }
    }

    if (markReadAction) {
      toast('success', 'Notificación leída', 'La notificación fue marcada como leída.');
      return;
    }

    setOpen(false);

    const targetHash = item.getAttribute('data-target-hash');
    if (targetHash) window.location.hash = targetHash;
  };

  const onFiltersClick = (e) => {
    const pill = e.target.closest('.notif-dropdown-pill');
    if (!pill) return;
    activeFilter = pill.dataset.filter;
    render();
  };

  const onExternalTrigger = (event) => {
    if (import.meta.env.VITE_MOCK_AUTH_ENABLED !== 'true') return;
    const detail = event?.detail || {};
    allNotifications = [
      {
        id: detail.id || `notif-ext-${Date.now()}`,
        type: ['grade', 'summary', 'material', 'deadline'].includes(detail.type) ? detail.type : 'material',
        title: String(detail.title || 'Nueva notificación'),
        message: String(detail.message || 'Se actualizó información académica.'),
        createdAt: detail.createdAt || new Date().toISOString(),
        unread: true,
        targetHash: detail.targetHash || '#/student/dashboard',
      },
      ...allNotifications,
    ];
    render();
  };

  bellButton.addEventListener('click', onBellClick);
  document.addEventListener('click', onOutsideClick);
  listEl.addEventListener('click', onListClick);
  const filtersEl = document.getElementById('notification-dropdown-filters');
  filtersEl?.addEventListener('click', onFiltersClick);
  markReadBtn?.addEventListener('click', onMarkAllRead);
  simulateBtn?.addEventListener('click', onSimulate);
  window.addEventListener('student:trigger-notification', onExternalTrigger);

  let notificationStream = null;

  const onStreamError = (event) => {
    streamError = event?.detail || { message: 'Tu sesión no tiene acceso al canal de notificaciones.' };
    render();
  };
  window.addEventListener('notification-stream:error', onStreamError);

  renderSidebar._notificationCleanup = () => {
    bellButton.removeEventListener('click', onBellClick);
    document.removeEventListener('click', onOutsideClick);
    listEl.removeEventListener('click', onListClick);
    filtersEl?.removeEventListener('click', onFiltersClick);
    markReadBtn?.removeEventListener('click', onMarkAllRead);
    simulateBtn?.removeEventListener('click', onSimulate);
    window.removeEventListener('student:trigger-notification', onExternalTrigger);
    window.removeEventListener('notification-stream:error', onStreamError);
    if (notificationStream) {
      notificationStream.stop();
      notificationStream = null;
    }
  };

  try {
    allNotifications = await api.getNotifications({ userId, subjectId, limit: DROPDOWN_PAGE_SIZE });
    hasMore = Array.isArray(allNotifications) && allNotifications.length >= DROPDOWN_PAGE_SIZE;
  } catch (err) {
    // A hard auth/config failure is actionable, not a silent empty state.
    if (err?.status === 401 || err?.status === 403 || err?.code === 'ACCESS_DENIED' || err?.code === 'FORBIDDEN') {
      streamError = { status: err.status, code: err.code, message: err.message };
    } else {
      console.warn('[Notifications] Failed to load initial notifications:', err);
    }
  }
  render();

  notificationStream = createNotificationStream();
  notificationStream.onSnapshot = (data) => {
    if (Array.isArray(data?.notifications)) {
      const merged = [...data.notifications];
      for (const item of allNotifications) {
        if (!merged.some((m) => m.id === item.id)) {
          merged.push(item);
        }
      }
      allNotifications = merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      render();
    }
  };
  notificationStream.onError = (detail) => {
    streamError = detail;
    render();
  };
  notificationStream.start({ userId, subjectId });
}

function formatNotificationDate(value) {
  if (!value) return 'recién';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recién';

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  if (diffHours < 48) return 'ayer';
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    files: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    bell: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"/><path d="M9 17a3 3 0 0 0 6 0"/></svg>',
    alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
    book: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 19.5Z"/><path d="M8 7h8"/><path d="M8 11h6"/><path d="M8 15h4"/></svg>',
    help: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
    shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
    database: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg>',
    users: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    cpu: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/><path d="M9 1v3"/><path d="M15 1v3"/><path d="M9 20v3"/><path d="M15 20v3"/><path d="M1 9h3"/><path d="M1 15h3"/><path d="M20 9h3"/><path d="M20 15h3"/></svg>',
    flask: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v6L4 18a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3L14 8V2"/><path d="M8 2h8"/><path d="M7 15h10"/></svg>',
  };

  const svg = icons[icon] || icons.home;
  return svg.replace(/^<svg\b/i, '<svg aria-hidden="true"');
}
