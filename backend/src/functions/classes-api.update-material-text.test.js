import { test, mock } from 'node:test';
import assert from 'node:assert';

// ── Story 10.17 / Task 4.7 (Loopback 5) ──────────────────────────────────────
// update-material-text debe escribir `quarantined: false` en cada vector
// re-upserteado y usar `upsertChunks` (NUNCA el inexistente upsertVectors).

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ userId: 'teacher-1', userRoles: ['Docente'] })),
};

const storageMocks = {
    loadJson: mock.fn(async () => ({ filename: 'clase.txt', classIds: ['class-01'], materialType: 'notes' })),
    saveJson: mock.fn(async () => true),
    listBlobs: mock.fn(async () => []),
    deleteBlob: mock.fn(async () => true),
    moveBlob: mock.fn(async () => true),
    uploadFile: mock.fn(async () => true),
    downloadFile: mock.fn(async () => null),
    getTableClient: mock.fn(() => ({
        createTable: mock.fn(async () => {}),
        listEntities: mock.fn(() => ({ [Symbol.asyncIterator]: async function* () {} })),
        upsertEntity: mock.fn(async () => {}),
        getEntity: mock.fn(async () => ({})),
        deleteEntity: mock.fn(async () => {}),
    })),
};

const stateStoreMocks = {
    listClassesBySubject: mock.fn(async () => []),
    listMaterialsBySubject: mock.fn(async () => []),
    listMaterialsByClass: mock.fn(async () => []),
    replaceClassesForSubject: mock.fn(async () => true),
    deleteMaterialStateById: mock.fn(async () => true),
    getMaterialState: mock.fn(async () => ({
        subjectId: 'arq-software-2026',
        materialId: 'mat-1',
        classIds: ['class-01'],
        type: 'notes',
        filename: 'clase.txt',
    })),
    getMaterialStateById: mock.fn(async () => null),
    upsertMaterialState: mock.fn(async () => true),
    deleteClassesBySubject: mock.fn(async () => true),
    deleteMaterialsBySubject: mock.fn(async () => true),
    getEnrollmentsByUser: mock.fn(async () => []),
    getEnrollment: mock.fn(async () => null),
    listClassViewsByStudent: mock.fn(async () => []),
    deleteClassViewsBySubject: mock.fn(async () => true),
};

const vectorStoreMocks = {
    upsertChunks: mock.fn(async () => {}),
    deleteVectorsByMaterialId: mock.fn(async () => {}),
};

const telemetryMocks = {
    trackPollingEvent: mock.fn(async () => {}),
    trackAuthFallbackBlocked: mock.fn(async () => {}),
};

const uploadQuotaMocks = {
    releaseUpload: mock.fn(async () => {}),
    checkUploadQuota: mock.fn(async () => ({ allowed: true })),
    recordUpload: mock.fn(async () => {}),
};

const aiMocks = {
    chatCompletion: mock.fn(async () => ({ content: 'x' })),
    generateClassSummary: mock.fn(async () => ({ content: 'x' })),
    generateClassMap: mock.fn(async () => ({ code: 'x' })),
    generateClassAudio: mock.fn(async () => Buffer.from('')),
    generatePodcastScript: mock.fn(async () => ({ content: 'x' })),
    generateEmbeddingsBatch: mock.fn(async (texts) => ({
        embeddings: texts.map(() => [0.1, 0.2, 0.3]),
        usage: { total_tokens: 10 },
    })),
};

const parserMocks = {
    chunkText: mock.fn(() => [{ text: 'chunk 0' }, { text: 'chunk 1' }]),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../services/telemetry.js', { namedExports: telemetryMocks });
mock.module('../services/upload-quota.js', { namedExports: uploadQuotaMocks });
mock.module('../services/ai.js', { namedExports: aiMocks });
mock.module('../services/parser.js', { namedExports: parserMocks });
mock.module('uuid', { namedExports: { v4: () => '1234' } });

const handlers = {};
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
            },
        },
    },
});

process.env.DIRECTOR_BUDGET_MONTHLY_USD = '97.50';

function makeMockLog() {
    const log = mock.fn();
    log.warn = mock.fn();
    log.error = mock.fn();
    log.info = mock.fn();
    return log;
}

await import('./classes-api.js');

test('update-material-text upserts every re-embedded vector with quarantined:false via upsertChunks', async () => {
    vectorStoreMocks.upsertChunks.mock.resetCalls();
    vectorStoreMocks.deleteVectorsByMaterialId.mock.resetCalls();
    storageMocks.saveJson.mock.resetCalls();

    const request = {
        params: { materialId: 'mat-1' },
        json: async () => ({ subjectId: 'arq-software-2026', text: 'Nuevo texto del material' }),
        headers: { get: () => null },
        method: 'PUT',
    };
    const response = await handlers['update-material-text'](request, { log: makeMockLog() });

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.chunkCount, 2);

    // Delete usa la API validada deleteVectorsByMaterialId
    assert.strictEqual(vectorStoreMocks.deleteVectorsByMaterialId.mock.callCount(), 1);
    assert.strictEqual(vectorStoreMocks.deleteVectorsByMaterialId.mock.calls[0].arguments[0], 'mat-1');

    // Upsert via upsertChunks (nunca upsertVectors)
    assert.strictEqual(vectorStoreMocks.upsertChunks.mock.callCount(), 1, 'debe usar upsertChunks');
    const vectors = vectorStoreMocks.upsertChunks.mock.calls[0].arguments[0];
    assert.strictEqual(vectors.length, 2);
    for (const v of vectors) {
        assert.strictEqual(v.id.startsWith('mat-1-chunk-'), true);
        assert.strictEqual(v.metadata.quarantined, false, 'cada vector re-upserteado lleva quarantined:false');
        assert.strictEqual(v.metadata.subjectId, 'arq-software-2026');
        // Wire format compatible: classIds sigue como string JSON (patch de review #14)
        assert.strictEqual(v.metadata.classIds, '["class-01"]');
        assert.strictEqual(v.metadata.materialType, 'notes');
        assert.ok(Array.isArray(v.values) && v.values.length === 3);
    }
});

test('update-material-text returns 403 when the caller is not Docente/Director', async () => {
    vectorStoreMocks.upsertChunks.mock.resetCalls();
    vectorStoreMocks.deleteVectorsByMaterialId.mock.resetCalls();
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({
        userId: 'student-1',
        userRoles: ['Alumno'],
    }));

    const request = {
        params: { materialId: 'mat-1' },
        json: async () => ({ subjectId: 'arq-software-2026', text: 'x' }),
        headers: { get: () => null },
        method: 'PUT',
    };
    const response = await handlers['update-material-text'](request, { log: makeMockLog() });
    assert.strictEqual(response.status, 403);
    assert.strictEqual(vectorStoreMocks.upsertChunks.mock.callCount(), 0);
});
