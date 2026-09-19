import { test, mock } from 'node:test';
import assert from 'node:assert';
import { setupTestEnv } from '../src/test-utils/env.js';

setupTestEnv();

// El CLI importa storage.js / state-store.js / vector-store.js (que dependen de
// paquetes Azure no instalados en este entorno). Se mockean para aislar el test.
mock.module('../src/services/storage.js', {
    namedExports: {
        loadJson: async () => null,
        saveJson: async () => {},
        deleteBlob: async () => {},
        listBlobs: async () => [],
    },
});
mock.module('../src/services/state-store.js', {
    namedExports: {
        listAllConversations: async () => [],
        listAllMaterials: async () => [],
        listAllClasses: async () => [],
        listAllEnrollments: async () => [],
        listAllUserProfiles: async () => [],
        deleteConversation: async () => true,
        deleteMaterialState: async () => true,
        deleteClassesBySubject: async () => {},
        deleteEnrollment: async () => true,
        deleteUserProfile: async () => true,
    },
});
mock.module('../src/services/vector-store.js', {
    namedExports: {
        deleteVectorsByFilter: async () => {},
        getIndexStats: async () => ({ totalVectorCount: 0 }),
    },
});
// #344: el CLI importa notification-store/glossary-store (que a su vez
// importan state-store con exports no mockeados acá). Se mockean para aislar.
mock.module('../src/services/notification-store.js', {
    namedExports: {
        listNotificationsBySubject: async () => [],
    },
});
mock.module('../src/services/glossary-store.js', {
    namedExports: {
        getGlossary: async () => null,
        updateGlossary: async () => null,
    },
});

const { main, parseArgs } = await import('../scripts/cleanup-test-data.js');

function createFakeStores({ data = {} } = {}) {
    const calls = { mutations: [] };
    const record = (name, ...args) => calls.mutations.push({ name, args });
    const defaults = {
        blobNames: {
            'deadlines': ['arq-software-2026.json'],
            'class-timelines': ['class-01.json'],
            'class-materials': ['class-01/DASI Cronograma dia Jueves_1C2023_ejemplo.docx'],
            'processed': ['processed-test-01.json'],
        },
        deadlines: { 'arq-software-2026.json': [{ id: 'd-ok', title: 'OK' }, { id: 'd-test', title: 'Test deadlinr' }] },
        timelines: { 'class-01.json': { classId: 'class-01', subjectId: 'arq-software-2026', markers: [{ id: 'mk-0', sectionId: 'sec-0', startSecond: 0, label: 'X' }], sections: [] } },
        processed: { 'processed-test-01.json': { subjectId: 'dasi-1c2023', filename: 'DASI x.docx', extractedText: '' } },
        conversations: [{ userId: 'alu-001', conversationId: 'c-ok', subjectId: 'arq-software-2026', firstQuestion: '¿Qué es la arquitectura hexagonal?' }, { userId: 'alu-001', conversationId: 'c-test', subjectId: 'arq-software-2026', firstQuestion: 'Que es un sistema?' }],
        materials: [{ subjectId: 'dasi-1c2023', materialId: 'm-dasi', filename: 'DASI Cronograma dia Jueves_1C2023_ejemplo.docx' }],
        classes: [{ subjectId: 'matematica-2026', id: 'mat-01' }],
        enrollments: [{ subjectId: 'arq-software-2026', userId: 'test-alu-001', role: 'student' }],
        profiles: [{ rowKey: 'test-alu-001', displayName: 'Ana García' }],
    };
    const d = { ...defaults, ...data };
    for (const key of ['blobNames', 'deadlines', 'timelines', 'processed', 'conversations', 'materials', 'classes', 'enrollments', 'profiles']) {
        if (typeof d[key] === 'object' && !Array.isArray(d[key])) d[key] = { ...d[key] };
    }

    const stores = {
        listBlobNames: async (container) => d.blobNames?.[container] || [],
        loadDeadlines: async (subjectId) => (d.deadlines?.[`${subjectId}.json`] || []),
        loadTimeline: async (classId) => d.timelines?.[`${classId}.json`] || null,
        loadProcessed: async (blobName) => d.processed?.[blobName] || null,
        loadSubjectsConfig: async () => d.subjectsConfig || null,
        listConversations: async () => d.conversations || [],
        listMaterials: async () => d.materials || [],
        listClasses: async () => d.classes || [],
        listEnrollments: async () => d.enrollments || [],
        listUserProfiles: async () => d.profiles || [],
        saveDeadlines: async (...a) => record('saveDeadlines', ...a),
        saveTimeline: async (...a) => record('saveTimeline', ...a),
        saveSubjectsConfig: async (...a) => record('saveSubjectsConfig', ...a),
        deleteBlob: async (...a) => record('deleteBlob', ...a),
        deleteConversation: async (...a) => record('deleteConversation', ...a),
        deleteMaterial: async (...a) => record('deleteMaterial', ...a),
        deleteClassesBySubject: async (...a) => record('deleteClassesBySubject', ...a),
        deleteEnrollment: async (...a) => record('deleteEnrollment', ...a),
        deleteUserProfile: async (...a) => record('deleteUserProfile', ...a),
        deletePineconeVectorsBySubjectIds: async (...a) => record('deletePineconeVectorsBySubjectIds', ...a),
        getPineconeStats: async () => ({ totalVectorCount: 0 }),
    };

    return { stores, calls, data: d };
}

