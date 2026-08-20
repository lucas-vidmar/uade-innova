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
    '/teacher/students': () => import('./pages/teacher/Students.js').then(m => m.renderTeacherStudents),
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
    '/director/compliance': () => import('./pages/director/Compliance.js').then(m => m.renderDirectorCompliance),
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
    if (document.querySelector('.app-shell')) {
        // Upgrade legacy login-era shells (pre-fix) that lack ids so handleRoute's
        // page-content lookup succeeds and the login card is properly replaced.
        let main = document.getElementById('main-content');
        if (!main) {
            main = document.querySelector('.app-shell .main-content');
            if (main) main.id = 'main-content';
        }
        let pc = document.getElementById('page-content');
        if (!pc) {
            pc = document.querySelector('.app-shell .page-content');
            if (pc) pc.id = 'page-content';
            else if (main) main.innerHTML = '<main class="page-content" id="page-content"></main>';
            else {
                const shell = document.querySelector('.app-shell');
                if (shell) shell.innerHTML = '<div class="main-content" id="main-content"><main class="page-content" id="page-content"></main></div>';
            }
        }
        return;
    }

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

    // Public routes handled before the role guard.
    if (fullPath === '/login') {
        // Only a genuinely authenticated session bounces to its role dashboard
        // (e.g. the AAD round-trip returning to a URL whose hash is #/login).
        // A logged-out (`edu_logged_in === 'false'`) or sessionless user asked
        // for login explicitly — keep the sign-in card instead of auto-bouncing.
        const sessionLoggedIn = sessionStorage.getItem('edu_logged_in');
        if (sessionLoggedIn === 'true' && auth.isAuthenticated() && auth.getRole() && !auth.isAccessDenied()) {
            window.location.hash = `#/${auth.getRole()}/dashboard`;
            return;
        }
        buildShell();
        renderLogin();
        return;
    }
    if (fullPath === '/access-denied') {
        buildShell();
        renderAccessDenied();
        return;
    }

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

    let pageContent = document.getElementById('page-content') || document.querySelector('.page-content');
    if (!pageContent) {
        // Recovery: rebuild shell then re-query (covers legacy shells without ids)
        buildShell();
        pageContent = document.getElementById('page-content') || document.querySelector('.page-content');
        if (!pageContent) return;
    }

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

/* ── Sign-in page (public) ─────────────────────────────────── */
function renderLogin() {
    const appEl = document.getElementById('app');
    appEl.innerHTML = `
    <div class="app-shell">
      <div class="main-content" id="main-content">
        <main class="page-content" id="page-content">
          <div class="card" style="max-width:420px;margin:var(--space-10) auto;text-align:center">
            <div class="empty-state-icon" aria-hidden="true">🔐</div>
            <h2 class="h3">Iniciá sesión</h2>
            <p style="color:var(--color-text-secondary);margin:var(--space-3) 0">Usá tu email institucional y contraseña para ingresar al panel.</p>
            <form id="login-form" novalidate style="text-align:left;margin-top:var(--space-4)">
              <div class="form-group">
                <label class="form-label" for="login-email">Email institucional</label>
                <input id="login-email" class="form-input" type="email" placeholder="nombre@uade.edu.ar" autocomplete="username" required />
              </div>
              <div class="form-group" style="margin-top:var(--space-3)">
                <label class="form-label" for="login-password">Contraseña</label>
                <input id="login-password" class="form-input" type="password" placeholder="••••••••" autocomplete="current-password" required />
              </div>
              <p id="login-error" class="text-secondary" style="color:var(--color-error);font-size:0.85rem;margin:var(--space-3) 0;display:none"></p>
              <button type="submit" id="login-submit" class="btn btn-primary" style="width:100%;margin-top:var(--space-2)">Ingresar</button>
            </form>
            <p style="color:var(--color-text-secondary);font-size:0.8rem;margin-top:var(--space-4)">¿No recordás tu contraseña? Contactá a administración para resetearla.</p>
          </div>
        </main>
      </div>
    </div>
  `;

    const errorEl = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit');
    const showError = (message) => {
        if (!errorEl) return;
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    };

    const finishLogin = async (email, password) => {
        try {
            const user = await auth.login(email, password);
            if (auth.isAccessDenied()) {
                window.location.hash = '#/access-denied';
                renderAccessDenied();
                return;
            }
            // Authenticated application-state marker (Story 10.20).
            document.documentElement.dataset.appState = 'authenticated';
            try {
                sessionStorage.setItem('edu_app_state', 'authenticated');
            } catch (_) {}
            processingNotifications.init();
            inactivityMonitor.init();
            window.location.hash = `#/${user.role || auth.getRole()}/dashboard`;
        } catch (err) {
            if (err?.code === 'ACCESS_DENIED' || err?.status === 403) {
                sessionStorage.setItem('edu_access_denied', 'true');
                window.location.hash = '#/access-denied';
                renderAccessDenied();
                return;
            }
            showError(err?.message || 'No se pudo iniciar sesión. Verificá tus credenciales.');
        }
    };

    document.getElementById('login-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = String(document.getElementById('login-email')?.value || '').trim();
        const password = document.getElementById('login-password')?.value || '';
        if (!email || !password) {
            showError('Ingresá tu email y contraseña.');
            return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Ingresando...';
        try {
            await finishLogin(email, password);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Ingresar';
        }
    });
}

