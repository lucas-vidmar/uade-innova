/* ============================================================
   main.js — Client-side hash router + app shell
   ============================================================ */
import './diagnostic.js';
import { auth } from './services/auth.js';
import { themeManager } from './services/theme.js';
import { renderSidebar } from './components/Sidebar.js';
import { inactivityMonitor } from './services/inactivity.js';
import { processingNotifications } from './services/processing-notifications.js';


// Init theme
themeManager.init();

/* ── Page registry ───────────────────────────────────────── */
const ROUTES = {
    '/student/dashboard': () => import('./pages/student/Dashboard.js').then(m => m.renderStudentDashboard),
    '/student/class': () => import('./pages/student/ClassDetail.js').then(m => m.renderClassDetail),
    '/student/notifications': () => import('./pages/student/Notifications.js').then(m => m.renderStudentNotifications),
    '/student/tasks': () => import('./pages/student/Tasks.js').then(m => m.renderStudentTasks),
    '/student/calendar': () => import('./pages/student/Calendar.js').then(m => m.renderStudentCalendar),
    '/student/settings': () => import('./pages/student/Settings.js').then(m => m.renderStudentSettings),
    '/student/reports': () => import('./pages/student/Reports.js').then(m => m.renderStudentReports),
    '/student/search': () => import('./pages/student/SearchResults.js').then(m => m.renderStudentSearchResults),
    '/student/chat': () => import('./pages/student/Dashboard.js').then(m => m.renderStudentDashboard),
    '/teacher/dashboard': () => import('./pages/teacher/Dashboard.js').then(m => m.renderTeacherDashboard),
    '/teacher/classes': () => import('./pages/teacher/ClassManager.js').then(m => m.renderClassManager),
    '/teacher/upload': () => import('./pages/teacher/UploadMaterials.js').then(m => m.renderTeacherUpload),
    '/teacher/analytics': () => import('./pages/teacher/Analytics.js').then(m => m.renderTeacherAnalytics),
    '/teacher/rag-sandbox': () => import('./pages/teacher/RagSandbox.js').then(m => m.renderTeacherRagSandbox),
    '/teacher/materials': () => import('./pages/teacher/MaterialManager.js').then(m => m.renderMaterialManager),
    '/teacher/corrections': () => import('./pages/teacher/CorrectionInbox.js').then(m => m.renderCorrectionInbox),
    '/teacher/correction': () => import('./pages/teacher/CorrectionDetail.js').then(m => m.renderCorrectionDetail),
    '/teacher/glossary': () => import('./pages/teacher/GlossaryManager.js').then(m => m.renderGlossaryManager),
    '/teacher/transcription-corrections': () => import('./pages/teacher/TranscriptionCorrections.js').then(m => m.renderTranscriptionCorrections),
    '/teacher/transcription-correction': () => import('./pages/teacher/TranscriptionCorrectionDetail.js').then(m => m.renderTranscriptionCorrectionDetail),
    '/teacher/class': () => import('./pages/teacher/ClassEditor.js').then(m => m.renderClassEditor),
    '/director/dashboard': () => import('./pages/director/Dashboard.js').then(m => m.renderDirectorDashboard),
    '/director/sat-analytics': () => import('./pages/director/SatAnalytics.js').then(m => m.renderDirectorSatAnalytics),
    '/director/classes': () => import('./pages/director/ClassManagement.js').then(m => m.renderClassManagement),
    '/director/subjects': () => import('./pages/director/SubjectManagement.js').then(m => m.renderSubjectManagement),
    '/director/interventions': () => import('./pages/director/Interventions.js').then(m => m.renderDirectorInterventions),
    '/admin/dashboard': () => import('./pages/admin/Dashboard.js').then(m => m.renderAdminDashboard),
    '/admin/users': () => import('./pages/admin/UserManagement.js').then(m => m.renderUserManagement),
    '/admin/settings': () => import('./pages/admin/Settings.js').then(m => m.renderAdminSettings),
    '/admin/model-config': () => import('./pages/admin/ModelConfig.js').then(m => m.renderAdminModelConfig),
    '/admin/retention': () => import('./pages/admin/Retention.js').then(m => m.renderAdminRetention),
    '/admin/prompts': () => import('./pages/director/PromptManager.js').then(m => m.renderDirectorPromptManager),
    '/admin/compliance': () => import('./pages/director/Compliance.js').then(m => m.renderDirectorCompliance),
    '/admin/archive-usage': () => import('./pages/director/ArchiveUsage.js').then(m => m.renderDirectorArchiveUsage),
};

