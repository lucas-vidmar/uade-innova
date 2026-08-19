import fs from 'fs';
import path from 'path';
import { parseFile } from '../backend/src/services/parser.js';

/**
 * Script for verifying PDF parsing on local materials.
 * Run with: node scripts/verify-pdf-parsing.js
 */

const TEST_FILE_PATH = path.join(process.cwd(), 'materials', 'bibliography', 'ld-Sistemas_de_informacion_gerencial_14 edicion.pdf');

async function runVerification() {
    console.log('📄 Starting PDF Verification Test...');
    
    if (!fs.existsSync(TEST_FILE_PATH)) {
        console.error(`❌ Test file not found: ${TEST_FILE_PATH}`);
        process.exit(1);
    }

    const buffer = fs.readFileSync(TEST_FILE_PATH);
    const mimeType = 'application/pdf';
    
    console.log(`📂 Processing: ${path.basename(TEST_FILE_PATH)} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
    
    try {
        const startTime = Date.now();
        const extractedText = await parseFile(buffer, mimeType, path.basename(TEST_FILE_PATH));
        const duration = Date.now() - startTime;

        console.log(`⏱️ Extraction completed in ${duration}ms`);
        console.log(`📊 Extracted characters: ${extractedText.length}`);
        
        // Find page markers [Página X]
        const pageMarkers = extractedText.match(/\[Página \d+\]/g) || [];
        console.log(`🔢 Page markers found: ${pageMarkers.length}`);
        
        if (pageMarkers.length > 0) {
            console.log(`✅ Success: Page markers detected (e.g., ${pageMarkers.slice(0, 3).join(', ')}...)`);
        } else {
            console.error('❌ Error: No page markers found in the extracted text.');
        }

        // Print first 500 chars to verify quality
        console.log('\n--- Text Sample (First 500 chars) ---');
        console.log(extractedText.substring(0, 500));
        console.log('------------------------------------\n');

        if (pageMarkers.length >= 50) {
            console.log('🏆 Requirement met: Successfully processed a document with 50+ pages.');
        }

    } catch (error) {
        console.error('❌ FATAL ERROR during extraction:', error.message);
    }
}

runVerification();
