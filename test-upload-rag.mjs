import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { Blob } from 'buffer';

const FRONTEND_URL = 'http://localhost:5173';
const API_BASE = 'https://func-dashboard-ingest-q47bia47kk3na.azurewebsites.net/api';
const MATERIALS_DIR = '/Users/lucasvidmar/Documents/azure-educational-dashboard/materials';

const SUBJECT_ID = 'dasi-1c2023';
const SUBJECT_NAME = 'DASI - Análisis de Sistemas e Información Gerencial';
const CLASSES = [
  { id: 'class-01', subjectId: SUBJECT_ID, title: 'Clase 01 — Introducción al estudio de sistemas', date: '2023-03-16', topics: ['Introducción', 'Sistemas'], materials: [], summaryReady: false },
  { id: 'class-02', subjectId: SUBJECT_ID, title: 'Clase 02 — SI y Procesos de Negocio (U2a)', date: '2023-03-23', topics: ['Sistemas de Información', 'Procesos de Negocio'], materials: [], summaryReady: false },
  { id: 'class-03', subjectId: SUBJECT_ID, title: 'Clase 03 — SI y Procesos de Negocio (U2b)', date: '2023-03-30', topics: ['SI', 'Procesos'], materials: [], summaryReady: false },
  { id: 'class-04', subjectId: SUBJECT_ID, title: 'Clase 04 — Infraestructura de TI (Hardware)', date: '2023-04-06', topics: ['Hardware', 'Infraestructura TI'], materials: [], summaryReady: false },
  { id: 'class-05', subjectId: SUBJECT_ID, title: 'Clase 05-06 — Infraestructura de TI (Software, BD, Telec)', date: '2023-04-13', topics: ['Software', 'Bases de Datos', 'Telecomunicaciones'], materials: [], summaryReady: false },
  { id: 'class-08', subjectId: SUBJECT_ID, title: 'Clase 08 — Adquisición y Desarrollo de SI', date: '2023-04-27', topics: ['Adquisición', 'Desarrollo SI'], materials: [], summaryReady: false },
  { id: 'class-09', subjectId: SUBJECT_ID, title: 'Clase 09 — Aplicaciones empresariales ERP-SCM', date: '2023-05-04', topics: ['ERP', 'SCM'], materials: [], summaryReady: false },
  { id: 'class-10', subjectId: SUBJECT_ID, title: 'Clase 10 — Aplicaciones empresariales CRM-DSS', date: '2023-05-11', topics: ['CRM', 'DSS'], materials: [], summaryReady: false },
  { id: 'class-12', subjectId: SUBJECT_ID, title: 'Clase 12 — Estrategia de SI', date: '2023-05-25', topics: ['Estrategia SI'], materials: [], summaryReady: false },
  { id: 'class-13', subjectId: SUBJECT_ID, title: 'Clase 13 — Seguridad en los SI', date: '2023-06-01', topics: ['Seguridad', 'Ciberseguridad'], materials: [], summaryReady: false },
  { id: 'class-14', subjectId: SUBJECT_ID, title: 'Clase 14 — Ética y Responsabilidad Social en los SI', date: '2023-06-08', topics: ['Ética', 'Responsabilidad Social'], materials: [], summaryReady: false },
];