/**
 * Fake store que MUTA sus estructuras en memoria al borrar, de modo que un
 * verify posterior a la limpieza ve el storage ya limpio.
 */
function createMutatingStores() {
    const data = {
        conversations: [
            { userId: 'alu-001', conversationId: 'c-test', subjectId: 'arq-software-2026', firstQuestion: 'Que es un sistema?' },
        ],
        materials: [
            { subjectId: 'dasi-1c2023', materialId: 'm-dasi', filename: 'DASI Cronograma dia Jueves_1C2023_ejemplo.docx' },
        ],
        profiles: [
            { rowKey: 'test-alu-001', displayName: 'Ana García' },
        ],
    };
    const calls = { mutations: [] };
    const record = (name, ...args) => calls.mutations.push({ name, args });

    const stores = {
        listBlobNames: async () => [],
        loadDeadlines: async () => [],
        loadTimeline: async () => null,
        loadProcessed: async () => null,
        loadSubjectsConfig: async () => null,
        listConversations: async () => data.conversations,
        listMaterials: async () => data.materials,
        listClasses: async () => [],
        listEnrollments: async () => [],
        listUserProfiles: async () => data.profiles,
        saveDeadlines: async (...a) => record('saveDeadlines', ...a),
        saveTimeline: async (...a) => record('saveTimeline', ...a),
        saveSubjectsConfig: async (...a) => record('saveSubjectsConfig', ...a),
        deleteBlob: async (...a) => record('deleteBlob', ...a),
        deleteConversation: async (userId, conversationId) => {
            record('deleteConversation', userId, conversationId);
            data.conversations = data.conversations.filter((c) => c.conversationId !== conversationId);
            return true;
        },
        deleteMaterial: async (subjectId, materialId) => {
            record('deleteMaterial', subjectId, materialId);
            data.materials = data.materials.filter((m) => m.materialId !== materialId);
            return true;
        },
        deleteClassesBySubject: async (...a) => record('deleteClassesBySubject', ...a),
        deleteEnrollment: async (...a) => record('deleteEnrollment', ...a),
        deleteUserProfile: async (userId) => {
            record('deleteUserProfile', userId);
            data.profiles = data.profiles.filter((p) => (p.rowKey || p.userId) !== userId);
            return true;
        },
        deletePineconeVectorsBySubjectIds: async (...a) => record('deletePineconeVectorsBySubjectIds', ...a),
        getPineconeStats: async () => ({ totalVectorCount: 0 }),
    };
    return { stores, calls };
}

