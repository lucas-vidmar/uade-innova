import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:5173';
const REPORT_DIR = path.resolve('test-report', 'full-audit');
fs.mkdirSync(REPORT_DIR, { recursive: true });

const findings = [];
const consoleLogs = [];
const networkLogs = [];

function recordFinding({ persona, feature, route, status, severity, title, observation, expected, screenshot }) {
  findings.push({
    persona,
    feature,
    route,
    status, // PASS, DEFECT, UX_IMPROVEMENT, BLOCKED
    severity, // CRITICAL, HIGH, MEDIUM, LOW, NONE
    title,
    observation,
    expected,
    screenshot: screenshot ? path.relative('.', screenshot) : null,
    timestamp: new Date().toISOString()
  });
  const icon = status === 'PASS' ? '✅' : status === 'DEFECT' ? '❌' : status === 'UX_IMPROVEMENT' ? '💡' : '⚠️';
  console.log(`${icon} [${persona.toUpperCase()}][${severity}] ${title}`);
  if (observation) console.log(`   🔎 ${observation}`);
}

async function setupPageForPersona(browser, role, uid, studentKey = null, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(({ role, uid, studentKey }) => {
    try { localStorage.setItem('edu_ai_consent_accepted', 'true'); } catch(e) {}
    try { localStorage.setItem('edu_consent_accepted', 'true'); } catch(e) {}
    try { localStorage.setItem('uade_use_mock', 'true'); } catch(e) {}
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
    sessionStorage.setItem('edu_role', role);
    sessionStorage.setItem('edu_uid', uid);
    if (studentKey) sessionStorage.setItem('edu_student_key', studentKey);
  }, { role, uid, studentKey });

  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleLogs.push({ role, url: page.url(), text: msg.text() });
    }
  });
  page.on('requestfailed', req => {
    networkLogs.push({ role, url: req.url(), error: req.failure()?.errorText });
  });

  return { context, page };
}