const FILE_TO_CLASS = {
  'Clase 01 Introducción al estudio de sistemas.pptx': { classId: 'class-01', type: 'presentation' },
  'Clase 02 - U2a - Sistemas de Información y Procesos de Negocio-2020.pptx': { classId: 'class-02', type: 'presentation' },
  'Clase 03 - U2b - Sistemas de Información y Procesos de Negocio-convertido.pptx': { classId: 'class-03', type: 'presentation' },
  'Clase 04 - U3a - Infraestructura de TI (Hardware) vfinal.pptx': { classId: 'class-04', type: 'presentation' },
  'Clase 05_06 - U3b - Infraestructura de TI (Software) Soft_BD_Telec.pptx': { classId: 'class-05', type: 'presentation' },
  'Clase 08 - U5 - Adquisición y Desarrollo de SI_2020.pptx': { classId: 'class-08', type: 'presentation' },
  'Clase 08 - U5 - Adquisición y Desarrollo de SI-FINAL.pptx': { classId: 'class-08', type: 'presentation' },
  'Clase 09 - U4a - Aplicaciones empresariales de los SI (ERP-SCM)FINAL.pptx': { classId: 'class-09', type: 'presentation' },
  'Clase 10 - U4b - Aplicaciones empresariales de los SI (CRM-DSS)FINAL.pptx': { classId: 'class-10', type: 'presentation' },
  'Clase 12 - U7 - Estrategia de Sistemas de Información2020.pptx': { classId: 'class-12', type: 'presentation' },
  'Clase 13 - U6 - Seguridad en los Sistemas de Información2020NVO.pptx': { classId: 'class-13', type: 'presentation' },
  'Clase 14 - U8 - Ética y Responsabilidad Social en los SI2020.pptx': { classId: 'class-14', type: 'presentation' },
  'ld-Sistemas_de_informacion_gerencial_14 edicion.pdf': { classId: 'class-01', type: 'bibliography' },
  'La_informacion_vale_Ciberseguridad_Presentacion_Luis_Lubeck.pdf': { classId: 'class-13', type: 'bibliography' },
  'TRABAJO PRÁCTICO FINAL DASI2023.docx': { classId: 'class-01', type: 'notes' },
  'DASI Cronograma dia Jueves_1C2023_ejemplo.docx': { classId: 'class-01', type: 'notes' },
};

function mockHeaders() {
  return {
    'x-mock-role': 'director',
    'x-edu-uid': 'dir-001',
  };
}