/* ── Access denied (authenticated but unlisted / 403 semantics) ── */
function renderAccessDenied() {
    const appEl = document.getElementById('app');
    appEl.innerHTML = `
    <div class="app-shell">
      <div class="main-content" id="main-content">
        <main class="page-content" id="page-content">
          <div class="card" style="max-width:480px;margin:var(--space-10) auto;text-align:center">
            <div class="empty-state-icon" aria-hidden="true">🔒</div>
            <h2 class="h3">Acceso denegado</h2>
            <p style="color:var(--color-text-secondary);margin:var(--space-3) 0">Tu cuenta no está habilitada para acceder a esta plataforma. Si creés que esto es un error, contactá a administración.</p>
            <div style="display:flex;gap:var(--space-3);justify-content:center;margin-top:var(--space-4)">
              <button class="btn btn-primary" onclick="window.location.reload()" aria-label="Reintentar acceso">Reintentar</button>
              <button class="btn btn-secondary" id="access-denied-logout" aria-label="Cerrar sesión">Cerrar sesión</button>
            </div>
          </div>
        </main>
      </div>
    </div>
  `;
    document.getElementById('access-denied-logout')?.addEventListener('click', () => {
        auth.performLogout();
    });
}

/* ── Boot ────────────────────────────────────────────────── */
window.addEventListener('hashchange', handleRoute);
window.addEventListener('auth:roleChanged', () => handleRoute());

async function bootstrap() {
    const authenticated = await auth.initAuth();

    if (auth.isAccessDenied()) {
        window.location.hash = '#/access-denied';
        renderAccessDenied();
        return;
    }

    if (!authenticated) {
        // Production renders the email/password login form here; dev-mock boot
        // always authenticates before reaching this branch.
        window.location.hash = '#/login';
        renderLogin();
        return;
    }

    // ── Authenticated application-state marker (Story 10.20) ────────────────
    // Positive proof that initAuth() resolved an authenticated session. Only
    // written on this branch (after the access-denied and login returns above),
    // so a dead-end/error release cannot produce it. It only signals "booted
    // authenticated" — it never exposes role, email or scope (allowlist-only
    // role model, AGENTS.md §10/§13).
    document.documentElement.dataset.appState = 'authenticated';
    try {
        sessionStorage.setItem('edu_app_state', 'authenticated');
    } catch (_) {}

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

        // Explicit #/login: defer to handleRoute(), which renders the sign-in
        // card for logged-out/sessionless users and bounces only genuinely
        // authenticated sessions to their role dashboard. Never let the role
        // check below auto-redirect a logged-out user away from login.
        if (hashPath === '/login') {
            handleRoute();
            return;
        }

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