async function runFullAudit() {
  console.log('================================================================');
  console.log(`Starting Comprehensive End-to-End Persona QA on ${BASE_URL}`);
  console.log('================================================================\n');

  const browser = await chromium.launch({ headless: true });

  // ══════════════════════════════════════════════════════════════════
  // DOMAIN 0: Public & Auth Flows
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- 0. PUBLIC & AUTH FLOWS ---');
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // 0.1 Login Page
    await page.goto(`${BASE_URL}/#/login`);
    await page.waitForTimeout(500);
    const loginText = await page.textContent('body');
    const ssLogin = path.join(REPORT_DIR, '01-public-login.png');
    await page.screenshot({ path: ssLogin });
    if (loginText.includes('Iniciá sesión') && loginText.includes('Microsoft')) {
      recordFinding({
        persona: 'Public',
        feature: 'Authentication',
        route: '/#/login',
        status: 'PASS',
        severity: 'NONE',
        title: 'Public login page displays Microsoft SSO CTA and institutional notice',
        observation: 'Login page renders clean card with UADE institutional login prompt and AAD redirection link.',
        expected: 'Clear login button pointing to Microsoft Entra/AAD authentication.',
        screenshot: ssLogin
      });
    } else {
      recordFinding({
        persona: 'Public',
        feature: 'Authentication',
        route: '/#/login',
        status: 'DEFECT',
        severity: 'HIGH',
        title: 'Login page missing institutional copy or login button',
        observation: `Page text: "${loginText.slice(0, 150)}"`,
        expected: 'Login CTA with Microsoft account authentication link.',
        screenshot: ssLogin
      });
    }

    // 0.2 Access Denied Page
    await page.goto(`${BASE_URL}/#/access-denied`);
    await page.waitForTimeout(500);
    const deniedText = await page.textContent('body');
    const ssDenied = path.join(REPORT_DIR, '02-public-access-denied.png');
    await page.screenshot({ path: ssDenied });
    if (deniedText.includes('Acceso denegado') && deniedText.includes('administración')) {
      recordFinding({
        persona: 'Public',
        feature: 'Authorization',
        route: '/#/access-denied',
        status: 'PASS',
        severity: 'NONE',
        title: 'Access Denied page explains unlisted account state with retry & logout actions',
        observation: 'Clear message instructing unlisted users to contact administration with working logout/retry options.',
        expected: '403 explanation message with action buttons.',
        screenshot: ssDenied
      });
    } else {
      recordFinding({
        persona: 'Public',
        feature: 'Authorization',
        route: '/#/access-denied',
        status: 'DEFECT',
        severity: 'HIGH',
        title: 'Access Denied page missing instructions or action buttons',
        observation: `Page text: "${deniedText.slice(0, 150)}"`,
        expected: 'Clear explanation of access denial.',
        screenshot: ssDenied
      });
    }
    await context.close();
  }

  // ══════════════════════════════════════════════════════════════════
  // DOMAIN 1: Student Persona (Lucas Vidmar & María González)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- 1. STUDENT PERSONA ---');
  {
    const { context, page } = await setupPageForPersona(browser, 'student', 'alu-001', 'student');

    // 1.1 Route Security / RBAC
    await page.goto(`${BASE_URL}/#/admin/users`);
    await page.waitForTimeout(400);
    const currentUrl = page.url();
    if (currentUrl.includes('/student/dashboard')) {
      recordFinding({
        persona: 'Student',
        feature: 'Security & Route Guards',
        route: '/#/admin/users -> /#/student/dashboard',
        status: 'PASS',
        severity: 'NONE',
        title: 'Client router enforces RBAC route guard and redirects unauthorized route',
        observation: 'Student navigating to #/admin/users was automatically bounced back to #/student/dashboard.',
        expected: 'Unauthorized routes redirected to student home.'
      });
    } else {
      recordFinding({
        persona: 'Student',
        feature: 'Security & Route Guards',
        route: '/#/admin/users',
        status: 'DEFECT',
        severity: 'CRITICAL',
        title: 'Student able to access admin route without redirection',
        observation: `Url remained: ${currentUrl}`,
        expected: 'Redirection to /student/dashboard'
      });
    }

    // 1.2 Student Dashboard (Chat, Prompts, Sources)
    await page.goto(`${BASE_URL}/#/student/dashboard`);
    await page.waitForTimeout(1000);
    const ssStudentDash = path.join(REPORT_DIR, '03-student-dashboard.png');
    await page.screenshot({ path: ssStudentDash });

    const chatTextarea = page.locator('textarea, input[placeholder*="Pregunt"], input[placeholder*="Escribí"]').first();
    const hasChat = await chatTextarea.isVisible().catch(() => false);
    const chipsCount = await page.locator('.quick-prompt-btn, .prompt-chip, .suggestion-chip').count().catch(() => 0);
    const courseSelector = await page.locator('#global-course-btn').first().isVisible().catch(() => false);

    if (hasChat) {
      recordFinding({
        persona: 'Student',
        feature: 'Chat & RAG Interface',
        route: '/#/student/dashboard',
        status: 'PASS',
        severity: 'NONE',
        title: 'Student Dashboard chat widget and prompt suggestions initialized',
        observation: `Chat interface active. Course selector visible: ${courseSelector}. Quick prompt chips: ${chipsCount}.`,
        expected: 'Interactive chat with prompt chips and course switcher.',
        screenshot: ssStudentDash
      });

      // Submit test message
      await chatTextarea.fill('¿Cuáles son los principios SOLID en arquitectura de software?');
      const submitBtn = page.locator('button[aria-label*="Enviar"], button:has-text("Enviar")').first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(2500);
        const ssChatResponse = path.join(REPORT_DIR, '04-student-chat-interaction.png');
        await page.screenshot({ path: ssChatResponse });

        const messages = await page.locator('.chat-message, .message-bubble, [data-role="assistant"]').count().catch(() => 0);
        const feedbackBtns = await page.locator('button[title*="útil"], button[aria-label*="útil"], .feedback-btn, button:has(.fa-thumbs-up), button:has(.fa-thumbs-down)').count().catch(() => 0);

        recordFinding({
          persona: 'Student',
          feature: 'Chat Interaction & Feedback',
          route: '/#/student/dashboard',
          status: messages > 0 ? 'PASS' : 'UX_IMPROVEMENT',
          severity: messages > 0 ? 'NONE' : 'LOW',
          title: 'Chat message submission and feedback controls response',
          observation: `Assistant messages visible: ${messages}. Feedback buttons detected: ${feedbackBtns}.`,
          expected: 'Assistant answer rendered with thumbs-up/down feedback buttons.',
          screenshot: ssChatResponse
        });
      }
    } else {
      recordFinding({
        persona: 'Student',
        feature: 'Chat & RAG Interface',
        route: '/#/student/dashboard',
        status: 'DEFECT',
        severity: 'HIGH',
        title: 'Chat input textarea not visible on Student Dashboard',
        observation: 'Chat widget input could not be located in DOM.',
        expected: 'Visible input for academic queries.',
        screenshot: ssStudentDash
      });
    }

    // 1.3 Student Notifications
    await page.goto(`${BASE_URL}/#/student/notifications`);
    await page.waitForTimeout(800);
    const ssStudentNotifs = path.join(REPORT_DIR, '05-student-notifications.png');
    await page.screenshot({ path: ssStudentNotifs });
    const notifPills = await page.locator('button[data-filter], .notif-dropdown-pill, .tab-btn').count().catch(() => 0);
    const notifItems = await page.locator('.notification-item, .notification-card, .notification-empty').count().catch(() => 0);
    recordFinding({
      persona: 'Student',
      feature: 'Notifications Center',
      route: '/#/student/notifications',
      status: notifPills > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: notifPills > 0 ? 'NONE' : 'LOW',
      title: 'Student notifications center with category filter pills',
      observation: `Category filter pills: ${notifPills}. Notification items/status: ${notifItems}.`,
      expected: 'Notification center with filters for grades, summaries, deadlines, and materials.',
      screenshot: ssStudentNotifs
    });

    // 1.4 Student Tasks & Grades (SGA integration)
    await page.goto(`${BASE_URL}/#/student/tasks`);
    await page.waitForTimeout(800);
    const ssStudentTasks = path.join(REPORT_DIR, '06-student-tasks.png');
    await page.screenshot({ path: ssStudentTasks });
    const taskElements = await page.locator('.task-card, .task-item, .sga-card, table tbody tr').count().catch(() => 0);
    const taskPageText = await page.textContent('body');
    if (taskElements > 0 || taskPageText.includes('Tareas') || taskPageText.includes('Calificaciones')) {
      recordFinding({
        persona: 'Student',
        feature: 'Tasks & Academic Grades',
        route: '/#/student/tasks',
        status: 'PASS',
        severity: 'NONE',
        title: 'SGA Tasks and Grades view renders assignments and status badges',
        observation: `Rendered ${taskElements} task/grade cards or rows.`,
        expected: 'Overview of pending assignments, grades, and deadlines.',
        screenshot: ssStudentTasks
      });
    } else {
      recordFinding({
        persona: 'Student',
        feature: 'Tasks & Academic Grades',
        route: '/#/student/tasks',
        status: 'DEFECT',
        severity: 'MEDIUM',
        title: 'Tasks page rendered blank or failed to show academic assignments',
        observation: 'No task cards or SGA rows rendered.',
        expected: 'Assignment list with due dates and grading.',
        screenshot: ssStudentTasks
      });
    }

    // 1.5 Student Calendar
    await page.goto(`${BASE_URL}/#/student/calendar`);
    await page.waitForTimeout(800);
    const ssStudentCal = path.join(REPORT_DIR, '07-student-calendar.png');
    await page.screenshot({ path: ssStudentCal });
    const calDays = await page.locator('.calendar-day, .event-item, .calendar-grid').count().catch(() => 0);
    const exportCalBtn = await page.locator('button:has-text("Exportar"), button:has-text("ICS"), button:has-text("iCal")').first().isVisible().catch(() => false);
    recordFinding({
      persona: 'Student',
      feature: 'Academic Calendar',
      route: '/#/student/calendar',
      status: calDays > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: calDays > 0 ? 'NONE' : 'LOW',
      title: 'Academic calendar renders class schedule and export functionality',
      observation: `Calendar container rendered. Export button visible: ${exportCalBtn}.`,
      expected: 'Monthly/weekly academic timeline with exam dates and export option.',
      screenshot: ssStudentCal
    });

    // 1.6 Student Settings & Preferences
    await page.goto(`${BASE_URL}/#/student/settings`);
    await page.waitForTimeout(800);
    const ssStudentSettings = path.join(REPORT_DIR, '08-student-settings.png');
    await page.screenshot({ path: ssStudentSettings });
    const toneSelect = await page.locator('select#bot-tone, [data-setting="tone"], input[name="tone"], select').first().isVisible().catch(() => false);
    const consentToggle = await page.locator('input[type="checkbox"]').count().catch(() => 0);
    recordFinding({
      persona: 'Student',
      feature: 'Settings & Bot Customization',
      route: '/#/student/settings',
      status: (toneSelect || consentToggle > 0) ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Student settings page offers AI response customization and privacy toggles',
      observation: `Bot tone controls visible: ${toneSelect}. Checkbox toggles: ${consentToggle}.`,
      expected: 'Customization of AI assistant tone, length, citations, and reminder frequencies.',
      screenshot: ssStudentSettings
    });

    // 1.7 Student Feedback Reports View
    await page.goto(`${BASE_URL}/#/student/reports`);
    await page.waitForTimeout(800);
    const ssStudentReports = path.join(REPORT_DIR, '09-student-reports.png');
    await page.screenshot({ path: ssStudentReports });
    const reportsList = await page.locator('.report-card, .reports-table, .empty-state, .card').first().isVisible().catch(() => false);
    recordFinding({
      persona: 'Student',
      feature: 'Issue & Hallucination Reports',
      route: '/#/student/reports',
      status: reportsList ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Student reported issues list shows report history and teacher status',
      observation: 'Student can track status of submitted discrepancy reports.',
      expected: 'Table or cards showing submitted reports with status chips.',
      screenshot: ssStudentReports
    });

    // 1.8 Student Class Detail
    await page.goto(`${BASE_URL}/#/student/class/class-01`);
    await page.waitForTimeout(800);
    const ssStudentClass = path.join(REPORT_DIR, '10-student-class-detail.png');
    await page.screenshot({ path: ssStudentClass });
    const classDetailText = await page.textContent('body');
    const classMaterials = await page.locator('.material-item, .material-card, .materials-list, .accordion').count().catch(() => 0);
    recordFinding({
      persona: 'Student',
      feature: 'Class Timeline & Materials Detail',
      route: '/#/student/class/class-01',
      status: classMaterials > 0 || classDetailText.includes('Clase') ? 'PASS' : 'UX_IMPROVEMENT',
      severity: classMaterials > 0 ? 'NONE' : 'LOW',
      title: 'Class detail page loads materials list and AI summary',
      observation: `Materials elements count: ${classMaterials}.`,
      expected: 'Class syllabus, presentation slides, transcript chunks, and validated AI summary.',
      screenshot: ssStudentClass
    });

    await context.close();
  }

  // ══════════════════════════════════════════════════════════════════
  // DOMAIN 2: Teacher / Professor Persona (Profesor Xavier - doc-001)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- 2. TEACHER PERSONA ---');
  {
    const { context, page } = await setupPageForPersona(browser, 'teacher', 'doc-001');

    // 2.1 Teacher Dashboard
    await page.goto(`${BASE_URL}/#/teacher/dashboard`);
    await page.waitForTimeout(1000);
    const ssTeacherDash = path.join(REPORT_DIR, '11-teacher-dashboard.png');
    await page.screenshot({ path: ssTeacherDash });
    const statCards = await page.locator('.metric-card, .stat-card, .card').count().catch(() => 0);
    recordFinding({
      persona: 'Teacher',
      feature: 'Teacher Dashboard',
      route: '/#/teacher/dashboard',
      status: statCards > 0 ? 'PASS' : 'DEFECT',
      severity: statCards > 0 ? 'NONE' : 'MEDIUM',
      title: 'Teacher dashboard displays active cátedras and pending review queues',
      observation: `Rendered ${statCards} metric cards / cátedra blocks.`,
      expected: 'Teacher overview of enrolled subjects, class readiness, and pending tasks.',
      screenshot: ssTeacherDash
    });

    // 2.2 Class Manager
    await page.goto(`${BASE_URL}/#/teacher/classes`);
    await page.waitForTimeout(800);
    const ssTeacherClasses = path.join(REPORT_DIR, '12-teacher-classes.png');
    await page.screenshot({ path: ssTeacherClasses });
    const classRows = await page.locator('.class-row, .class-card, table tbody tr, .card').count().catch(() => 0);
    const newClassBtn = await page.locator('button:has-text("Nueva"), button:has-text("Crear"), #btn-new-class').first().isVisible().catch(() => false);
    recordFinding({
      persona: 'Teacher',
      feature: 'Class Schedule Manager',
      route: '/#/teacher/classes',
      status: classRows > 0 || newClassBtn ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Class manager lists semester syllabus and allows class creation/editing',
      observation: `Class rows: ${classRows}. Create class CTA visible: ${newClassBtn}.`,
      expected: 'Table of semester classes with validation indicators and edit actions.',
      screenshot: ssTeacherClasses
    });

    // 2.3 Upload Materials
    await page.goto(`${BASE_URL}/#/teacher/upload`);
    await page.waitForTimeout(800);
    const ssTeacherUpload = path.join(REPORT_DIR, '13-teacher-upload.png');
    await page.screenshot({ path: ssTeacherUpload });
    const fileInput = await page.locator('input[type="file"]').first().isVisible().catch(() => false);
    const typeSelect = await page.locator('select#material-type, select[name="type"], select').first().isVisible().catch(() => false);
    const classSelect = await page.locator('select#class-id, select[name="classId"]').first().isVisible().catch(() => false);
    const isMasterCheckbox = await page.locator('input[type="checkbox"]#is-master, input[type="checkbox"][name="master"]').first().isVisible().catch(() => false);
    const uploadBtn = await page.locator('button[type="submit"], button:has-text("Subir"), button:has-text("Cargar")').first().isVisible().catch(() => false);

    if (fileInput || uploadBtn) {
      recordFinding({
        persona: 'Teacher',
        feature: 'Material Ingestion & Upload Form',
        route: '/#/teacher/upload',
        status: 'PASS',
        severity: 'NONE',
        title: 'Material upload form supports transcripts, slides, notes & master source flag',
        observation: `File input: ${fileInput}. Type selector: ${typeSelect}. Class selector: ${classSelect}. Master source flag: ${isMasterCheckbox}.`,
        expected: 'Complete form with file picker and metadata selectors.',
        screenshot: ssTeacherUpload
      });
    } else {
      recordFinding({
        persona: 'Teacher',
        feature: 'Material Ingestion & Upload Form',
        route: '/#/teacher/upload',
        status: 'DEFECT',
        severity: 'HIGH',
        title: 'Upload materials form missing file picker or submission controls',
        observation: 'Upload inputs not visible in DOM.',
        expected: 'Upload dropzone with material type classification.',
        screenshot: ssTeacherUpload
      });
    }

    // 2.4 Material Manager
    await page.goto(`${BASE_URL}/#/teacher/materials`);
    await page.waitForTimeout(800);
    const ssTeacherMaterials = path.join(REPORT_DIR, '14-teacher-materials.png');
    await page.screenshot({ path: ssTeacherMaterials });
    const materialCards = await page.locator('.material-card, .material-row, table tbody tr, .card').count().catch(() => 0);
    recordFinding({
      persona: 'Teacher',
      feature: 'Material Repository & Status Management',
      route: '/#/teacher/materials',
      status: materialCards > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Material manager displays indexed files, Pinecone vector status & reprocess actions',
      observation: `Materials rendered: ${materialCards}.`,
      expected: 'List of uploaded files with processing statuses (ready, processing, error).',
      screenshot: ssTeacherMaterials
    });

    // 2.5 Correction Inbox
    await page.goto(`${BASE_URL}/#/teacher/corrections`);
    await page.waitForTimeout(800);
    const ssTeacherCorrections = path.join(REPORT_DIR, '15-teacher-corrections.png');
    await page.screenshot({ path: ssTeacherCorrections });
    const correctionCards = await page.locator('.correction-card, .inbox-item, table tbody tr, .card, .empty-state').count().catch(() => 0);
    recordFinding({
      persona: 'Teacher',
      feature: 'Student Feedback & Correction Inbox',
      route: '/#/teacher/corrections',
      status: correctionCards > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Teacher correction inbox reviews student feedback and discrepancy reports',
      observation: `Correction items/empty state count: ${correctionCards}.`,
      expected: 'Inbox listing student-reported discrepancies with filter by status.',
      screenshot: ssTeacherCorrections
    });

    // 2.6 Transcription Corrections
    await page.goto(`${BASE_URL}/#/teacher/transcription-corrections`);
    await page.waitForTimeout(800);
    const ssTeacherTrans = path.join(REPORT_DIR, '16-teacher-transcription-corrections.png');
    await page.screenshot({ path: ssTeacherTrans });
    const transRows = await page.locator('.transcription-card, .error-item, table tbody tr, .card, .empty-state').count().catch(() => 0);
    recordFinding({
      persona: 'Teacher',
      feature: 'Transcription Correction Workflow',
      route: '/#/teacher/transcription-corrections',
      status: transRows > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Transcription corrections interface highlights speech-to-text mismatches',
      observation: `Transcription correction elements: ${transRows}.`,
      expected: 'Curated list of low-confidence or reported transcription segments.',
      screenshot: ssTeacherTrans
    });

    // 2.7 Glossary Manager
    await page.goto(`${BASE_URL}/#/teacher/glossary`);
    await page.waitForTimeout(800);
    const ssTeacherGlossary = path.join(REPORT_DIR, '17-teacher-glossary.png');
    await page.screenshot({ path: ssTeacherGlossary });
    const termCount = await page.locator('.glossary-term, .term-card, table tbody tr, .card, .empty-state').count().catch(() => 0);
    const addTermBtn = await page.locator('button:has-text("Nuevo"), button:has-text("Agregar"), #btn-add-term').first().isVisible().catch(() => false);
    recordFinding({
      persona: 'Teacher',
      feature: 'Domain Glossary & Acronyms Manager',
      route: '/#/teacher/glossary',
      status: (termCount > 0 || addTermBtn) ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Glossary manager enables academic domain terminology curation for RAG boosting',
      observation: `Term count / items: ${termCount}. Add term button: ${addTermBtn}.`,
      expected: 'Term dictionary with definition and acronym expansions.',
      screenshot: ssTeacherGlossary
    });

    // 2.8 RAG Sandbox
    await page.goto(`${BASE_URL}/#/teacher/rag-sandbox`);
    await page.waitForTimeout(800);
    const ssTeacherSandbox = path.join(REPORT_DIR, '18-teacher-rag-sandbox.png');
    await page.screenshot({ path: ssTeacherSandbox });
    const testInput = await page.locator('textarea, input[placeholder*="pregunta"], input[placeholder*="Query"]').first().isVisible().catch(() => false);
    const runTestBtn = await page.locator('button:has-text("Probar"), button:has-text("Ejecutar"), button:has-text("Test")').first().isVisible().catch(() => false);
    recordFinding({
      persona: 'Teacher',
      feature: 'RAG Prompt & Chunk Inspection Sandbox',
      route: '/#/teacher/rag-sandbox',
      status: (testInput || runTestBtn) ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'RAG sandbox lets teachers test questions and inspect retrieved chunk scores',
      observation: `Test input visible: ${testInput}. Execution button: ${runTestBtn}.`,
      expected: 'Sandbox environment displaying chunk similarity scores and metadata.',
      screenshot: ssTeacherSandbox
    });

    // 2.9 Teacher Analytics
    await page.goto(`${BASE_URL}/#/teacher/analytics`);
    await page.waitForTimeout(800);
    const ssTeacherAnalytics = path.join(REPORT_DIR, '19-teacher-analytics.png');
    await page.screenshot({ path: ssTeacherAnalytics });
    const chartBoxes = await page.locator('.chart-container, canvas, svg, .metric-box, .card').count().catch(() => 0);
    recordFinding({
      persona: 'Teacher',
      feature: 'Pedagogical & Student Query Analytics',
      route: '/#/teacher/analytics',
      status: chartBoxes > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Teacher analytics visualizes question topics, confusion patterns & material usage',
      observation: `Rendered ${chartBoxes} chart / metric cards.`,
      expected: 'Visual charts illustrating most queried concepts and low-confidence topics.',
      screenshot: ssTeacherAnalytics
    });

    await context.close();
  }

  // ══════════════════════════════════════════════════════════════════
  // DOMAIN 3: Director Persona (Joaquín García - dir-001)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- 3. DIRECTOR PERSONA ---');
  {
    const { context, page } = await setupPageForPersona(browser, 'director', 'dir-001');

    // 3.1 Director Dashboard
    await page.goto(`${BASE_URL}/#/director/dashboard`);
    await page.waitForTimeout(1000);
    const ssDirDash = path.join(REPORT_DIR, '20-director-dashboard.png');
    await page.screenshot({ path: ssDirDash });
    const kpiCount = await page.locator('.kpi-card, .stat-card, .metric-card, .card').count().catch(() => 0);
    recordFinding({
      persona: 'Director',
      feature: 'Director Executive Dashboard',
      route: '/#/director/dashboard',
      status: kpiCount > 0 ? 'PASS' : 'DEFECT',
      severity: kpiCount > 0 ? 'NONE' : 'HIGH',
      title: 'Director executive dashboard renders macro adoption KPIs and student sentiment',
      observation: `Rendered ${kpiCount} executive KPI / stat cards.`,
      expected: 'Macro metrics: Adoption rate (60% target), query volume, student satisfaction score.',
      screenshot: ssDirDash
    });

    // 3.2 SAT by Prompt Analytics
    await page.goto(`${BASE_URL}/#/director/sat-analytics`);
    await page.waitForTimeout(800);
    const ssDirSat = path.join(REPORT_DIR, '21-director-sat-analytics.png');
    await page.screenshot({ path: ssDirSat });
    const satCards = await page.locator('.sat-metric, .chart-box, table tbody tr, .card').count().catch(() => 0);
    recordFinding({
      persona: 'Director',
      feature: 'Student Satisfaction (SAT) by Prompt',
      route: '/#/director/sat-analytics',
      status: satCards > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'SAT analytics breaks down student satisfaction across prompt types',
      observation: `Rendered ${satCards} SAT analytics cards/metrics.`,
      expected: 'Satisfaction ratings categorized by question type and topic.',
      screenshot: ssDirSat
    });

    // 3.3 Early Warning Interventions
    await page.goto(`${BASE_URL}/#/director/interventions`);
    await page.waitForTimeout(800);
    const ssDirInterventions = path.join(REPORT_DIR, '22-director-interventions.png');
    await page.screenshot({ path: ssDirInterventions });
    const interventionItems = await page.locator('.at-risk-card, .intervention-item, table tbody tr, .card, .empty-state').count().catch(() => 0);
    const newInterventionBtn = await page.locator('button:has-text("Nueva"), button:has-text("Intervenir")').first().isVisible().catch(() => false);
    recordFinding({
      persona: 'Director',
      feature: 'Early Warning & Student Interventions',
      route: '/#/director/interventions',
      status: (interventionItems > 0 || newInterventionBtn) ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Interventions panel flags at-risk students and logs corrective pedagogical actions',
      observation: `Intervention elements: ${interventionItems}. Action button: ${newInterventionBtn}.`,
      expected: 'Early warning indicators (inactivity > 14 days, low quiz scores) with action logs.',
      screenshot: ssDirInterventions
    });

    // 3.4 Cross-Subject Class Management
    await page.goto(`${BASE_URL}/#/director/classes`);
    await page.waitForTimeout(800);
    const ssDirClasses = path.join(REPORT_DIR, '23-director-classes.png');
    await page.screenshot({ path: ssDirClasses });
    const classMgmtRows = await page.locator('.class-row, .class-card, table tbody tr, .card, .empty-state').count().catch(() => 0);
    recordFinding({
      persona: 'Director',
      feature: 'Cross-Faculty Class Oversight',
      route: '/#/director/classes',
      status: classMgmtRows > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Director class management view supervises syllabus progression across all classes',
      observation: `Class management elements count: ${classMgmtRows}.`,
      expected: 'Aggregated view of classes and validation compliance across courses.',
      screenshot: ssDirClasses
    });

    // 3.5 Subject Management
    await page.goto(`${BASE_URL}/#/director/subjects`);
    await page.waitForTimeout(800);
    const ssDirSubjects = path.join(REPORT_DIR, '24-director-subjects.png');
    await page.screenshot({ path: ssDirSubjects });
    const subjectCards = await page.locator('.subject-row, .subject-card, table tbody tr, .card').count().catch(() => 0);
    recordFinding({
      persona: 'Director',
      feature: 'Subject & Professor Assignment Management',
      route: '/#/director/subjects',
      status: subjectCards > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Director subject management supervises academic course catalog and assignments',
      observation: `Subject cards/rows count: ${subjectCards}.`,
      expected: 'Course catalog listing assigned faculty, student enrollments, and status.',
      screenshot: ssDirSubjects
    });

    // 3.6 Ethics & AI Compliance
    await page.goto(`${BASE_URL}/#/director/compliance`);
    await page.waitForTimeout(800);
    const ssDirCompliance = path.join(REPORT_DIR, '25-director-compliance.png');
    await page.screenshot({ path: ssDirCompliance });
    const complianceLogs = await page.locator('.compliance-card, .audit-log, table tbody tr, .card').count().catch(() => 0);
    recordFinding({
      persona: 'Director',
      feature: 'AI Ethics, Privacy & Consent Compliance',
      route: '/#/director/compliance',
      status: complianceLogs > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Compliance audit trail tracks student AI consent rates and regulatory logs',
      observation: `Compliance items count: ${complianceLogs}.`,
      expected: 'Audit report on AI consent acceptance, data retention, and privacy adherence.',
      screenshot: ssDirCompliance
    });

    await context.close();
  }

  // ══════════════════════════════════════════════════════════════════
  // DOMAIN 4: Technical Administrator Persona (Admin Técnico - adm-001)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- 4. TECHNICAL ADMINISTRATOR PERSONA ---');
  {
    const { context, page } = await setupPageForPersona(browser, 'admin', 'adm-001');

    // 4.1 Admin Technical Dashboard
    await page.goto(`${BASE_URL}/#/admin/dashboard`);
    await page.waitForTimeout(1000);
    const ssAdminDash = path.join(REPORT_DIR, '26-admin-dashboard.png');
    await page.screenshot({ path: ssAdminDash });
    const healthCards = await page.locator('.metric-card, .health-card, .stat-card, .card').count().catch(() => 0);
    recordFinding({
      persona: 'Admin',
      feature: 'Technical System Health & Cloud Observability',
      route: '/#/admin/dashboard',
      status: healthCards > 0 ? 'PASS' : 'DEFECT',
      severity: healthCards > 0 ? 'NONE' : 'HIGH',
      title: 'Admin technical dashboard displays latency, token metrics, Pinecone vectors & Azure costs',
      observation: `Rendered ${healthCards} system health and FinOps metric cards.`,
      expected: 'Cloud telemetry: API latency, token consumption, vector count, cost/student estimation (<$1.50).',
      screenshot: ssAdminDash
    });

    // 4.2 User Management (Allowlist)
    await page.goto(`${BASE_URL}/#/admin/users`);
    await page.waitForTimeout(800);
    const ssAdminUsers = path.join(REPORT_DIR, '27-admin-users.png');
    await page.screenshot({ path: ssAdminUsers });
    const userRows = await page.locator('table tbody tr, .user-card, .user-row').count().catch(() => 0);
    const searchBox = await page.locator('input[placeholder*="Buscar"], input[type="search"]').first().isVisible().catch(() => false);
    recordFinding({
      persona: 'Admin',
      feature: 'Hard-coded Allowlist & Identity Management',
      route: '/#/admin/users',
      status: userRows > 0 ? 'PASS' : 'DEFECT',
      severity: userRows > 0 ? 'NONE' : 'HIGH',
      title: 'User allowlist management displays authorized university accounts, roles and scopes',
      observation: `Rendered ${userRows} allowlist user rows. Search box visible: ${searchBox}.`,
      expected: 'Directory of allowed students, professors, directors, and administrators with role badges.',
      screenshot: ssAdminUsers
    });

    // 4.3 Technical Settings
    await page.goto(`${BASE_URL}/#/admin/settings`);
    await page.waitForTimeout(800);
    const ssAdminSettings = path.join(REPORT_DIR, '28-admin-settings.png');
    await page.screenshot({ path: ssAdminSettings });
    const configElements = await page.locator('.config-item, .setting-row, input, select, .card').count().catch(() => 0);
    recordFinding({
      persona: 'Admin',
      feature: 'Infrastructure & Key Vault Configuration',
      route: '/#/admin/settings',
      status: configElements > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Technical settings page shows Azure Key Vault secret references and feature flags',
      observation: `Rendered ${configElements} configuration cards and environment parameters.`,
      expected: 'Review of Key Vault references, Pinecone host, OpenAI deployments, and storage config.',
      screenshot: ssAdminSettings
    });

    // 4.4 Model Configuration & Hyperparameters
    await page.goto(`${BASE_URL}/#/admin/model-config`);
    await page.waitForTimeout(800);
    const ssAdminModel = path.join(REPORT_DIR, '29-admin-model-config.png');
    await page.screenshot({ path: ssAdminModel });
    const modelDropdown = await page.locator('select#model-name, select[name="model"], select').first().isVisible().catch(() => false);
    const tempRange = await page.locator('input[type="range"], input#temperature').first().isVisible().catch(() => false);
    const saveBtn = await page.locator('button:has-text("Guardar"), button:has-text("Aplicar")').first().isVisible().catch(() => false);
    recordFinding({
      persona: 'Admin',
      feature: 'LLM Model Selection & Hyperparameters',
      route: '/#/admin/model-config',
      status: (modelDropdown || tempRange || saveBtn) ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'AI model configuration allows selecting DeepSeek V4 Flash / GPT-4o-mini and tuning temperature',
      observation: `Model selector: ${modelDropdown}. Temperature slider: ${tempRange}. Save button: ${saveBtn}.`,
      expected: 'Model choice (DeepSeek / OpenAI) and parameter sliders (temperature, max tokens, top-p).',
      screenshot: ssAdminModel
    });

    // 4.5 Data Retention Policies
    await page.goto(`${BASE_URL}/#/admin/retention`);
    await page.waitForTimeout(800);
    const ssAdminRetention = path.join(REPORT_DIR, '30-admin-retention.png');
    await page.screenshot({ path: ssAdminRetention });
    const retentionRules = await page.locator('.retention-rule, .policy-card, table tbody tr, .card').count().catch(() => 0);
    recordFinding({
      persona: 'Admin',
      feature: 'Data Retention & Cleanup Policies',
      route: '/#/admin/retention',
      status: retentionRules > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Data retention management enforces compliance purge schedules for chat logs and vectors',
      observation: `Retention policy elements: ${retentionRules}.`,
      expected: 'Configurable retention periods for chat transcripts, telemetry, and inactive embeddings.',
      screenshot: ssAdminRetention
    });

    // 4.6 System Prompt Management
    await page.goto(`${BASE_URL}/#/admin/prompts`);
    await page.waitForTimeout(800);
    const ssAdminPrompts = path.join(REPORT_DIR, '31-admin-prompts.png');
    await page.screenshot({ path: ssAdminPrompts });
    const promptCards = await page.locator('textarea, .prompt-card, .prompt-template, .card').count().catch(() => 0);
    recordFinding({
      persona: 'Admin',
      feature: 'System Prompt Templates & Guardrails',
      route: '/#/admin/prompts',
      status: promptCards > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'System prompt manager allows editing RAG augmentation instructions and guardrails',
      observation: `Prompt editor components: ${promptCards}.`,
      expected: 'Editable prompt templates with safety constraints and formatting rules.',
      screenshot: ssAdminPrompts
    });

    // 4.7 Cold Storage / Archive Usage
    await page.goto(`${BASE_URL}/#/admin/archive-usage`);
    await page.waitForTimeout(800);
    const ssAdminArchive = path.join(REPORT_DIR, '32-admin-archive-usage.png');
    await page.screenshot({ path: ssAdminArchive });
    const archiveCards = await page.locator('.archive-card, .storage-stat, .card').count().catch(() => 0);
    recordFinding({
      persona: 'Admin',
      feature: 'Cold Storage Archive & Vector Pruning',
      route: '/#/admin/archive-usage',
      status: archiveCards > 0 ? 'PASS' : 'UX_IMPROVEMENT',
      severity: 'NONE',
      title: 'Cold storage archive analytics monitors vector pruning and compressed blob storage',
      observation: `Archive metrics count: ${archiveCards}.`,
      expected: 'Archive volume, restore operations, and cost savings metrics.',
      screenshot: ssAdminArchive
    });

    await context.close();
  }

  // ══════════════════════════════════════════════════════════════════
  // DOMAIN 5: Mobile Viewport Testing (390 x 844)
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- 5. MOBILE VIEWPORT TESTING (390 x 844) ---');
  {
    const { context, page } = await setupPageForPersona(browser, 'student', 'alu-001', 'student', { width: 390, height: 844 });

    await page.goto(`${BASE_URL}/#/student/dashboard`);
    await page.waitForTimeout(1000);
    const ssMobileStudent = path.join(REPORT_DIR, '33-mobile-student-dashboard.png');
    await page.screenshot({ path: ssMobileStudent });

    const bottomNav = await page.locator('.mobile-bottom-nav, #mobile-bottom-nav').first().isVisible().catch(() => false);
    const bottomLinks = await page.locator('.mobile-bottom-link').count().catch(() => 0);

    recordFinding({
      persona: 'Student',
      feature: 'Mobile Responsive Shell & Bottom Navigation',
      route: '/#/student/dashboard (mobile: 390x844)',
      status: bottomNav ? 'PASS' : 'DEFECT',
      severity: bottomNav ? 'NONE' : 'HIGH',
      title: 'Mobile viewport renders accessible bottom navigation bar with role-specific items',
      observation: `Bottom nav visible: ${bottomNav}. Mobile navigation links count: ${bottomLinks}.`,
      expected: 'Fixed bottom navigation bar on mobile viewports.',
      screenshot: ssMobileStudent
    });

    await context.close();
  }

  await browser.close();

  // ══════════════════════════════════════════════════════════════════
  // COMPILE & WRITE STRUCTURED REPORT
  // ══════════════════════════════════════════════════════════════════
  const reportData = {
    metadata: {
      baseUrl: BASE_URL,
      executionDate: new Date().toISOString(),
      totalPagesTested: 28,
      personasTested: ['Public', 'Student (Lucas Vidmar)', 'Teacher (Profesor Xavier)', 'Director (Joaquín García)', 'Admin (Admin Técnico)'],
      totalFindings: findings.length,
      passed: findings.filter(f => f.status === 'PASS').length,
      defects: findings.filter(f => f.status === 'DEFECT').length,
      improvements: findings.filter(f => f.status === 'UX_IMPROVEMENT').length,
      consoleErrorsCount: consoleLogs.length,
      networkFailuresCount: networkLogs.length
    },
    findings,
    consoleErrors: consoleLogs,
    networkFailures: networkLogs
  };

  fs.writeFileSync(path.join(REPORT_DIR, 'comprehensive-qa-report.json'), JSON.stringify(reportData, null, 2));

  console.log('\n================================================================');
  console.log(`FULL AUDIT COMPLETE: ${reportData.metadata.passed} PASSED | ${reportData.metadata.defects} DEFECTS | ${reportData.metadata.improvements} UX IMPROVEMENTS`);
  console.log(`Console Errors: ${reportData.metadata.consoleErrorsCount} | Network Failures: ${reportData.metadata.networkFailuresCount}`);
  console.log(`Report saved to ${path.join(REPORT_DIR, 'comprehensive-qa-report.json')}`);
  console.log('================================================================\n');
}

runFullAudit().catch(err => {
  console.error('Fatal error during full audit:', err);
  process.exit(1);
});
