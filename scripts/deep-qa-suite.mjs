import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:5173';
const OUTPUT_DIR = path.resolve('test-report', 'deep-qa');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const testResults = [];
const consoleErrors = [];
const networkFailures = [];

function logResult(persona, category, testName, status, details = '', error = null) {
  const item = {
    persona,
    category,
    testName,
    status, // 'PASS', 'FAIL', 'WARN'
    details,
    error: error ? (error.stack || error.message || String(error)) : null,
    timestamp: new Date().toISOString()
  };
  testResults.push(item);
  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  console.log(`${icon} [${persona.toUpperCase()}][${category}] ${testName} -> ${status}`);
  if (details) console.log(`   ℹ️  ${details}`);
  if (error) console.log(`   🚨 ${error.message || error}`);
}

async function runDeepQA() {
  console.log('================================================================');
  console.log(`Starting Deep QA Audit on ${BASE_URL}`);
  console.log('================================================================\n');

  const browser = await chromium.launch({ headless: true });

  // ─────────────────────────────────────────────────────────────
  // 1. PUBLIC & AUTH FLOWS
  // ─────────────────────────────────────────────────────────────
  {
    console.log('\n--- TESTING PUBLIC & AUTHENTICATION FLOWS ---');
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push({ url: page.url(), text: msg.text() });
      }
    });
    page.on('requestfailed', req => {
      networkFailures.push({ url: req.url(), failure: req.failure()?.errorText });
    });

    try {
      await page.goto(`${BASE_URL}/#/login`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      const loginHeading = await page.locator('h2, .h3').first().textContent().catch(() => '');
      const loginBtn = await page.locator('a[href*="/.auth/login/aad"]').first().isVisible().catch(() => false);
      
      if (loginHeading.includes('Iniciá sesión') && loginBtn) {
        logResult('Public', 'Auth', 'Login page renders sign-in CTA and Microsoft Auth link', 'PASS', `Found: "${loginHeading.trim()}"`);
      } else {
        logResult('Public', 'Auth', 'Login page renders sign-in CTA and Microsoft Auth link', 'FAIL', `Heading: "${loginHeading}", Button visible: ${loginBtn}`);
      }
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'public-login.png') });
    } catch (e) {
      logResult('Public', 'Auth', 'Login page renders sign-in CTA', 'FAIL', '', e);
    }

    try {
      await page.goto(`${BASE_URL}/#/access-denied`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      const deniedHeading = await page.locator('h2, .h3').first().textContent().catch(() => '');
      const retryBtn = await page.locator('button[aria-label="Reintentar acceso"]').isVisible().catch(() => false);
      const logoutBtn = await page.locator('#access-denied-logout').isVisible().catch(() => false);

      if (deniedHeading.includes('Acceso denegado') && retryBtn && logoutBtn) {
        logResult('Public', 'Auth', 'Access Denied page renders explanation, retry, and logout buttons', 'PASS');
      } else {
        logResult('Public', 'Auth', 'Access Denied page renders explanation, retry, and logout buttons', 'WARN', `Heading: "${deniedHeading}", Retry: ${retryBtn}, Logout: ${logoutBtn}`);
      }
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'public-access-denied.png') });
    } catch (e) {
      logResult('Public', 'Auth', 'Access Denied page renders', 'FAIL', '', e);
    }

    await context.close();
  }

  // Helper to create authenticated session for a specific persona
  async function createPersonaContext(role, uid, studentKey = null) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    await context.addInitScript(({ role, uid, studentKey }) => {
      try { localStorage.setItem('edu_ai_consent_accepted', 'true'); } catch(e) {}
      try { localStorage.setItem('edu_consent_accepted', 'true'); } catch(e) {}
      try { localStorage.setItem('uade_use_mock', 'true'); } catch(e) {}
      sessionStorage.setItem('edu_ai_consent_accepted', 'true');
      sessionStorage.setItem('edu_consent_accepted', 'true');
      sessionStorage.setItem('edu_logged_in', 'true');
      sessionStorage.setItem('edu_role', role);
      sessionStorage.setItem('edu_uid', uid);
      if (studentKey) {
        sessionStorage.setItem('edu_student_key', studentKey);
      }
    }, { role, uid, studentKey });

    const page = await context.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push({ role, url: page.url(), text: msg.text() });
      }
    });
    page.on('requestfailed', req => {
      networkFailures.push({ role, url: req.url(), failure: req.failure()?.errorText });
    });
    return { context, page };
  }

  // ─────────────────────────────────────────────────────────────
  // 2. STUDENT PERSONA AUDIT
  // ─────────────────────────────────────────────────────────────
  {
    console.log('\n--- TESTING STUDENT PERSONA (Lucas Vidmar - alu-001) ---');
    const { context, page } = await createPersonaContext('student', 'alu-001', 'student');

    // Route Guard test: student trying to access admin or teacher page
    try {
      await page.goto(`${BASE_URL}/#/admin/users`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      const url = page.url();
      if (url.includes('/student/dashboard')) {
        logResult('Student', 'Security', 'Route Guard redirects unauthorized access from #/admin/users to #/student/dashboard', 'PASS');
      } else {
        logResult('Student', 'Security', 'Route Guard redirects unauthorized access from #/admin/users', 'FAIL', `Current URL: ${url}`);
      }
    } catch (e) {
      logResult('Student', 'Security', 'Route Guard test', 'FAIL', '', e);
    }

    try {
      await page.goto(`${BASE_URL}/#/teacher/upload`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      const url = page.url();
      if (url.includes('/student/dashboard')) {
        logResult('Student', 'Security', 'Route Guard redirects unauthorized access from #/teacher/upload to #/student/dashboard', 'PASS');
      } else {
        logResult('Student', 'Security', 'Route Guard redirects unauthorized access from #/teacher/upload', 'FAIL', `Current URL: ${url}`);
      }
    } catch (e) {
      logResult('Student', 'Security', 'Route Guard test #2', 'FAIL', '', e);
    }

    // Student Dashboard
    try {
      await page.goto(`${BASE_URL}/#/student/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      
      const chatInput = await page.locator('textarea, input[placeholder*="Pregunt"], input[placeholder*="Escribí"]').first().isVisible().catch(() => false);
      const sendBtn = await page.locator('button[aria-label*="Enviar"], button:has-text("Enviar"), button svg').first().isVisible().catch(() => false);
      const courseDropdown = await page.locator('#global-course-btn').isVisible().catch(() => false);
      const quickPrompts = await page.locator('.quick-prompt-btn, .prompt-chip, .suggestion-chip').count().catch(() => 0);

      logResult('Student', 'Dashboard', 'Chat widget UI rendered', chatInput ? 'PASS' : 'FAIL', `Chat input visible: ${chatInput}, Send button: ${sendBtn}, Course selector: ${courseDropdown}`);
      logResult('Student', 'Dashboard', 'Suggested quick prompt chips rendered', quickPrompts > 0 ? 'PASS' : 'WARN', `Found ${quickPrompts} prompt chips`);

      // Test sending a query
      if (chatInput) {
        const inputLocator = page.locator('textarea, input[placeholder*="Pregunt"], input[placeholder*="Escribí"]').first();
        await inputLocator.fill('¿Qué es la arquitectura de microservicios?');
        const submitBtn = page.locator('button[aria-label*="Enviar"], button:has-text("Enviar")').first();
        if (await submitBtn.isVisible()) {
          await submitBtn.click();
          await page.waitForTimeout(3000);
          const messagesCount = await page.locator('.chat-message, .message-bubble, [data-role="assistant"], .message').count().catch(() => 0);
          logResult('Student', 'Dashboard', 'Chat query submission and message rendering', messagesCount > 0 ? 'PASS' : 'WARN', `Rendered messages count: ${messagesCount}`);

          // Test Feedback buttons
          const thumbsUp = await page.locator('button[title*="útil"], button[aria-label*="útil"], .feedback-btn').count().catch(() => 0);
          logResult('Student', 'Dashboard', 'Feedback buttons rendered on assistant response', thumbsUp > 0 ? 'PASS' : 'WARN', `Found ${thumbsUp} feedback buttons`);
        }
      }

      await page.screenshot({ path: path.join(OUTPUT_DIR, 'student-dashboard.png') });
    } catch (e) {
      logResult('Student', 'Dashboard', 'Dashboard load and chat interaction', 'FAIL', '', e);
    }

    // Student Notifications
    try {
      await page.goto(`${BASE_URL}/#/student/notifications`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const notifHeading = await page.locator('h1, h2, .h2, .h3').first().textContent().catch(() => '');
      const filterPills = await page.locator('button[data-filter], .filter-pill, .tab-btn').count().catch(() => 0);
      const emptyOrList = await page.locator('.notification-item, .notification-card, .notification-empty, .empty-state').first().isVisible().catch(() => false);

      logResult('Student', 'Notifications', 'Notifications page loads with filter pills', (filterPills > 0 || emptyOrList) ? 'PASS' : 'WARN', `Heading: "${notifHeading.trim()}", Filters count: ${filterPills}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'student-notifications.png') });
    } catch (e) {
      logResult('Student', 'Notifications', 'Notifications page test', 'FAIL', '', e);
    }

    // Student Tasks & Grades
    try {
      await page.goto(`${BASE_URL}/#/student/tasks`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const tasksHeading = await page.locator('h1, h2, .h2, .h3').first().textContent().catch(() => '');
      const taskCards = await page.locator('.task-card, .task-item, .sga-card, table tr').count().catch(() => 0);
      const statusFilters = await page.locator('button[data-status], .filter-btn, select').count().catch(() => 0);

      logResult('Student', 'Tasks', 'Tasks and Grades page loads', taskCards > 0 || tasksHeading.length > 0 ? 'PASS' : 'FAIL', `Heading: "${tasksHeading.trim()}", Cards count: ${taskCards}, Filters count: ${statusFilters}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'student-tasks.png') });
    } catch (e) {
      logResult('Student', 'Tasks', 'Tasks page test', 'FAIL', '', e);
    }

    // Student Calendar
    try {
      await page.goto(`${BASE_URL}/#/student/calendar`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const calHeading = await page.locator('h1, h2, .h2, .h3').first().textContent().catch(() => '');
      const calEvents = await page.locator('.calendar-event, .event-item, .calendar-day, .event-card').count().catch(() => 0);
      const exportBtn = await page.locator('button:has-text("Exportar"), button:has-text("ICS"), button:has-text("iCal"), #export-cal').first().isVisible().catch(() => false);

      logResult('Student', 'Calendar', 'Academic Calendar page loads', calEvents > 0 || calHeading.length > 0 ? 'PASS' : 'FAIL', `Heading: "${calHeading.trim()}", Events/Days count: ${calEvents}, Export button: ${exportBtn}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'student-calendar.png') });
    } catch (e) {
      logResult('Student', 'Calendar', 'Calendar page test', 'FAIL', '', e);
    }

    // Student Settings
    try {
      await page.goto(`${BASE_URL}/#/student/settings`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const toneSelector = await page.locator('select#bot-tone, [data-setting="tone"], input[name="tone"], select').first().isVisible().catch(() => false);
      const lengthSelector = await page.locator('select#bot-length, [data-setting="length"], input[name="length"]').first().isVisible().catch(() => false);
      const reminderToggle = await page.locator('input[type="checkbox"]#reminder-toggle, input[type="checkbox"][name="reminder"], input[type="checkbox"]').first().isVisible().catch(() => false);
      const saveBtn = await page.locator('button:has-text("Guardar"), button[type="submit"]').first().isVisible().catch(() => false);

      logResult('Student', 'Settings', 'Bot preferences and notifications settings UI', (toneSelector || lengthSelector || saveBtn || reminderToggle) ? 'PASS' : 'WARN', `Tone: ${toneSelector}, Length: ${lengthSelector}, Reminders: ${reminderToggle}, Save btn: ${saveBtn}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'student-settings.png') });
    } catch (e) {
      logResult('Student', 'Settings', 'Settings page test', 'FAIL', '', e);
    }

    // Student Reports
    try {
      await page.goto(`${BASE_URL}/#/student/reports`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const reportsHeading = await page.locator('h1, h2, .h2, .h3').first().textContent().catch(() => '');
      const reportsContainer = await page.locator('.report-card, .reports-table, .empty-state, #reports-list, .card').first().isVisible().catch(() => false);

      logResult('Student', 'Reports', 'Student hallucination/feedback reports page loads', reportsContainer ? 'PASS' : 'WARN', `Heading: "${reportsHeading.trim()}", Container visible: ${reportsContainer}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'student-reports.png') });
    } catch (e) {
      logResult('Student', 'Reports', 'Reports page test', 'FAIL', '', e);
    }

    // Student Search Results
    try {
      await page.goto(`${BASE_URL}/#/student/search?q=arquitectura`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const searchHeading = await page.locator('h1, h2, .h2, .h3').first().textContent().catch(() => '');
      const searchResults = await page.locator('.search-result, .result-item, .empty-state, #search-results, .card').first().isVisible().catch(() => false);

      logResult('Student', 'Search', 'Global Search page loads with query params', searchResults ? 'PASS' : 'WARN', `Heading: "${searchHeading.trim()}"`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'student-search.png') });
    } catch (e) {
      logResult('Student', 'Search', 'Search page test', 'FAIL', '', e);
    }

    // Student Class Detail
    try {
      await page.goto(`${BASE_URL}/#/student/class/class-01`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const classHeading = await page.locator('h1, h2, .h2, .h3').first().textContent().catch(() => '');
      const materialsList = await page.locator('.material-item, .material-card, .materials-list').count().catch(() => 0);
      const summaryBox = await page.locator('.summary-content, .class-summary, .ai-summary').first().isVisible().catch(() => false);

      logResult('Student', 'ClassDetail', 'Class detail page loads class timeline and materials', (materialsList > 0 || summaryBox || classHeading.length > 0) ? 'PASS' : 'WARN', `Heading: "${classHeading.trim()}", Materials: ${materialsList}, Summary: ${summaryBox}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'student-class-detail.png') });
    } catch (e) {
      logResult('Student', 'ClassDetail', 'Class detail test', 'FAIL', '', e);
    }

    // Top utility bar and profile dropdown
    try {
      const profileBtn = page.locator('#profile-trigger-nav');
      if (await profileBtn.isVisible()) {
        await profileBtn.click();
        await page.waitForTimeout(400);
        const profilePanel = page.locator('#profile-panel-nav');
        const isPanelVisible = await profilePanel.isVisible().catch(() => false);
        const userName = await page.locator('.profile-panel-name').textContent().catch(() => '');
        logResult('Student', 'Navigation', 'Profile menu opens and displays user identity', isPanelVisible ? 'PASS' : 'FAIL', `Visible: ${isPanelVisible}, User Name: "${userName.trim()}"`);
      }
    } catch (e) {
      logResult('Student', 'Navigation', 'Profile menu test', 'FAIL', '', e);
    }

    // Theme toggle test
    try {
      const themeToggle = page.locator('#theme-toggle-nav');
      if (await themeToggle.isVisible()) {
        await themeToggle.click();
        await page.waitForTimeout(300);
        const currentTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || localStorage.getItem('edu_theme'));
        logResult('Student', 'Theme', 'Theme toggle switches theme attribute', currentTheme ? 'PASS' : 'WARN', `Active theme: ${currentTheme}`);
      }
    } catch (e) {
      logResult('Student', 'Theme', 'Theme toggle test', 'FAIL', '', e);
    }

    // Onboarding guide trigger test
    try {
      const onboardingBtn = page.locator('#nav-student-onboarding-desktop');
      if (await onboardingBtn.isVisible()) {
        await onboardingBtn.click();
        await page.waitForTimeout(600);
        const overlayVisible = await page.locator('.onboarding-overlay, .onboarding-modal, .onboarding-step').first().isVisible().catch(() => false);
        logResult('Student', 'Onboarding', 'Onboarding guide opens interactive overlay', overlayVisible ? 'PASS' : 'WARN', `Overlay visible: ${overlayVisible}`);
        
        // Close or finish onboarding
        const closeBtn = page.locator('.onboarding-btn-close, .onboarding-btn-skip, button:has-text("Saltar"), button:has-text("Cerrar")').first();
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await page.waitForTimeout(300);
        }
      }
    } catch (e) {
      logResult('Student', 'Onboarding', 'Onboarding guide test', 'FAIL', '', e);
    }

    await context.close();
  }

  // ─────────────────────────────────────────────────────────────
  // 3. TEACHER / PROFESSOR PERSONA AUDIT
  // ─────────────────────────────────────────────────────────────
  {
    console.log('\n--- TESTING TEACHER PERSONA (Profesor Xavier - doc-001) ---');
    const { context, page } = await createPersonaContext('teacher', 'doc-001');

    // Teacher Dashboard
    try {
      await page.goto(`${BASE_URL}/#/teacher/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const heading = await page.locator('h1, h2, .h2, .h3').first().textContent().catch(() => '');
      const statCards = await page.locator('.metric-card, .stat-card, .card').count().catch(() => 0);
      const classCards = await page.locator('.class-card, .course-card, .list-item').count().catch(() => 0);

      logResult('Teacher', 'Dashboard', 'Teacher dashboard loads cátedras and overview cards', statCards > 0 || classCards > 0 ? 'PASS' : 'FAIL', `Heading: "${heading.trim()}", Stat cards: ${statCards}, Class cards: ${classCards}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'teacher-dashboard.png') });
    } catch (e) {
      logResult('Teacher', 'Dashboard', 'Dashboard test', 'FAIL', '', e);
    }

    // Teacher Class Manager
    try {
      await page.goto(`${BASE_URL}/#/teacher/classes`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const classesCount = await page.locator('.class-row, .class-card, .table-row, tr').count().catch(() => 0);
      const newClassBtn = await page.locator('button:has-text("Nueva Clase"), button:has-text("Crear Clase"), #btn-new-class').first().isVisible().catch(() => false);

      logResult('Teacher', 'ClassManager', 'Teacher class manager lists scheduled classes', classesCount > 0 || newClassBtn ? 'PASS' : 'WARN', `Classes count: ${classesCount}, New class button: ${newClassBtn}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'teacher-classes.png') });
    } catch (e) {
      logResult('Teacher', 'ClassManager', 'Class manager test', 'FAIL', '', e);
    }

    // Teacher Upload Materials
    try {
      await page.goto(`${BASE_URL}/#/teacher/upload`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const fileInput = await page.locator('input[type="file"]').first().isVisible().catch(() => false);
      const typeSelect = await page.locator('select#material-type, select[name="type"], select').first().isVisible().catch(() => false);
      const classSelect = await page.locator('select#class-id, select[name="classId"]').first().isVisible().catch(() => false);
      const uploadBtn = await page.locator('button[type="submit"], button:has-text("Subir"), button:has-text("Cargar")').first().isVisible().catch(() => false);

      logResult('Teacher', 'Upload', 'Upload materials form elements present', (fileInput || uploadBtn) ? 'PASS' : 'FAIL', `File input: ${fileInput}, Type selector: ${typeSelect}, Class selector: ${classSelect}, Submit button: ${uploadBtn}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'teacher-upload.png') });
    } catch (e) {
      logResult('Teacher', 'Upload', 'Upload materials test', 'FAIL', '', e);
    }

    // Teacher Material Manager
    try {
      await page.goto(`${BASE_URL}/#/teacher/materials`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const materialsCount = await page.locator('.material-card, .material-row, table tbody tr').count().catch(() => 0);
      const filterSelect = await page.locator('select, .filter-pills').first().isVisible().catch(() => false);

      logResult('Teacher', 'Materials', 'Material manager lists uploaded materials and statuses', materialsCount > 0 || filterSelect ? 'PASS' : 'WARN', `Materials count: ${materialsCount}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'teacher-materials.png') });
    } catch (e) {
      logResult('Teacher', 'Materials', 'Material manager test', 'FAIL', '', e);
    }

    // Teacher Corrections Inbox
    try {
      await page.goto(`${BASE_URL}/#/teacher/corrections`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const correctionsCount = await page.locator('.correction-card, .inbox-item, table tbody tr, .empty-state').count().catch(() => 0);
      const heading = await page.locator('h1, h2, .h2, .h3').first().textContent().catch(() => '');

      logResult('Teacher', 'Corrections', 'Corrections inbox page loads', correctionsCount > 0 ? 'PASS' : 'FAIL', `Heading: "${heading.trim()}", Items count: ${correctionsCount}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'teacher-corrections.png') });
    } catch (e) {
      logResult('Teacher', 'Corrections', 'Corrections inbox test', 'FAIL', '', e);
    }

    // Teacher Transcription Corrections
    try {
      await page.goto(`${BASE_URL}/#/teacher/transcription-corrections`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const itemsCount = await page.locator('.transcription-card, .error-item, table tbody tr, .empty-state').count().catch(() => 0);

      logResult('Teacher', 'TranscriptionCorrections', 'Transcription corrections page loads', itemsCount > 0 ? 'PASS' : 'WARN', `Items count: ${itemsCount}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'teacher-transcription-corrections.png') });
    } catch (e) {
      logResult('Teacher', 'TranscriptionCorrections', 'Transcription corrections test', 'FAIL', '', e);
    }

    // Teacher Glossary Manager
    try {
      await page.goto(`${BASE_URL}/#/teacher/glossary`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const termCards = await page.locator('.glossary-term, .term-card, table tbody tr, .empty-state').count().catch(() => 0);
      const addTermBtn = await page.locator('button:has-text("Nuevo"), button:has-text("Agregar"), #btn-add-term').first().isVisible().catch(() => false);

      logResult('Teacher', 'Glossary', 'Glossary manager loads with term list and add button', (termCards > 0 || addTermBtn) ? 'PASS' : 'FAIL', `Terms count: ${termCards}, Add button: ${addTermBtn}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'teacher-glossary.png') });
    } catch (e) {
      logResult('Teacher', 'Glossary', 'Glossary manager test', 'FAIL', '', e);
    }

    // Teacher RAG Sandbox
    try {
      await page.goto(`${BASE_URL}/#/teacher/rag-sandbox`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const testQueryInput = await page.locator('textarea, input[placeholder*="pregunta"], input[placeholder*="Query"]').first().isVisible().catch(() => false);
      const testRunBtn = await page.locator('button:has-text("Probar"), button:has-text("Ejecutar"), button:has-text("Test")').first().isVisible().catch(() => false);

      logResult('Teacher', 'RagSandbox', 'RAG Sandbox interface loads with query input and execution trigger', (testQueryInput || testRunBtn) ? 'PASS' : 'FAIL', `Query input: ${testQueryInput}, Test button: ${testRunBtn}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'teacher-rag-sandbox.png') });
    } catch (e) {
      logResult('Teacher', 'RagSandbox', 'RAG Sandbox test', 'FAIL', '', e);
    }

    // Teacher Analytics
    try {
      await page.goto(`${BASE_URL}/#/teacher/analytics`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const chartsCount = await page.locator('.chart-container, canvas, svg, .metric-box, .card').count().catch(() => 0);
      const heading = await page.locator('h1, h2, .h2, .h3').first().textContent().catch(() => '');

      logResult('Teacher', 'Analytics', 'Teacher analytics page renders charts and engagement metrics', chartsCount > 0 || heading.length > 0 ? 'PASS' : 'WARN', `Heading: "${heading.trim()}", Chart/Card elements: ${chartsCount}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'teacher-analytics.png') });
    } catch (e) {
      logResult('Teacher', 'Analytics', 'Analytics test', 'FAIL', '', e);
    }

    await context.close();
  }

  // ─────────────────────────────────────────────────────────────
  // 4. DIRECTOR PERSONA AUDIT
  // ─────────────────────────────────────────────────────────────
  {
    console.log('\n--- TESTING DIRECTOR PERSONA (Joaquín García - dir-001) ---');
    const { context, page } = await createPersonaContext('director', 'dir-001');

    // Director Dashboard
    try {
      await page.goto(`${BASE_URL}/#/director/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const kpisCount = await page.locator('.kpi-card, .stat-card, .metric-card, .card').count().catch(() => 0);
      const heading = await page.locator('h1, h2, .h2, .h3').first().textContent().catch(() => '');

      logResult('Director', 'Dashboard', 'Director dashboard renders executive KPIs and adoption metrics', kpisCount > 0 ? 'PASS' : 'FAIL', `Heading: "${heading.trim()}", KPI cards count: ${kpisCount}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'director-dashboard.png') });
    } catch (e) {
      logResult('Director', 'Dashboard', 'Director dashboard test', 'FAIL', '', e);
    }

    // SAT by Prompt Analytics
    try {
      await page.goto(`${BASE_URL}/#/director/sat-analytics`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const satMetrics = await page.locator('.sat-metric, .chart-box, table tbody tr, .card').count().catch(() => 0);

      logResult('Director', 'SatAnalytics', 'SAT by Prompt satisfaction analytics page loads', satMetrics > 0 ? 'PASS' : 'WARN', `Metric boxes: ${satMetrics}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'director-sat-analytics.png') });
    } catch (e) {
      logResult('Director', 'SatAnalytics', 'SAT analytics test', 'FAIL', '', e);
    }

    // Director Interventions
    try {
      await page.goto(`${BASE_URL}/#/director/interventions`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const atRiskCards = await page.locator('.at-risk-card, .intervention-item, table tbody tr, .empty-state, .card').count().catch(() => 0);
      const createInterventionBtn = await page.locator('button:has-text("Nueva Intervención"), button:has-text("Intervenir")').first().isVisible().catch(() => false);

      logResult('Director', 'Interventions', 'Interventions and Early Warning page loads', atRiskCards > 0 || createInterventionBtn ? 'PASS' : 'WARN', `Items: ${atRiskCards}, Action btn: ${createInterventionBtn}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'director-interventions.png') });
    } catch (e) {
      logResult('Director', 'Interventions', 'Interventions test', 'FAIL', '', e);
    }

    // Director Class Management
    try {
      await page.goto(`${BASE_URL}/#/director/classes`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const classesCount = await page.locator('.class-row, .class-card, table tbody tr, .empty-state, .card').count().catch(() => 0);

      logResult('Director', 'ClassManagement', 'Director class management cross-subject view loads', classesCount > 0 ? 'PASS' : 'WARN', `Classes: ${classesCount}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'director-classes.png') });
    } catch (e) {
      logResult('Director', 'ClassManagement', 'Class management test', 'FAIL', '', e);
    }

    // Director Subject Management
    try {
      await page.goto(`${BASE_URL}/#/director/subjects`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const subjectRows = await page.locator('.subject-row, .subject-card, table tbody tr, .card').count().catch(() => 0);

      logResult('Director', 'SubjectManagement', 'Director subject management overview loads', subjectRows > 0 ? 'PASS' : 'WARN', `Subject cards/rows: ${subjectRows}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'director-subjects.png') });
    } catch (e) {
      logResult('Director', 'SubjectManagement', 'Subject management test', 'FAIL', '', e);
    }

    // Director Compliance
    try {
      await page.goto(`${BASE_URL}/#/director/compliance`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const complianceCards = await page.locator('.compliance-card, .audit-log, table tbody tr, .card').count().catch(() => 0);

      logResult('Director', 'Compliance', 'AI Ethics and Compliance audit page loads', complianceCards > 0 ? 'PASS' : 'WARN', `Audit items: ${complianceCards}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'director-compliance.png') });
    } catch (e) {
      logResult('Director', 'Compliance', 'Compliance test', 'FAIL', '', e);
    }

    await context.close();
  }

  // ─────────────────────────────────────────────────────────────
  // 5. TECHNICAL ADMINISTRATOR PERSONA AUDIT
  // ─────────────────────────────────────────────────────────────
  {
    console.log('\n--- TESTING TECHNICAL ADMIN PERSONA (Admin Técnico - adm-001) ---');
    const { context, page } = await createPersonaContext('admin', 'adm-001');

    // Admin Dashboard
    try {
      await page.goto(`${BASE_URL}/#/admin/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const healthCards = await page.locator('.metric-card, .health-card, .stat-card, .card').count().catch(() => 0);
      const heading = await page.locator('h1, h2, .h2, .h3').first().textContent().catch(() => '');

      logResult('Admin', 'Dashboard', 'Admin technical dashboard renders system health and metrics', healthCards > 0 ? 'PASS' : 'FAIL', `Heading: "${heading.trim()}", Health cards: ${healthCards}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-dashboard.png') });
    } catch (e) {
      logResult('Admin', 'Dashboard', 'Admin dashboard test', 'FAIL', '', e);
    }

    // Admin User Management (Allowlist)
    try {
      await page.goto(`${BASE_URL}/#/admin/users`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const userRows = await page.locator('table tbody tr, .user-card, .user-row').count().catch(() => 0);
      const searchUserInput = await page.locator('input[placeholder*="Buscar"], input[type="search"]').first().isVisible().catch(() => false);
      const roleBadges = await page.locator('.role-badge, .badge').count().catch(() => 0);

      logResult('Admin', 'UserManagement', 'User allowlist table renders with search and role badges', userRows > 0 ? 'PASS' : 'FAIL', `User rows count: ${userRows}, Search input: ${searchUserInput}, Role badges: ${roleBadges}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-users.png') });
    } catch (e) {
      logResult('Admin', 'UserManagement', 'User management test', 'FAIL', '', e);
    }

    // Admin Settings
    try {
      await page.goto(`${BASE_URL}/#/admin/settings`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const configItems = await page.locator('.config-item, .setting-row, input, select, .card').count().catch(() => 0);

      logResult('Admin', 'Settings', 'Technical configuration and environment settings load', configItems > 0 ? 'PASS' : 'WARN', `Config elements: ${configItems}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-settings.png') });
    } catch (e) {
      logResult('Admin', 'Settings', 'Admin settings test', 'FAIL', '', e);
    }

    // Admin Model Config
    try {
      await page.goto(`${BASE_URL}/#/admin/model-config`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const modelSelect = await page.locator('select#model-name, select[name="model"], select').first().isVisible().catch(() => false);
      const tempSlider = await page.locator('input[type="range"], input#temperature').first().isVisible().catch(() => false);
      const saveModelBtn = await page.locator('button:has-text("Guardar"), button:has-text("Aplicar")').first().isVisible().catch(() => false);

      logResult('Admin', 'ModelConfig', 'AI Model selection and hyperparameter configuration UI', (modelSelect || tempSlider || saveModelBtn) ? 'PASS' : 'WARN', `Model select: ${modelSelect}, Temp slider: ${tempSlider}, Save btn: ${saveModelBtn}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-model-config.png') });
    } catch (e) {
      logResult('Admin', 'ModelConfig', 'Model config test', 'FAIL', '', e);
    }

    // Admin Retention Policies
    try {
      await page.goto(`${BASE_URL}/#/admin/retention`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const retentionRules = await page.locator('.retention-rule, .policy-card, table tbody tr, .card').count().catch(() => 0);

      logResult('Admin', 'Retention', 'Data retention policy management page loads', retentionRules > 0 ? 'PASS' : 'WARN', `Rules/Cards: ${retentionRules}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-retention.png') });
    } catch (e) {
      logResult('Admin', 'Retention', 'Retention test', 'FAIL', '', e);
    }

    // Admin Prompt Manager
    try {
      await page.goto(`${BASE_URL}/#/admin/prompts`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const promptEditors = await page.locator('textarea, .prompt-card, .prompt-template, .card').count().catch(() => 0);

      logResult('Admin', 'PromptManager', 'System prompt template manager loads', promptEditors > 0 ? 'PASS' : 'WARN', `Prompt editors: ${promptEditors}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-prompts.png') });
    } catch (e) {
      logResult('Admin', 'PromptManager', 'Prompt manager test', 'FAIL', '', e);
    }

    // Admin Cold Storage Archive Usage
    try {
      await page.goto(`${BASE_URL}/#/admin/archive-usage`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const archiveStats = await page.locator('.archive-card, .storage-stat, .card').count().catch(() => 0);

      logResult('Admin', 'ArchiveUsage', 'Cold storage archive usage analytics load', archiveStats > 0 ? 'PASS' : 'WARN', `Stat cards: ${archiveStats}`);
      await page.screenshot({ path: path.join(OUTPUT_DIR, 'admin-archive-usage.png') });
    } catch (e) {
      logResult('Admin', 'ArchiveUsage', 'Archive usage test', 'FAIL', '', e);
    }

    await context.close();
  }

  await browser.close();

  // ─────────────────────────────────────────────────────────────
  // 6. COMPILE SUMMARY & SAVE JSON
  // ─────────────────────────────────────────────────────────────
  const summary = {
    total: testResults.length,
    passed: testResults.filter(r => r.status === 'PASS').length,
    warn: testResults.filter(r => r.status === 'WARN').length,
    failed: testResults.filter(r => r.status === 'FAIL').length,
    consoleErrorsCount: consoleErrors.length,
    networkFailuresCount: networkFailures.length,
    consoleErrors,
    networkFailures,
    results: testResults
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'test-summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n================================================================');
  console.log(`DEEP QA RUN FINISHED: ${summary.passed} PASSED | ${summary.warn} WARNINGS | ${summary.failed} FAILED`);
  console.log(`Console errors captured: ${summary.consoleErrorsCount}`);
  console.log(`Network request failures captured: ${summary.networkFailuresCount}`);
  console.log(`Saved summary to: ${path.join(OUTPUT_DIR, 'test-summary.json')}`);
  console.log('================================================================\n');
}

runDeepQA().catch(err => {
  console.error('Fatal error in deep QA runner:', err);
  process.exit(1);
});
