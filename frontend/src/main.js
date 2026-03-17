/* ============================================================
   main.js — Client-side hash router + app shell
   ============================================================ */
import './diagnostic.js';
import { auth } from './services/auth.js';
import { themeManager } from './services/theme.js';
import { renderSidebar } from './components/Sidebar.js';
import { renderPrivacyModal } from './components/PrivacyModal.js';

// Init theme
themeManager.init();

/* ── Page registry ───────────────────────────────────────── */
const ROUTES = {
    '/student/dashboard': () => import('./pages/student/Dashboard.js').then(m => m.renderStudentDashboard),
    '/student/chat': () => import('./pages/student/Chat.js').then(m => m.renderStudentChat),
    '/student/tasks': () => import('./pages/student/Tasks.js').then(m => m.renderStudentTasks),
    '/student/calendar': () => import('./pages/student/Calendar.js').then(m => m.renderStudentCalendar),
    '/teacher/dashboard': () => import('./pages/teacher/Dashboard.js').then(m => m.renderTeacherDashboard),
    '/teacher/classes': () => import('./pages/teacher/ClassManager.js').then(m => m.renderClassManager),
    '/teacher/upload': () => import('./pages/teacher/UploadMaterials.js').then(m => m.renderTeacherUpload),
    '/teacher/analytics': () => import('./pages/teacher/Analytics.js').then(m => m.renderTeacherAnalytics),
    '/director/dashboard': () => import('./pages/director/Dashboard.js').then(m => m.renderDirectorDashboard),
};

/* ── App shell ───────────────────────────────────────────── */
function buildShell() {
    const appEl = document.getElementById('app');
    if (document.querySelector('.app-shell')) return;

    appEl.innerHTML = `
    <div class="app-shell">
      <div class="main-content" id="main-content">
        <header id="app-header"></header>
        <main class="page-content" id="page-content"></main>
      </div>
    </div>
  `;
}

/* ── Router ──────────────────────────────────────────────── */
export const router = {
    navigate(path) { window.location.hash = `#${path}`; },
};

async function handleRoute() {
    const hash = window.location.hash || '';
    const path = hash.replace(/^#/, '').split('?')[0] || '/student/dashboard';

    buildShell();
    renderSidebar();

    // Highlight active nav item
    document.querySelectorAll('.sidebar-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('href') === `#${path}`);
    });

    const pageContent = document.getElementById('page-content');
    if (!pageContent) return;

    pageContent.innerHTML = `
    <div style="display:flex;justify-content:center;align-items:center;height:200px;color:var(--color-text-secondary)">
      <div class="animate-pulse">Cargando...</div>
    </div>
  `;

    const routeLoader = ROUTES[path];
    if (routeLoader) {
        try {
            const renderFn = await routeLoader();
            await renderFn(pageContent);
        } catch (err) {
            console.error('[Router] Page render error:', err);
            pageContent.innerHTML = `<div class="card" style="max-width:480px;margin:var(--space-10) auto;text-align:center"><div class="empty-state-icon" aria-hidden="true">⚠️</div><h2 class="h3">Error al cargar la página</h2><p style="color:var(--color-text-secondary)">${err.message}</p><button class="btn btn-secondary" onclick="window.location.reload()" aria-label="Reintentar cargar la página">Reintentar</button></div>`;
        }
    } else {
        // Default redirect based on role
        const role = auth.getRole();
        window.location.hash = `#/${role}/dashboard`;
    }
}

/* ── Boot ────────────────────────────────────────────────── */
window.addEventListener('hashchange', handleRoute);
window.addEventListener('auth:roleChanged', () => handleRoute());

async function bootstrap() {
    await auth.initAuth();
    
    // Check for privacy consent
    if (!auth.getConsentAccepted()) {
        renderPrivacyModal();
    }
    
    // Default hash on first load
    if (!window.location.hash) {
        window.location.hash = `#/${auth.getRole()}/dashboard`;
    } else {
        handleRoute();
    }
}

bootstrap();