test('parseArgs: default es dry-run; --live / --reseed lo desactivan', () => {
    assert.strictEqual(parseArgs([]).dryRun, true);
    assert.strictEqual(parseArgs(['--dry-run']).dryRun, true);
    assert.strictEqual(parseArgs(['--live']).dryRun, false);
    assert.strictEqual(parseArgs(['--reseed']).dryRun, false);
    assert.strictEqual(parseArgs(['--verify']).dryRun, true);
    assert.strictEqual(parseArgs([], { DRY_RUN: 'true' }).dryRun, true);
    assert.strictEqual(parseArgs(['--live'], { DRY_RUN: 'true' }).dryRun, true, 'DRY_RUN=true fuerza preview');
});

test('parseArgs: Pinecone se omite por defecto y se activa con --with-pinecone', () => {
    assert.strictEqual(parseArgs(['--live']).skipPinecone, true);
    assert.strictEqual(parseArgs(['--live']).withPinecone, false);
    assert.strictEqual(parseArgs(['--live', '--with-pinecone']).skipPinecone, false);
    assert.strictEqual(parseArgs(['--live', '--skip-pinecone']).skipPinecone, true);
});

test('main: DRY_RUN=true con --live --yes NO ejecuta mutaciones (fail-closed)', async () => {
    const { stores, calls } = createFakeStores();

    const result = await main({ stores, args: parseArgs(['--live', '--yes'], { DRY_RUN: 'true' }) });

    assert.strictEqual(result.status, 'dry-run', 'DRY_RUN=true debe forzar preview, no --live');
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(calls.mutations.length, 0, 'DRY_RUN=true debe impedir CUALQUIER borrado live');
});

test('main: DRY_RUN=true con --reseed --yes NO ejecuta mutaciones ni reseed', async () => {
    const { stores, calls } = createFakeStores();
    let reseedCalls = 0;

    const result = await main({
        stores,
        args: parseArgs(['--reseed', '--yes'], { DRY_RUN: 'true' }),
        runReseed: () => { reseedCalls += 1; return true; },
    });

    assert.strictEqual(result.status, 'dry-run');
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(calls.mutations.length, 0);
    assert.strictEqual(reseedCalls, 0, 'con DRY_RUN=true no debe re-sembrar');
});

test('main en modo dry-run reporta artefactos y NO ejecuta ninguna mutación', async () => {
    const { stores, calls } = createFakeStores();

    const result = await main({ stores, args: parseArgs(['--dry-run']) });

    assert.strictEqual(result.status, 'dry-run');
    assert.strictEqual(result.dryRun, true);
    assert.ok(result.summary.deadlines >= 1, 'debe reportar deadlines de prueba');
    assert.ok(result.summary.conversations >= 1, 'debe reportar conversaciones de prueba');
    assert.strictEqual(calls.mutations.length, 0, 'dry-run no puede llamar a operaciones de borrado');
});

test('main en modo live requiere confirmación: sin --yes y sin TTY → cancelled', async () => {
    const { stores, calls } = createFakeStores();

    const result = await main({ stores, args: parseArgs(['--live']) });

    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(calls.mutations.length, 0, 'live cancelado no debe mutar');
});

test('main en modo live con --yes ejecuta las eliminaciones contra el storage', async () => {
    const { stores, calls } = createFakeStores();

    const result = await main({ stores, args: parseArgs(['--live', '--yes']) });

    assert.strictEqual(result.status, 'done');
    assert.ok(calls.mutations.some((c) => c.name === 'deleteBlob'));
    assert.ok(calls.mutations.some((c) => c.name === 'deleteConversation'));
    assert.ok(calls.mutations.some((c) => c.name === 'deleteUserProfile'));
    assert.ok(!calls.mutations.some((c) => c.name === 'deletePineconeVectorsBySubjectIds'), 'Pinecone NO se borra por defecto');
});

