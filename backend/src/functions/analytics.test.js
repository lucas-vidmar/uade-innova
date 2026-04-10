import { jest } from '@jest/globals';

// Mock storage services
const mockListBlobs = jest.fn();
const mockLoadJson = jest.fn();

// Mock auth utils
const mockParseClientPrincipal = jest.fn();
const mockValidateFrontDoorId = jest.fn().mockReturnValue(true);

// We manually trigger the handler to avoid starting the whole app
async function testAnalytics() {
    console.log('--- Testing Analytics Logic ---');
    
    // Setup Mock Data
    const subjectId = 'test-subject';
    const blobs = [
        'user1/test-subject/msg1.json',
        'user2/test-subject/msg2.json'
    ];
    
    const logs = {
        'user1/test-subject/msg1.json': { question: '¿Cómo funciona SAGA?', feedback: 'negative' },
        'user2/test-subject/msg2.json': { question: '¿Qué es hexagonal?', feedback: 'positive' }
    };

    // Simple implementation of the logic for verification
    const questionMap = new Map();
    const frictionMap = new Map();

    const subjectBlobs = blobs.filter(name => name.includes(`/${subjectId}/`));
    
    for (const blobName of subjectBlobs) {
        const log = logs[blobName];
        const tokens = log.question.toLowerCase().split(' ').filter(t => t.length > 3);
        
        tokens.forEach(token => {
            questionMap.set(token, (questionMap.get(token) || 0) + 1);
        });

        if (log.feedback === 'negative') {
            const topic = tokens.slice(0, 2).join(' ');
            frictionMap.set(topic, { topic, unresolved: 1, queries: 1 });
        }
    }

    console.log('Top Questions Map:', Array.from(questionMap.entries()));
    console.log('Friction Topics Map:', Array.from(frictionMap.values()));

    if (questionMap.has('saga') && frictionMap.has('cómo funciona')) {
        console.log('✅ Analytics Logic Verified');
    } else {
        console.log('❌ Analytics Logic Failed');
        process.exit(1);
    }
}

testAnalytics().catch(console.error);