/* ── App shell ───────────────────────────────────────────── */
function buildShell() {
    const appEl = document.getElementById('app');
    if (document.querySelector('.app-shell')) return;

    appEl.innerHTML = `
    <div class="app-shell">
      <div class="main-content" id="main-content">
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
    const fullPath = hash.replace(/^#/, '').split('?')[0] || '/student/dashboard';
    
    // Simple dynamic route matching: /student/class/class-01 -> /student/class
    let matchedPath = fullPath;
    if (fullPath.startsWith('/student/class/')) {
        matchedPath = '/student/class';
    }
    if (fullPath.startsWith('/teacher/correction/')) {
        matchedPath = '/teacher/correction';
    }
    if (fullPath.startsWith('/teacher/transcription-correction/')) {
        matchedPath = '/teacher/transcription-correction';
    }
    if (fullPath.startsWith('/teacher/class/')) {
        matchedPath = '/teacher/class';
    }

    buildShell();
    renderSidebar();

    // Route Guard: Role-based access control
    const expectedRole = matchedPath.split('/')[1]; // "student", "teacher", "director", "admin"
    const actualRole = auth.getRole();

    const rolePrefixMap = {
        student: ['student'],
        teacher: ['teacher'],
        director: ['director'],
        admin: ['admin'],
    };

    const allowedPrefixes = rolePrefixMap[actualRole] || ['student'];
    if (!allowedPrefixes.includes(expectedRole)) {
        console.warn(`[Router] Access Denied: ${actualRole} cannot access ${matchedPath}`);
        window.location.hash = `#/${actualRole}/dashboard`;
        return;
    }

    // Highlight active nav item
    document.querySelectorAll('.sidebar-item').forEach(el => {
        const href = el.getAttribute('href')?.replace(/^#/, '');
        el.classList.toggle('active', href === matchedPath || (matchedPath === '/student/class' && href === '/student/dashboard'));
    });

    const pageContent = document.getElementById('page-content');
    if (!pageContent) return;

    pageContent.innerHTML = `
    <div style="display:flex;justify-content:center;align-items:center;height:200px;color:var(--color-text-secondary)">
      <div class="animate-pulse">Cargando...</div>
    </div>
  `;

    const routeLoader = ROUTES[matchedPath];
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

/* ── Auth blocked (production, no mock fallback) ──────────── */
function renderAuthBlocked() {
    const appEl = document.getElementById('app');
    appEl.innerHTML = `
    <div class="app-shell">
      <div class="main-content">
        <main class="page-content">
          <div class="card" style="max-width:480px;margin:var(--space-10) auto;text-align:center">
            <div class="empty-state-icon" aria-hidden="true">🔒</div>
            <h2 class="h3">No se pudo verificar tu identidad.</h2>
            <p style="color:var(--color-text-secondary);margin:var(--space-3) 0">Recargá la página.</p>
            <button class="btn btn-primary" onclick="window.location.reload()" aria-label="Recargar página">Recargar</button>
          </div>
        </main>
      </div>
    </div>
  `;
}

/* ── Boot ────────────────────────────────────────────────── */
window.addEventListener('hashchange', handleRoute);
window.addEventListener('auth:roleChanged', () => handleRoute());

async function bootstrap() {
    const authenticated = await auth.initAuth();

    if (!authenticated) {
        renderAuthBlocked();
        return;
    }

    processingNotifications.init();
    inactivityMonitor.init();
    
    // Default hash on first load — or redirect if hash doesn't match role
    if (!window.location.hash) {
        window.location.hash = `#/${auth.getRole()}/dashboard`;
    } else {
        // Verify the current hash path matches the authenticated role
        const hashPath = window.location.hash.replace(/^#/, '').split('?')[0];
        const hashRole = hashPath.split('/')[1];
        const actualRole = auth.getRole();

        const rolePrefixMap = {
            student: ['student'],
            teacher: ['teacher'],
            director: ['director'],
            admin: ['admin'],
        };
        const allowedPrefixes = rolePrefixMap[actualRole] || ['student'];

        if (!allowedPrefixes.includes(hashRole)) {
            window.location.hash = `#/${actualRole}/dashboard`;
        } else {
            handleRoute();
        }
    }
}

bootstrap();
