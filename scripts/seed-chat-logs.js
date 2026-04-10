import { saveJson } from '../backend/src/services/storage.js';

async function seed() {
    const CONTAINER = 'chat-logs';
    const subjectId = 'arq-software-2026';
    const users = ['alu-001', 'alu-002', 'alu-003'];
    
    const logs = [
        { question: '¿Qué es la arquitectura hexagonal?', feedback: 'positive' },
        { question: '¿Diferencia entre hexagonal y cebolla?', feedback: 'positive' },
        { question: 'No entiendo el patrón SAGA', feedback: 'negative' },
        { question: '¿Cómo funciona una transacción compensatoria?', feedback: 'negative' },
        { question: '¿Cuándo usar microservicios?', feedback: 'positive' },
        { question: 'Ejemplos de DDD', feedback: 'positive' },
        { question: 'Bounded context vs subdominio', feedback: 'negative' },
        { question: '¿Qué es un puerto y un adaptador?', feedback: 'positive' },
    ];

    console.log('Seeding chat logs...');
    for (let i = 0; i < logs.length; i++) {
        const user = users[i % users.length];
        const log = {
            id: `msg-${Date.now()}-${i}`,
            userId: user,
            subjectId,
            timestamp: new Date().toISOString(),
            ...logs[i]
        };
        const blobPath = `${user}/${subjectId}/${log.id}.json`;
        await saveJson(CONTAINER, blobPath, log);
        console.log(`Saved: ${blobPath}`);
    }
    console.log('Seed complete.');
}

seed().catch(console.error);
