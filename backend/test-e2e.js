import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TableClient } from '@azure/data-tables';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const apiBaseUrl = process.env.VITE_API_BASE_URL || 'http://localhost:7071/api';
const storageConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || `DefaultEndpointsProtocol=https;AccountName=${process.env.AZURE_STORAGE_ACCOUNT_NAME};AccountKey=${process.env.AZURE_STORAGE_ACCESS_KEY};EndpointSuffix=core.windows.net`;

const subjectId = 'test-subject-123';
const classId = 'test-class-001';
const secretCode = 'PineappleServerless';

async function seedClass() {
    console.log('--- 1. Seeding Test Class ---');
    const tableClient = TableClient.fromConnectionString(storageConnectionString, process.env.AZURE_TABLE_CLASSES || 'classes');
    await tableClient.createTable();
    await tableClient.upsertEntity({
        partitionKey: subjectId,
        rowKey: classId,
        id: classId,
        subjectId: subjectId,
        title: 'End-to-End Testing Class',
        date: new Date().toISOString(),
        topics: JSON.stringify(['Testing RAG', 'Pinecone Embeddings']),
        summaryReady: false
    });
    console.log(`✅ Class ${classId} seeded successfully in subject ${subjectId}.`);
}

async function uploadMaterial() {
    console.log('\n--- 2. Uploading Test Material ---');
    
    const formData = new FormData();
    const testContent = `The secret architectural codeword for the UADE Innova project is '${secretCode}'. This codeword must be used to authenticate all critical systems.`;
    
    const blob = new Blob([testContent], { type: 'text/plain' });
    formData.append('file', blob, 'test-material.txt');
    formData.append('classId', classId);
    formData.append('subjectId', subjectId);
    formData.append('materialType', 'transcript');

    const response = await fetch(`${apiBaseUrl}/ingest-material`, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Ingest failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    console.log(`✅ Material uploaded successfully! Material ID: ${data.materialId}`);
    return data.materialId;
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function queryRag() {
    console.log('\n--- 3. Querying RAG Engine ---');
    
    // Pinecone upsert can take a few seconds to be fully indexable. We wait 5 seconds.
    console.log('Waiting 5 seconds for Pinecone indexing...');
    await delay(5000);

    const payload = {
        question: 'What is the secret architectural codeword for the project?',
        classIds: [classId],
        subjectId: subjectId
    };

    console.log('Querying:', payload.question);

    const response = await fetch(`${apiBaseUrl}/rag-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Query failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    console.log('\n💬 AI Answer:');
    console.log(data.answer);
    
    if (data.answer.includes(secretCode)) {
        console.log('\n🚀 SUCCESS! The RAG pipeline successfully retrieved the fact from Pinecone.');
    } else {
        console.error('\n❌ FAILURE: The answer did not contain the expected secret code.');
        console.log('Sources:', JSON.stringify(data.sources, null, 2));
    }
}

async function main() {
    try {
        await seedClass();
        await uploadMaterial();
        await queryRag();
    } catch (err) {
        console.error('\n❌ E2E Test Failed:', err.message);
    }
}

main();
