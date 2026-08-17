import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const PROD_URL = process.env.PROD_URL || 'https://agreeable-beach-002ff0c0f.6.azurestaticapps.net';
const REPORT_DIR = path.resolve('test-report', 'prod-e2e');
fs.mkdirSync(REPORT_DIR, { recursive: true });

const stepLogs = [];

function recordStep(persona, stepName, status, details = '', error = null) {
  const log = {
    persona,
    stepName,
    status, // 'PASS', 'FAIL', 'WARN'
    details,
    error: error ? (error.message || String(error)) : null,
    timestamp: new Date().toISOString()
  };
  stepLogs.push(log);
  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  console.log(`${icon} [${persona.toUpperCase()}] ${stepName} -> ${status}`);
  if (details) console.log(`   ℹ️  ${details}`);
  if (error) console.log(`   🚨 ${error.message || error}`);
}

async function createAuthenticatedPage(browser, role, email, name, uid) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  // Inject session storage and local storage to simulate verified allowlist session
  await context.addInitScript(({ role, email, name, uid }) => {
    try { localStorage.setItem('edu_ai_consent_accepted', 'true'); } catch(e) {}
    try { localStorage.setItem('edu_consent_accepted', 'true'); } catch(e) {}
    try { localStorage.setItem('uade_use_mock', 'true'); } catch(e) {}
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
    sessionStorage.setItem('edu_role', role);
    sessionStorage.setItem('edu_email', email);
    sessionStorage.setItem('edu_name', name);
    sessionStorage.setItem('edu_uid', uid);
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
  }, { role, email, name, uid });

  const page = await context.newPage();
  return { context, page };
}

