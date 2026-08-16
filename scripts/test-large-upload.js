import fs from 'fs';
import path from 'path';

/**
 * ⚠️ HARNESS DE TEST (env=test) — Story 10.23 / QA-014
 * ------------------------------------------------
 * Script para testing manual de ingest-material con archivos grandes.
 * Usa la materia de TEST `dasi-1c2023` (no una materia piloto) y se bloquea si
 * el endpoint apunta al host del Function App del piloto/producción
 * (`func-dashboard-ingest-q47bia47kk3na.azurewebsites.net`).
 *
 * Run with: node scripts/test-large-upload.js
 * (solo contra un backend de DESARROLLO, p.ej. `func start` local).
 */

// Host del Function App del PILOTO/PRODUCCIÓN. Este harness jamás debe llegar ahí.
// Overridable via PILOT_FUNCTION_HOST para no romper el guard si el token cambia.
const PILOT_FUNCTION_HOST = process.env.PILOT_FUNCTION_HOST
    || 'func-dashboard-ingest-q47bia47kk3na.azurewebsites.net';

const API_ENDPOINT = 'http://localhost:7071/api/ingest-material';
const TEST_FILE_PATH = path.join(process.cwd(), 'tmp', 'test-20mb.txt');

// Subject de TEST (dasi-1c2023) — nunca `arq-software-2026` (piloto).
const TEST_SUBJECT_ID = 'dasi-1c2023';
const TEST_CLASS_IDS = 'class-01,class-02';

function assertTestTarget() {
  if (API_ENDPOINT.includes(PILOT_FUNCTION_HOST)) {
    if (process.env.ALLOW_TEST_UPLOAD_TO_PILOT === 'true') {
      console.warn('[WARN] ALLOW_TEST_UPLOAD_TO_PILOT=true — este harness va a ESCRIBIR datos de test en el entorno PILOTO.');
    } else {
      console.error('[FATAL] Este harness es SOLO para TEST y apunta al host del piloto/producción:');
      console.error(`        ${API_ENDPOINT}`);
      console.error('  → Configurá API_ENDPOINT a un backend de DESARROLLO, o');
      console.error('    → seteá ALLOW_TEST_UPLOAD_TO_PILOT=true SOLO si sabés lo que hacés (no recomendado).');
      process.exit(1);
    }
  }
}

async function runTest() {
    assertTestTarget();

    console.log('🚀 Starting Large Upload Test...');

    // 1. Create a 20MB dummy file if it doesn't exist
    if (!fs.existsSync(path.dirname(TEST_FILE_PATH))) {
        fs.mkdirSync(path.dirname(TEST_FILE_PATH), { recursive: true });
    }
    
    if (!fs.existsSync(TEST_FILE_PATH)) {
        console.log('📄 Creating 20MB dummy file...');
        const buffer = Buffer.alloc(20 * 1024 * 1024, 'X');
        fs.writeFileSync(TEST_FILE_PATH, buffer);
    }

    // 2. Prepare FormData
    const formData = new FormData();
    const blob = new Blob([fs.readFileSync(TEST_FILE_PATH)], { type: 'text/plain' });
    
    formData.append('file', blob, 'test-20mb.txt');
    formData.append('subjectId', TEST_SUBJECT_ID);
    formData.append('classIds', TEST_CLASS_IDS);
    formData.append('materialType', 'notes');

    // 3. Send Request
    console.log('📡 Sending request to backend...');
    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            body: formData,
        });

        console.log('📊 Status:', response.status);
        const data = await response.json();
        console.log('📦 Response Body:', JSON.stringify(data, null, 2));

        if (response.status === 202) {
            console.log('✅ TEST PASSED: 20MB upload accepted.');
        } else {
            console.log('❌ TEST FAILED: Unexpected status code.');
        }
    } catch (error) {
        console.error('❌ FATAL ERROR:', error.message);
        console.log('Note: Ensure the backend is running locally at http://localhost:7071');
    }
}

runTest();