test('main --live --yes --with-pinecone sí delega borrado de vectores', async () => {
    const { stores, calls } = createFakeStores();

    const result = await main({ stores, args: parseArgs(['--live', '--yes', '--with-pinecone']) });

    assert.strictEqual(result.status, 'done');
    assert.ok(calls.mutations.some((c) => c.name === 'deletePineconeVectorsBySubjectIds'));
});

test('main en modo verify sin artefactos devuelve status ok', async () => {
    const { stores } = createFakeStores();
    const cleanStores = {
        ...stores,
        listBlobNames: async () => [],
        listConversations: async () => [],
        listMaterials: async () => [],
        listClasses: async () => [],
        listEnrollments: async () => [],
        listUserProfiles: async () => [],
        loadDeadlines: async () => [],
        loadTimeline: async () => null,
        loadProcessed: async () => null,
    };

    const result = await main({ stores: cleanStores, args: parseArgs(['--verify']) });
    assert.strictEqual(result.status, 'ok');
});

test('main --help imprime la ayuda y no toca el storage', async () => {
    const { stores, calls } = createFakeStores();
    const result = await main({ stores, args: parseArgs(['--help']) });
    assert.strictEqual(result.status, 'help');
    assert.strictEqual(calls.mutations.length, 0);
});

test('main en modo reseed con --yes y runReseed inyectable: limpia, resiembra y verifica', async () => {
    const { stores, calls } = createMutatingStores();
    let reseedCalls = 0;

    const result = await main({
        stores,
        args: parseArgs(['--reseed', '--yes']),
        runReseed: () => { reseedCalls += 1; return true; },
    });

    assert.strictEqual(result.status, 'ok', 'tras limpiar y resembrar el verify debe pasar');
    assert.strictEqual(reseedCalls, 1, 'runReseed debe ejecutarse una vez');
    assert.ok(calls.mutations.some((c) => c.name === 'deleteConversation'), 'la limpieza live debe correr');
    assert.ok(calls.mutations.some((c) => c.name === 'deleteUserProfile'));
});

test('main en modo reseed sin --yes y sin TTY → cancelled (no resiembra)', async () => {
    const { stores, calls } = createMutatingStores();
    let reseedCalls = 0;

    const result = await main({
        stores,
        args: parseArgs(['--reseed']),
        runReseed: () => { reseedCalls += 1; return true; },
    });

    assert.strictEqual(result.status, 'cancelled');
    assert.strictEqual(reseedCalls, 0);
    assert.strictEqual(calls.mutations.length, 0);
});

test('guard de entorno: --live contra storage piloto se bloquea sin ALLOW_CLEANUP_PILOT', async (t) => {
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'stdashboardtest';
    t.after(() => { delete process.env.AZURE_STORAGE_ACCOUNT_NAME; delete process.env.ALLOW_CLEANUP_PILOT; });

    const { stores } = createFakeStores();
    await assert.rejects(
        main({ stores, args: parseArgs(['--live', '--yes']) }),
        /ALLOW_CLEANUP_PILOT/,
    );
});

test('guard de entorno: ALLOW_CLEANUP_PILOT=true permite --live contra storage piloto', async (t) => {
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'stdashboardtest';
    process.env.ALLOW_CLEANUP_PILOT = 'true';
    t.after(() => { delete process.env.AZURE_STORAGE_ACCOUNT_NAME; delete process.env.ALLOW_CLEANUP_PILOT; });

    const { stores } = createFakeStores();
    const result = await main({ stores, args: parseArgs(['--live', '--yes']) });
    assert.strictEqual(result.status, 'done');
});

test('guard de entorno: dry-run contra storage piloto solo advierte (no bloquea)', async (t) => {
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'stdashboardtest';
    t.after(() => { delete process.env.AZURE_STORAGE_ACCOUNT_NAME; delete process.env.ALLOW_CLEANUP_PILOT; });

    const { stores } = createFakeStores();
    const result = await main({ stores, args: parseArgs(['--dry-run']) });
    assert.strictEqual(result.status, 'dry-run');
});