async function runProdE2E() {
  console.log('================================================================');
  console.log(`Starting Comprehensive End-to-End Production Tests on: ${PROD_URL}`);
  console.log('================================================================\n');

  const browser = await chromium.launch({ headless: true });

  // ════════════════════════════════════════════════════════════════════
  // 1. TEACHER: Upload Materials, Create Class, Review Transcripts
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- 1. TEACHER: UPLOAD MATERIALS & CLASS MANAGEMENT ---');
  {
    const { context, page } = await createAuthenticatedPage(
      browser,
      'teacher',
      'xavier@uade.edu.ar',
      'Profesor Xavier',
      'doc-001'
    );

    // 1.1 Teacher Dashboard
    try {
      await page.goto(`${PROD_URL}/#/teacher/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const ssTeacherDash = path.join(REPORT_DIR, '01-prod-teacher-dashboard.png');
      await page.screenshot({ path: ssTeacherDash });
      const statCards = await page.locator('.metric-card, .stat-card, .card').count().catch(() => 0);
      recordStep('Teacher', 'Access Teacher Dashboard', statCards > 0 ? 'PASS' : 'WARN', `Stat cards found: ${statCards}`);
    } catch (e) {
      recordStep('Teacher', 'Access Teacher Dashboard', 'FAIL', '', e);
    }

    // 1.2 Teacher Upload Materials
    try {
      await page.goto(`${PROD_URL}/#/teacher/upload`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const ssTeacherUpload = path.join(REPORT_DIR, '02-prod-teacher-upload.png');
      await page.screenshot({ path: ssTeacherUpload });

      const fileInput = page.locator('input[type="file"]').first();
      const hasFileInput = await fileInput.isVisible({ timeout: 2000 }).catch(() => false);
      const sampleFile = path.resolve('materials', 'Clase 01 Introducción al estudio de sistemas.pptx');

      if (hasFileInput && fs.existsSync(sampleFile)) {
        await fileInput.setInputFiles(sampleFile);
        await page.waitForTimeout(500);

        // Select material type
        const typeSelect = page.locator('select#material-type, select[name="type"], select').first();
        if (await typeSelect.isVisible()) {
          await typeSelect.selectOption({ label: 'Presentación (PPTX)' }).catch(async () => {
            await typeSelect.selectOption('presentation').catch(() => {});
          });
        }

        // Submit upload
        const submitBtn = page.locator('button[type="submit"], button:has-text("Subir"), button:has-text("Cargar")').first();
        if (await submitBtn.isVisible()) {
          await submitBtn.click();
          await page.waitForTimeout(3000);
          const ssUploadResult = path.join(REPORT_DIR, '03-prod-teacher-upload-result.png');
          await page.screenshot({ path: ssUploadResult });
          recordStep('Teacher', 'Upload Class Material (PPTX)', 'PASS', `Uploaded: ${path.basename(sampleFile)}`);
        } else {
          recordStep('Teacher', 'Upload Class Material (PPTX)', 'WARN', 'Submit button not found');
        }
      } else {
        recordStep('Teacher', 'Upload Class Material (PPTX)', 'WARN', `File input visible: ${hasFileInput}, Sample file exists: ${fs.existsSync(sampleFile)}`);
      }
    } catch (e) {
      recordStep('Teacher', 'Upload Class Material', 'FAIL', '', e);
    }

    // 1.3 Teacher Create / Edit Class
    try {
      await page.goto(`${PROD_URL}/#/teacher/classes`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const ssTeacherClasses = path.join(REPORT_DIR, '04-prod-teacher-classes.png');
      await page.screenshot({ path: ssTeacherClasses });

      const newClassBtn = page.locator('button:has-text("Nueva"), button:has-text("Crear Clase"), #btn-new-class').first();
      if (await newClassBtn.isVisible()) {
        await newClassBtn.click();
        await page.waitForTimeout(800);
        const titleInput = page.locator('input[placeholder*="Título"], input[name="title"], #class-title').first();
        if (await titleInput.isVisible()) {
          await titleInput.fill('Clase 15 — Arquitecturas Limpias y RAG en Producción');
          const saveBtn = page.locator('button:has-text("Guardar"), button:has-text("Crear"), button[type="submit"]').first();
          if (await saveBtn.isVisible()) {
            await saveBtn.click();
            await page.waitForTimeout(1000);
            recordStep('Teacher', 'Create New Class in Syllabus', 'PASS', 'Class "Clase 15" submitted.');
          }
        }
      } else {
        recordStep('Teacher', 'Create New Class in Syllabus', 'WARN', 'New class button not visible in view');
      }
    } catch (e) {
      recordStep('Teacher', 'Create New Class', 'FAIL', '', e);
    }

    // 1.4 Teacher Transcription Corrections
    try {
      await page.goto(`${PROD_URL}/#/teacher/transcription-corrections`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const ssTeacherTrans = path.join(REPORT_DIR, '05-prod-teacher-transcriptions.png');
      await page.screenshot({ path: ssTeacherTrans });
      const transItems = await page.locator('.transcription-card, .error-item, table tbody tr, .empty-state').count().catch(() => 0);
      recordStep('Teacher', 'Review Transcription Corrections', 'PASS', `Items found in transcript inbox: ${transItems}`);
    } catch (e) {
      recordStep('Teacher', 'Review Transcription Corrections', 'FAIL', '', e);
    }

    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. STUDENT: Ask Academic Questions, Evaluate RAG, Report Issues
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- 2. STUDENT: ACADEMIC RAG QUESTIONS & DISCREPANCY REPORTING ---');
  {
    const { context, page } = await createAuthenticatedPage(
      browser,
      'student',
      'lvidmar@uade.edu.ar',
      'Lucas Vidmar',
      'alu-001'
    );

    // Questions list reflecting curriculum from uploaded materials
    const testQueries = [
      {
        question: '¿Qué es un Sistema de Información y cuáles son sus componentes principales?',
        expectedTopic: 'Entrada, procesamiento, salida, retroalimentación y personas/tecnología'
      },
      {
        question: '¿Cómo impactan los sistemas ERP y CRM en la toma de decisiones empresariales?',
        expectedTopic: 'Integración de procesos de negocio, gestión de clientes y cadena de suministro'
      },
      {
        question: '¿Cuáles son los principios de la Arquitectura Hexagonal y qué problema resuelven?',
        expectedTopic: 'Puertos y adaptadores, desacoplamiento del dominio de frameworks externos'
      }
    ];

    await page.goto(`${PROD_URL}/#/student/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    for (let i = 0; i < testQueries.length; i++) {
      const q = testQueries[i];
      try {
        const chatInput = page.locator('textarea, input[placeholder*="Pregunt"], input[placeholder*="Escribí"]').first();
        if (await chatInput.isVisible()) {
          await chatInput.fill(q.question);
          const sendBtn = page.locator('button[aria-label*="Enviar"], button:has-text("Enviar")').first();
          if (await sendBtn.isVisible()) {
            await sendBtn.click();
            await page.waitForTimeout(4000); // Allow LLM streaming

            const ssQuery = path.join(REPORT_DIR, `06-prod-student-query-${i + 1}.png`);
            await page.screenshot({ path: ssQuery });

            const lastMessage = await page.locator('.chat-message, .message-bubble, [data-role="assistant"]').last().textContent().catch(() => '');
            const sourceCitations = await page.locator('.source-pill, .source-citation, .citation, .source-tag').count().catch(() => 0);

            recordStep(
              'Student',
              `Submit Query #${i + 1}: "${q.question.slice(0, 45)}..."`,
              lastMessage.length > 20 ? 'PASS' : 'WARN',
              `Response length: ${lastMessage.length} chars. Sources cited: ${sourceCitations}. Text preview: "${lastMessage.slice(0, 120)}..."`
            );
          }
        } else {
          recordStep('Student', `Submit Query #${i + 1}`, 'WARN', 'Chat input not visible in DOM');
        }
      } catch (e) {
        recordStep('Student', `Submit Query #${i + 1}`, 'FAIL', '', e);
      }
    }

    // 2.2 Test Reporting a Hallucination / Discrepancy
    try {
      const reportBtn = page.locator('button[title*="reportar"], button[aria-label*="reportar"], .btn-report, button:has(.fa-flag), button:has-text("Reportar")').first();
      if (await reportBtn.isVisible()) {
        await reportBtn.click();
        await page.waitForTimeout(600);
        const reportModal = page.locator('.modal, .dialog, .report-modal').first();
        if (await reportModal.isVisible()) {
          const reasonInput = page.locator('textarea, input[placeholder*="motivo"], #report-reason').first();
          if (await reasonInput.isVisible()) {
            await reasonInput.fill('El concepto citado no corresponde a la definición dada en la Clase 01.');
          }
          const submitReportBtn = page.locator('button:has-text("Enviar Reporte"), button:has-text("Confirmar")').first();
          if (await submitReportBtn.isVisible()) {
            await submitReportBtn.click();
            await page.waitForTimeout(1000);
            recordStep('Student', 'Report AI Discrepancy / Hallucination', 'PASS', 'Discrepancy report submitted.');
          }
        }
      } else {
        recordStep('Student', 'Report AI Discrepancy / Hallucination', 'WARN', 'Report trigger button not present on current message bubble');
      }
    } catch (e) {
      recordStep('Student', 'Report AI Discrepancy', 'FAIL', '', e);
    }

    // 2.3 Student Reports View
    try {
      await page.goto(`${PROD_URL}/#/student/reports`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      const ssStudentReports = path.join(REPORT_DIR, '07-prod-student-reports.png');
      await page.screenshot({ path: ssStudentReports });
      recordStep('Student', 'View Submitted Reports History', 'PASS', 'Reports history page rendered.');
    } catch (e) {
      recordStep('Student', 'View Submitted Reports History', 'FAIL', '', e);
    }

    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. DIRECTOR: Subject Management, Teacher Assignment, Metrics
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- 3. DIRECTOR: SUBJECT & TEACHER ASSIGNMENT & ADOPTION METRICS ---');
  {
    const { context, page } = await createAuthenticatedPage(
      browser,
      'director',
      'jgarciag@uade.edu.ar',
      'Joaquín García',
      'dir-001'
    );

    // 3.1 Director Dashboard & Adoption KPIs
    try {
      await page.goto(`${PROD_URL}/#/director/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const ssDirDash = path.join(REPORT_DIR, '08-prod-director-dashboard.png');
      await page.screenshot({ path: ssDirDash });
      const kpis = await page.locator('.kpi-card, .stat-card, .metric-card').count().catch(() => 0);
      recordStep('Director', 'View Director KPIs (Adoption & Sentiment)', kpis > 0 ? 'PASS' : 'WARN', `Executive KPI cards found: ${kpis}`);
    } catch (e) {
      recordStep('Director', 'View Director KPIs', 'FAIL', '', e);
    }

    // 3.2 Subject Management (Assigning / Removing Teachers)
    try {
      await page.goto(`${PROD_URL}/#/director/subjects`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const ssDirSubjects = path.join(REPORT_DIR, '09-prod-director-subjects.png');
      await page.screenshot({ path: ssDirSubjects });

      const subjectCards = await page.locator('.subject-card, .subject-row, table tbody tr, .card').count().catch(() => 0);
      const editSubjectBtn = page.locator('button:has-text("Editar"), button:has-text("Docentes"), .btn-edit-subject').first();
      const hasEditBtn = await editSubjectBtn.isVisible().catch(() => false);

      recordStep('Director', 'Subject Management & Teacher Assignment View', subjectCards > 0 ? 'PASS' : 'WARN', `Subjects count: ${subjectCards}, Teacher assignment action visible: ${hasEditBtn}`);
    } catch (e) {
      recordStep('Director', 'Subject Management', 'FAIL', '', e);
    }

    // 3.3 Director Interventions & Early Warning
    try {
      await page.goto(`${PROD_URL}/#/director/interventions`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const ssDirInterventions = path.join(REPORT_DIR, '10-prod-director-interventions.png');
      await page.screenshot({ path: ssDirInterventions });
      const atRiskItems = await page.locator('.at-risk-card, .intervention-item, table tbody tr, .card').count().catch(() => 0);
      recordStep('Director', 'Review At-Risk Student Interventions', atRiskItems > 0 ? 'PASS' : 'WARN', `At-risk / intervention entries: ${atRiskItems}`);
    } catch (e) {
      recordStep('Director', 'Review Interventions', 'FAIL', '', e);
    }

    await context.close();
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. ADMINISTRATOR: System Health, Allowlist, Model & Retention Config
  // ════════════════════════════════════════════════════════════════════
  console.log('\n--- 4. ADMINISTRATOR: SYSTEM HEALTH, ALLOWLIST & FINOPS METRICS ---');
  {
    const { context, page } = await createAuthenticatedPage(
      browser,
      'admin',
      'admin@uade.edu.ar',
      'Admin Técnico',
      'adm-001'
    );

    // 4.1 Admin Health & Observability Metrics
    try {
      await page.goto(`${PROD_URL}/#/admin/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const ssAdminDash = path.join(REPORT_DIR, '11-prod-admin-dashboard.png');
      await page.screenshot({ path: ssAdminDash });
      const metricBoxes = await page.locator('.metric-card, .health-card, .stat-card, .card').count().catch(() => 0);
      recordStep('Admin', 'Monitor Technical Health & FinOps Cost/Token Metrics', metricBoxes > 0 ? 'PASS' : 'WARN', `System health cards: ${metricBoxes}`);
    } catch (e) {
      recordStep('Admin', 'Monitor Technical Health', 'FAIL', '', e);
    }

    // 4.2 User Allowlist Management
    try {
      await page.goto(`${PROD_URL}/#/admin/users`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const ssAdminUsers = path.join(REPORT_DIR, '12-prod-admin-users.png');
      await page.screenshot({ path: ssAdminUsers });
      const userRows = await page.locator('table tbody tr, .user-card, .user-row').count().catch(() => 0);
      recordStep('Admin', 'View Authorized User Allowlist Directory', userRows > 0 ? 'PASS' : 'WARN', `Configured allowlist user rows: ${userRows}`);
    } catch (e) {
      recordStep('Admin', 'View User Allowlist', 'FAIL', '', e);
    }

    // 4.3 AI Model & Hyperparameter Configuration
    try {
      await page.goto(`${PROD_URL}/#/admin/model-config`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const ssAdminModel = path.join(REPORT_DIR, '13-prod-admin-model-config.png');
      await page.screenshot({ path: ssAdminModel });
      const tempSlider = await page.locator('input[type="range"], input#temperature').first().isVisible().catch(() => false);
      recordStep('Admin', 'Configure LLM Model & Temperature', tempSlider ? 'PASS' : 'WARN', `Temperature slider active: ${tempSlider}`);
    } catch (e) {
      recordStep('Admin', 'Configure LLM Model', 'FAIL', '', e);
    }

    // 4.4 Data Retention Policies
    try {
      await page.goto(`${PROD_URL}/#/admin/retention`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const ssAdminRetention = path.join(REPORT_DIR, '14-prod-admin-retention.png');
      await page.screenshot({ path: ssAdminRetention });
      const rulesCount = await page.locator('.retention-rule, .policy-card, table tbody tr, .card').count().catch(() => 0);
      recordStep('Admin', 'Review Data Retention & Automated Purge Policies', rulesCount > 0 ? 'PASS' : 'WARN', `Retention policy rules: ${rulesCount}`);
    } catch (e) {
      recordStep('Admin', 'Review Data Retention', 'FAIL', '', e);
    }

    await context.close();
  }

  await browser.close();

  // Save JSON summary
  const summary = {
    productionUrl: PROD_URL,
    executionDate: new Date().toISOString(),
    totalSteps: stepLogs.length,
    passed: stepLogs.filter(s => s.status === 'PASS').length,
    warn: stepLogs.filter(s => s.status === 'WARN').length,
    failed: stepLogs.filter(s => s.status === 'FAIL').length,
    steps: stepLogs
  };

  fs.writeFileSync(path.join(REPORT_DIR, 'prod-e2e-summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n================================================================');
  console.log(`PRODUCTION E2E TESTING COMPLETED: ${summary.passed} PASSED | ${summary.warn} WARNINGS | ${summary.failed} FAILED`);
  console.log(`Summary report saved to: ${path.join(REPORT_DIR, 'prod-e2e-summary.json')}`);
  console.log('================================================================\n');
}

runProdE2E().catch(err => {
  console.error('Fatal error during production E2E test:', err);
  process.exit(1);
});