async function api(method, pathname, body) {
  const url = `${API_BASE}${pathname}?_mock_role=director&_mock_uid=dir-001`;
  const opts = { method, headers: mockHeaders() };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

async function uploadFile(filePath, classId, materialType) {
  const filename = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });

  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('subjectId', SUBJECT_ID);
  formData.append('materialType', materialType);
  formData.append('classIds', classId);

  const url = `${API_BASE}/ingest-material?_mock_role=director&_mock_uid=dir-001`;
  const res = await fetch(url, {
    method: 'POST',
    headers: mockHeaders(),
    body: formData,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  fs.mkdirSync('test-report', { recursive: true });

  console.log('═══════════════════════════════════════════════════');
  console.log('  PHASE 1: Setup subject, classes & enrollments');
  console.log('═══════════════════════════════════════════════════\n');

  // 1. Create subject
  console.log('📚 Creating subject...');
  let subRes = await api('POST', '/subjects', { id: SUBJECT_ID, name: SUBJECT_NAME, group: 'todos' });
  console.log(`   POST /subjects → ${subRes.status}: ${subRes.ok ? '✅' : '⚠️'} ${JSON.stringify(subRes.data)}`);
  if (!subRes.ok && subRes.status !== 409) {
    console.error('   FATAL: Could not create subject'); process.exit(1);
  }

  // 2. Create classes
  console.log('\n📖 Saving classes...');
  const clsRes = await api('PUT', `/classes/${SUBJECT_ID}`, CLASSES);
  console.log(`   PUT /classes/${SUBJECT_ID} → ${clsRes.status}: ${clsRes.ok ? '✅' : '❌'}`);
  if (!clsRes.ok) console.log(`   Error: ${JSON.stringify(clsRes.data).slice(0, 200)}`);

  // Verify classes
  const getRes = await api('GET', `/classes/${SUBJECT_ID}`);
  console.log(`   GET /classes/${SUBJECT_ID} → ${getRes.status}: ${getRes.ok ? '✅' : '❌'} ${getRes.ok ? `${getRes.data?.length || 0} classes` : ''}`);

  // 3. Create enrollments
  console.log('\n👥 Creating enrollments...');
  const enrollments = [
    { subjectId: SUBJECT_ID, userId: 'alu-001', role: 'student', status: 'active' },
    { subjectId: SUBJECT_ID, userId: 'doc-001', role: 'teacher', status: 'active' },
    { subjectId: SUBJECT_ID, userId: 'dir-001', role: 'teacher', status: 'active' },
  ];
  for (const e of enrollments) {
    const enrRes = await api('POST', '/enrollments', e);
    console.log(`   ${e.userId} (${e.role}) → ${enrRes.status}: ${enrRes.ok ? '✅' : '⚠️'}`);
  }

  // 4. Upload materials
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  PHASE 2: Uploading materials');
  console.log('═══════════════════════════════════════════════════\n');

  const materialFiles = fs.readdirSync(MATERIALS_DIR)
    .filter(f => FILE_TO_CLASS[f])
    .map(f => ({ filepath: path.join(MATERIALS_DIR, f), ...FILE_TO_CLASS[f] }));

  let uploaded = 0, failed = 0;
  for (const mf of materialFiles) {
    const fn = path.basename(mf.filepath);
    process.stdout.write(`   ${fn} → ${mf.classId} (${mf.type})... `);
    try {
      const res = await uploadFile(mf.filepath, mf.classId, mf.type);
      if (res.ok) {
        console.log(`✅ ${res.data?.materialId?.slice(0, 8) || 'OK'}`);
        uploaded++;
      } else {
        console.log(`❌ ${res.status}: ${JSON.stringify(res.data).slice(0, 120)}`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
      failed++;
    }
    await sleep(300);
  }
  console.log(`\n   ✅ Uploaded: ${uploaded}  ❌ Failed: ${failed}  Total: ${materialFiles.length}`);

  // 5. Wait for processing
  console.log('\n⏳ Waiting 60s for AI pipeline processing...');
  for (let i = 0; i < 6; i++) {
    await sleep(10000);
    process.stdout.write(`   ${(i + 1) * 10}s elapsed...\n`);
  }

  // 6. Open browser and test query
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  PHASE 3: Testing RAG query via Playwright');
  console.log('═══════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  await context.addInitScript(() => {
    try {
      localStorage.setItem('edu_ai_consent_accepted', 'true');
      localStorage.setItem('edu_consent_accepted', 'true');
      localStorage.setItem('uade_use_mock', 'false');
      localStorage.setItem('onboarding-student-completed', 'true');
      localStorage.setItem('onboarding-teacher-completed', 'true');
      localStorage.setItem('onboarding-director-completed', 'true');
      localStorage.setItem('edu_active_subject', 'dasi-1c2023');
    } catch (e) {}
    try {
      sessionStorage.setItem('edu_ai_consent_accepted', 'true');
      sessionStorage.setItem('edu_consent_accepted', 'true');
      sessionStorage.setItem('edu_role', 'student');
      sessionStorage.setItem('edu_uid', 'alu-001');
      sessionStorage.setItem('edu_logged_in', 'true');
      sessionStorage.setItem('edu_active_subject', 'dasi-1c2023');
    } catch (e) {}
  });

  const page = await context.newPage();

  // Intercept all API calls to add mock auth
  await page.route('**/func-dashboard-ingest-q47bia47kk3na.azurewebsites.net/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    // Preserve existing _mock_role and _mock_uid, or add default
    if (!url.searchParams.has('_mock_role')) url.searchParams.set('_mock_role', 'student');
    if (!url.searchParams.has('_mock_uid')) url.searchParams.set('_mock_uid', 'alu-001');

    const headers = await route.request().allHeaders();
    headers['x-mock-role'] = headers['x-mock-role'] || 'student';
    headers['x-edu-uid'] = headers['x-edu-uid'] || 'alu-001';

    try {
      if (method === 'GET') {
        await route.continue({ url: url.toString(), headers });
      } else {
        const postData = route.request().postData();
        await route.continue({ url: url.toString(), headers, postData: postData || undefined });
      }
    } catch {
      await route.continue();
    }
  });

  console.log('🌐 Opening student dashboard...');
  await page.goto(`${FRONTEND_URL}/#/student/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(5000);
  await page.screenshot({ path: 'test-report/01-dashboard.png', fullPage: false });
  console.log('📸 Screenshot 1: Dashboard loaded');

  // Check what's on screen
  const pageText = await page.locator('#page-content').innerText().catch(() => '');
  console.log(`   Page content: ${pageText.slice(0, 200).replace(/\n/g, ' ')}`);

  // Select class 13 (Seguridad informática) via source-pill chip
  console.log('\n📋 Selecting class 13 for the chat...');
  const class13Chip = page.locator('button.source-pill[data-class-id="class-13"]');
  for (let i = 0; i < 20; i++) {
    if (await class13Chip.count() > 0) break;
    await sleep(1000);
  }
  if (await class13Chip.count() > 0) {
    await class13Chip.first().click();
    console.log('   ✅ Class 13 selected (source-pill clicked)');
  } else {
    await page.screenshot({ path: 'test-report/01b-no-source-pill.png', fullPage: false });
    const chips = await page.locator('.source-pill').count();
    console.log(`   Found ${chips} source-pill buttons total`);
  }
  await sleep(1000);

  // Find chat input
  console.log('💬 Looking for chat input...');
  let chatInput = page.locator('#chat-input');
  await chatInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  const enabled = await chatInput.isEnabled().catch(() => false);
  if (enabled) console.log('   ✅ Chat input is now enabled');
  else console.log('   ⚠️ Chat input still disabled, trying forcing...');

  if (enabled) {
    const q = '¿Qué temas de seguridad informática se vieron en las clases?';
    console.log(`   Asking: "${q}"`);

    await chatInput.fill(q);
    await sleep(500);

    const sendBtn = page.locator('#chat-send, button[type="submit"], .chat-send-btn').first();
    if (await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sendBtn.click();
    } else {
      await chatInput.press('Enter');
    }

    console.log('   ⏳ Waiting for AI response (up to 120s)...');
    await sleep(30000);
    await page.screenshot({ path: 'test-report/02-response-started.png', fullPage: false });
    await sleep(30000);
    await page.screenshot({ path: 'test-report/03-response-midway.png', fullPage: false });
    await sleep(30000);
    await page.screenshot({ path: 'test-report/04-response-progress.png', fullPage: false });
    await sleep(30000);
    await page.screenshot({ path: 'test-report/05-response-final.png', fullPage: false });

    const responseText = await page.evaluate(() => {
      const selectors = ['.chat-bubble-assistant', '.assistant-message', '.message-assistant', '[data-role="assistant"]'];
      for (const sel of selectors) {
        const el = document.querySelectorAll(sel);
        if (el.length > 0) return el[el.length - 1].textContent?.slice(0, 1000) || '';
      }
      return '';
    });

    if (responseText) {
      console.log(`\n📝 AI Response:\n${responseText}\n`);
    } else {
      console.log('   ⚠️ No assistant response text found.');
      const widgetText = await page.locator('#chat-widget-mount').innerText().catch(() => '');
      if (widgetText) console.log(`   Widget text: ${widgetText.slice(0, 500)}`);
    }
  } else {
    console.log('   ❌ Chat input not enabled after class selection.');
    await page.screenshot({ path: 'test-report/99-chat-disabled.png', fullPage: true });
    
    // Try a different approach - navigate as teacher
    console.log('\n🔄 Trying teacher view...');
    await page.evaluate(() => { sessionStorage.setItem('edu_role', 'teacher'); sessionStorage.setItem('edu_uid', 'doc-001'); });
    await page.goto(`${FRONTEND_URL}/#/teacher/classes`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(3000);
    await page.screenshot({ path: 'test-report/04-teacher-classes.png', fullPage: false });
    const tcText = await page.locator('#page-content').innerText().catch(() => '');
    console.log(`   Teacher classes: ${tcText.slice(0, 200).replace(/\n/g, ' ')}`);
  }

  await sleep(3000);
  await browser.close();
  console.log('\n✅ Done! Check test-report/ for screenshots.');
}

main().catch(err => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
