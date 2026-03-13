import fs from 'fs';
import path from 'path';

/**
 * Script for manual testing of ingest-material with large files.
 * Run with: node scripts/test-large-upload.js
 */

const API_ENDPOINT = 'http://localhost:7071/api/ingest-material';
const TEST_FILE_PATH = path.join(process.cwd(), 'tmp', 'test-20mb.txt');

async function runTest() {
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
    const fileStream = fs.createReadStream(TEST_FILE_PATH);
    const blob = new Blob([fs.readFileSync(TEST_FILE_PATH)], { type: 'text/plain' });
    
    formData.append('file', blob, 'test-20mb.txt');
    formData.append('subjectId', 'arq-software-2026');
    formData.append('classIds', 'class-01,class-02');
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
