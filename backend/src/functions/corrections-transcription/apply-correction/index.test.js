import { test, mock } from 'node:test';
import assert from 'node:assert';

// ── Story 10.17 / Task 4.7 (Loopback 2) ──────────────────────────────────────
// apply-correction debe escribir `quarantined: false` en los vectores de
// transcripcion corregida que re-indexa.

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ userId: 'teacher-1', userRoles: ['Docente'] })),
};

const storageMocks = {
    loadJson: mock.fn(async () => ({
        extractedText: 'La arquitectura hexagonal usa fragmento y puertos.',
        classIds: ['class-01'],
        materialType: 'transcript',
        filename: 'transcript.txt',
    })),
    saveJson: mock.fn(async () => true),
    getTableClient: mock.fn(() => ({
        getEntity: mock.fn(async () => ({
            status: 'pending',
            subjectId: 'arq-software-2026',
            materialId: 'mat-1',
            classId: 'class-01',
            fragment: 'fragmento',
            suggestedFix: 'corregido',
        })),
        upsertEntity: mock.fn(async () => {}),
    })),
};

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'teacher' })),
};

const vectorStoreMocks = {
    upsertChunks: mock.fn(async () => {}),
    deleteVectorsByFilter: mock.fn(async () => {}),
};

const aiMocks = {
    generateEmbedding: mock.fn(async () => ({ embedding: [0.1], usage: {} })),
    generateEmbeddingsBatch: mock.fn(async (texts) => ({
        embeddings: texts.map(() => [0.1, 0.2, 0.3]),
        usage: { total_tokens: 10 },
    })),
};

const parserMocks = {
    chunkText: mock.fn(() => [{ text: 'chunk 0' }, { text: 'chunk 1' }]),
};

mock.module('../../../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../../../services/storage.js', { namedExports: storageMocks });
mock.module('../../../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../../../services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../../../services/ai.js', { namedExports: aiMocks });
mock.module('../../../services/parser.js', { namedExports: parserMocks });

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

await import('./index.js');

test('apply-correction re-upserts corrected chunks with quarantined:false', async () => {
    vectorStoreMocks.upsertChunks.mock.resetCalls();
    vectorStoreMocks.deleteVectorsByFilter.mock.resetCalls();

    const request = {
        json: async () => ({ suggestionId: 'sug-1', subjectId: 'arq-software-2026' }),
        headers: { get: () => null },
        method: 'POST',
    };
    const context = {
        log: mock.fn(),
        log_warn: mock.fn(),
        error: mock.fn(),
    };
    const log = mock.fn();
    log.warn = mock.fn();
    log.error = mock.fn();
    const response = await handlers['apply-transcription-correction'](request, { log, error: mock.fn() });

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.reindexed, true, 'el texto corregido debe re-indexarse');

    assert.strictEqual(vectorStoreMocks.deleteVectorsByFilter.mock.callCount(), 1);
    assert.strictEqual(vectorStoreMocks.upsertChunks.mock.callCount(), 1);
    const vectors = vectorStoreMocks.upsertChunks.mock.calls[0].arguments[0];
    assert.strictEqual(vectors.length, 2);
    for (const v of vectors) {
        assert.strictEqual(v.metadata.quarantined, false, 'chunk corregido lleva quarantined:false');
        assert.strictEqual(v.metadata.materialId, 'mat-1');
        assert.strictEqual(v.metadata.subjectId, 'arq-software-2026');
    }
});
