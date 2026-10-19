import { test, mock } from 'node:test';
import assert from 'node:assert';

// Mock dependencies
const parserMocks = {
    parseFile: mock.fn(async () => 'mocked text'),
    chunkText: mock.fn(() => ['chunk 1', 'chunk 2']),
    cleanText: mock.fn((text) => text),
    extractTranscriptTimeline: mock.fn(() => ({
        sections: [{ id: 'sec-001', startSecond: 0, endSecond: 60, timestampLabel: '00:00:00', text: 'mock section' }],
        markers: [{ id: 'mk-001', sectionId: 'sec-001', startSecond: 0, endSecond: 60, iconType: 'question', label: 'mock marker' }],
    })),
    extractPptxSlideTitles: mock.fn(() => ({})),
};

const openaiMocks = {
    generateEmbeddingsBatch: mock.fn(async () => ({
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
        usage: { total_tokens: 100 }
    })),
    generateClassSummary: mock.fn(async () => ({
        content: 'summary',
        usage: { total_tokens: 50 },
        generatedAt: new Date().toISOString()
    })),
    generateClassMap: mock.fn(async () => ({
        code: 'graph TD; A-->B',
        usage: { total_tokens: 30 },
        generatedAt: new Date().toISOString()
    })),
    generatePodcastScript: mock.fn(async () => ({
        content: 'podcast script',
        usage: { total_tokens: 20 },
        generatedAt: new Date().toISOString()
    })),
    chatCompletion: mock.fn(async () => ({ content: 'ok', usage: { total_tokens: 5 } })),
    resolveModelForTask: mock.fn(async () => 'deepseek-v4-flash'),
    isDeepSeekModel: mock.fn(() => true),
    getClientForModel: mock.fn(() => null),
    getChatModelName: mock.fn(() => 'deepseek-v4-flash'),
};

const vectorStoreMocks = {
    upsertChunks: mock.fn(async () => true),
    deleteVectorsByFilter: mock.fn(async () => true),
    getIndexStats: mock.fn(async () => ({ totalVectorCount: 5, indexFullness: 0.001, namespaces: {} }))
};

const storageMocks = {
    saveJson: mock.fn(async () => true),
    loadJson: mock.fn(async () => null),
    getTableClient: mock.fn(() => ({
        createTable: mock.fn(async () => {}),
        listEntities: mock.fn(() => ({
            [Symbol.asyncIterator]: async function* () { yield* []; }
        })),
        upsertEntity: mock.fn(async () => {}),
        getEntity: mock.fn(async () => ({})),
        deleteEntity: mock.fn(async () => {})
    })),
};

const stateStoreMocks = {
    upsertMaterialState: mock.fn(async () => true),
    materialStateExists: mock.fn(async () => true),
};

mock.module('./parser.js', { namedExports: parserMocks });
mock.module('./ai.js', { namedExports: openaiMocks });
mock.module('./vector-store.js', { namedExports: vectorStoreMocks });
mock.module('./storage.js', { namedExports: storageMocks });
mock.module('./state-store.js', { namedExports: stateStoreMocks });

const { runPipeline } = await import('./pipeline.js');

test('runPipeline should not crash when materialType is transcript and correctly call generateClassMap', async (t) => {
    // Reset call counts
    openaiMocks.generateClassMap.mock.resetCalls();
    
    const mockContext = {
        log: mock.fn(),
        warn: mock.fn(),
        error: mock.fn()
    };
    
    await runPipeline({
        fileBuffer: Buffer.from('test'),
        fileContentType: 'text/plain',
        fileName: 'test.txt',
        classIds: ['class1'],
        subjectId: 'subj1',
        materialType: 'transcript',
        materialId: 'mat1',
        blobUrl: 'http://test'
    }, mockContext);
    
    // Ensure no error was logged with a generic run
    const errorCalls = mockContext.error.mock.calls;
    if (errorCalls.length > 0) {
        console.error('runPipeline threw:', errorCalls[0].arguments);
    }
    assert.strictEqual(errorCalls.length, 0, 'No errors should be logged');

    // Validate generateClassMap was called exactly once
    assert.strictEqual(openaiMocks.generateClassMap.mock.callCount(), 1);

    const firstUpsertBatch = vectorStoreMocks.upsertChunks.mock.calls[0]?.arguments?.[0] || [];
    assert.ok(firstUpsertBatch.length > 0, 'Expected at least one vector to be upserted');
    assert.strictEqual(firstUpsertBatch[0].metadata.materialPriority, 'primary', 'Transcript chunks must be tagged as primary');

    const healthLogEmitted = mockContext.log.mock.calls.some((call) =>
        call.arguments?.[0]?.includes('[Pinecone Health]')
    );
    assert.strictEqual(healthLogEmitted, true, 'Should emit index health log after successful upsert');
});

test('runPipeline should continue when index health stats retrieval fails', async () => {
    vectorStoreMocks.getIndexStats.mock.mockImplementationOnce(async () => {
        throw new Error('stats unavailable');
    });

    const logWarn = mock.fn();
    const logFn = mock.fn();
    logFn.warn = logWarn;
    const mockContext = {
        log: logFn,
        warn: mock.fn(),
        error: mock.fn()
    };

    await runPipeline({
        fileBuffer: Buffer.from('test'),
        fileContentType: 'text/plain',
        fileName: 'test.txt',
        classIds: ['class1'],
        subjectId: 'subj1',
        materialType: 'notes',
        materialId: 'mat2',
        blobUrl: 'http://test'
    }, mockContext);

    const warnCalls = mockContext.log.mock.calls;
    const warningLogged = warnCalls.some((call) =>
        call.arguments?.[0]?.includes('No se pudo obtener stats del índice')
    );
    assert.strictEqual(warningLogged, true, 'Should warn when index stats cannot be retrieved');

    const errorCalls = mockContext.error.mock.calls;
    assert.strictEqual(errorCalls.length, 0, 'Stats failures should not break pipeline execution');
});

test('runPipeline should index required metadata including classId and ISO lectureDate', async () => {
    vectorStoreMocks.upsertChunks.mock.resetCalls();

    const mockContext = {
        log: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
    };

    await runPipeline({
        fileBuffer: Buffer.from('test'),
        fileContentType: 'text/plain',
        fileName: 'metadata-test.txt',
        classIds: ['class-meta-01', 'class-meta-02'],
        subjectId: 'subject-meta-01',
        materialType: 'notes',
        materialId: 'mat-meta-01',
        blobUrl: 'http://test',
    }, mockContext);

    assert.strictEqual(vectorStoreMocks.upsertChunks.mock.callCount(), 1, 'Should upsert vectors once');
    const vectors = vectorStoreMocks.upsertChunks.mock.calls[0].arguments[0];
    assert.ok(Array.isArray(vectors) && vectors.length > 0, 'Should send at least one vector');

    const firstMetadata = vectors[0].metadata;
    assert.strictEqual(firstMetadata.subjectId, 'subject-meta-01');
    assert.strictEqual(firstMetadata.classId, 'class-meta-01');
    assert.strictEqual(firstMetadata.materialType, 'notes');
    assert.strictEqual(firstMetadata.sourceFilename, 'metadata-test.txt');

    const parsedLectureDate = Date.parse(firstMetadata.lectureDate);
    assert.ok(Number.isFinite(parsedLectureDate), 'lectureDate should be parseable date');
    assert.strictEqual(new Date(firstMetadata.lectureDate).toISOString(), firstMetadata.lectureDate, 'lectureDate should be ISO 8601');
});

test('runPipeline attaches slideTitle to vector metadata for presentation materials', async () => {
    vectorStoreMocks.upsertChunks.mock.resetCalls();

    // Configurar mocks para simular una presentación con títulos
    parserMocks.chunkText.mock.mockImplementation(() => [
        '[Diapositiva 1]\nArquitectura Hexagonal: conceptos clave',
        '[Diapositiva 1]\nDefinición y principios',
    ]);
    parserMocks.extractPptxSlideTitles.mock.mockImplementation(() => ({
        1: 'Arquitectura Hexagonal',
    }));
    parserMocks.parseFile.mock.mockImplementation(async () => 'mocked text');

    const mockContext = {
        log: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
    };

    await runPipeline({
        fileBuffer: Buffer.from('fake-pptx'),
        fileContentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        fileName: 'clase.pptx',
        classIds: ['class-pptx-01'],
        subjectId: 'subject-pptx-01',
        materialType: 'presentation',
        materialId: 'mat-pptx-01',
        blobUrl: 'http://test',
    }, mockContext);

    assert.strictEqual(vectorStoreMocks.upsertChunks.mock.callCount(), 1, 'Should upsert vectors once');
    const vectors = vectorStoreMocks.upsertChunks.mock.calls[0].arguments[0];
    assert.ok(Array.isArray(vectors) && vectors.length > 0, 'Should send at least one vector');

    // Verificar que extractPptxSlideTitles fue llamado
    const titleFnCalls = parserMocks.extractPptxSlideTitles.mock.calls;
    assert.strictEqual(titleFnCalls.length, 1, 'extractPptxSlideTitles should be called for presentation');

    // Verificar que slideTitle está presente en los vectores
    for (const vector of vectors) {
        assert.strictEqual(vector.metadata.slideTitle, 'Arquitectura Hexagonal',
            `Vector ${vector.id} should have slideTitle`);
    }

    const errorCalls = mockContext.error.mock.calls;
    assert.strictEqual(errorCalls.length, 0, 'No errors should be logged');
});

test('runPipeline rejects material exceeding MAX_MATERIAL_TOKENS with MATERIAL_TOO_LARGE', async (t) => {
    const largeText = 'x'.repeat(2000001);
    parserMocks.chunkText.mock.resetCalls();
    parserMocks.parseFile.mock.mockImplementation(async () => largeText);

    const logWarn = mock.fn();
    const logFn = mock.fn();
    logFn.warn = logWarn;
    const mockContext = {
        log: logFn,
        warn: mock.fn(),
        error: mock.fn(),
    };

    await runPipeline({
        fileBuffer: Buffer.from('test'),
        fileContentType: 'text/plain',
        fileName: 'large.txt',
        classIds: ['class1'],
        subjectId: 'subj1',
        materialType: 'notes',
        materialId: 'mat-large',
        blobUrl: 'http://test',
    }, mockContext);

    const errorCalls = mockContext.error.mock.calls;
    const entry = errorCalls.find(c => c.arguments?.[0]?.includes('mat-large'));
    assert.ok(entry, 'Should log error for large material');
    const err = entry.arguments[1];
    assert.strictEqual(err.code, 'MATERIAL_TOO_LARGE', 'Error code should be MATERIAL_TOO_LARGE');
    assert.strictEqual(err.errorCategory, 'VALIDATION', 'Category should be VALIDATION');
    assert.strictEqual(err.status, 413, 'Status should be 413');
    assert.strictEqual(logFn.mock.calls.some(c =>
        c.arguments?.[0]?.includes('[Pipeline] Material rejected: too large')
    ), true, 'Should warn about oversized material');
    assert.strictEqual(parserMocks.chunkText.mock.calls.length, 0, 'Pipeline should halt before chunking');
});

test('runPipeline allows material at MAX_MATERIAL_TOKENS boundary', async () => {
    const boundaryText = 'x'.repeat(1999999);
    parserMocks.parseFile.mock.mockImplementation(async () => boundaryText);

    const mockContext = {
        log: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
    };

    await runPipeline({
        fileBuffer: Buffer.from('test'),
        fileContentType: 'text/plain',
        fileName: 'boundary.txt',
        classIds: ['class1'],
        subjectId: 'subj1',
        materialType: 'notes',
        materialId: 'mat-boundary',
        blobUrl: 'http://test',
    }, mockContext);

    assert.strictEqual(mockContext.error.mock.calls.length, 0, 'Boundary material should not error');
});

test('runPipeline rejects with low MAX_MATERIAL_TOKENS env var and restores it', async (t) => {
    const prev = process.env.MAX_MATERIAL_TOKENS;
    process.env.MAX_MATERIAL_TOKENS = '100';
    parserMocks.parseFile.mock.mockImplementation(async () => 'a'.repeat(500));

    const logWarn = mock.fn();
    const logFn = mock.fn();
    logFn.warn = logWarn;
    const mockContext = {
        log: logFn,
        warn: mock.fn(),
        error: mock.fn(),
    };

    try {
        await runPipeline({
            fileBuffer: Buffer.from('test'),
            fileContentType: 'text/plain',
            fileName: 'env-override.txt',
            classIds: ['class1'],
            subjectId: 'subj1',
            materialType: 'notes',
            materialId: 'mat-env',
            blobUrl: 'http://test',
        }, mockContext);

        assert.strictEqual(mockContext.error.mock.calls.length > 0, true, 'Should reject with low MAX_MATERIAL_TOKENS');
    } finally {
        if (prev !== undefined) process.env.MAX_MATERIAL_TOKENS = prev;
        else delete process.env.MAX_MATERIAL_TOKENS;
    }
});

test('runPipeline falls back to default when MAX_MATERIAL_TOKENS env var is non-numeric', async () => {
    const prev = process.env.MAX_MATERIAL_TOKENS;
    process.env.MAX_MATERIAL_TOKENS = 'not-a-number';
    parserMocks.parseFile.mock.mockImplementation(async () => 'x'.repeat(1000));

    const mockContext = {
        log: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
    };

    try {
        await runPipeline({
            fileBuffer: Buffer.from('test'),
            fileContentType: 'text/plain',
            fileName: 'invalid-env.txt',
            classIds: ['class1'],
            subjectId: 'subj1',
            materialType: 'notes',
            materialId: 'mat-invalid',
            blobUrl: 'http://test',
        }, mockContext);

        assert.strictEqual(mockContext.error.mock.calls.length, 0, 'Non-numeric env var should fallback to default');
    } finally {
        if (prev !== undefined) process.env.MAX_MATERIAL_TOKENS = prev;
        else delete process.env.MAX_MATERIAL_TOKENS;
    }
});

test('runPipeline does not include slideTitle for non-presentation materials', async () => {
    vectorStoreMocks.upsertChunks.mock.resetCalls();
    parserMocks.chunkText.mock.mockImplementation(() => ['chunk 1', 'chunk 2']);
    parserMocks.extractPptxSlideTitles.mock.mockImplementation(() => ({}));
    parserMocks.parseFile.mock.mockImplementation(async () => 'mocked text');

    const mockContext = {
        log: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
    };

    await runPipeline({
        fileBuffer: Buffer.from('test'),
        fileContentType: 'text/plain',
        fileName: 'notes.txt',
        classIds: ['class-notes-01'],
        subjectId: 'subject-notes-01',
        materialType: 'notes',
        materialId: 'mat-notes-01',
        blobUrl: 'http://test',
    }, mockContext);

    const vectors = vectorStoreMocks.upsertChunks.mock.calls[0].arguments[0];
    for (const vector of vectors) {
        assert.strictEqual(vector.metadata.slideTitle, undefined,
            `Vector ${vector.id} should NOT have slideTitle for non-presentation`);
    }
});

test('runPipeline honors materialPriority override from upload (11-4-2)', async () => {
    vectorStoreMocks.upsertChunks.mock.resetCalls();
    parserMocks.chunkText.mock.mockImplementation(() => ['chunk 1', 'chunk 2']);
    parserMocks.parseFile.mock.mockImplementation(async () => 'mocked text');

    const mockContext = {
        log: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
    };

    // bibliography defaults to secondary, but a manual "primary" override must win
    await runPipeline({
        fileBuffer: Buffer.from('test'),
        fileContentType: 'text/plain',
        fileName: 'ref.pdf',
        classIds: ['class-prio-01'],
        subjectId: 'subject-prio-01',
        materialType: 'bibliography',
        materialPriority: 'primary',
        materialId: 'mat-prio-01',
        blobUrl: 'http://test',
    }, mockContext);

    const vectors = vectorStoreMocks.upsertChunks.mock.calls[0].arguments[0];
    assert.ok(vectors.length > 0, 'Should produce vectors');
    assert.strictEqual(vectors[0].metadata.materialPriority, 'primary',
        'materialPriority override must win over type-derived default');
});

test('runPipeline attaches class topics to vector metadata (11-4-8)', async () => {
    vectorStoreMocks.upsertChunks.mock.resetCalls();
    parserMocks.chunkText.mock.mockImplementation(() => ['chunk 1', 'chunk 2']);
    parserMocks.parseFile.mock.mockImplementation(async () => 'mocked text');

    const topics = ['Arquitectura hexagonal', 'Puertos y adaptadores'];
    storageMocks.loadJson.mock.mockImplementation(async () => [
        { id: 'class-topics-01', topics },
    ]);

    const mockContext = {
        log: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
    };

    await runPipeline({
        fileBuffer: Buffer.from('test'),
        fileContentType: 'text/plain',
        fileName: 'topics.txt',
        classIds: ['class-topics-01'],
        subjectId: 'subject-topics-01',
        materialType: 'notes',
        materialId: 'mat-topics-01',
        blobUrl: 'http://test',
    }, mockContext);

    const vectors = vectorStoreMocks.upsertChunks.mock.calls[0].arguments[0];
    assert.ok(vectors.length > 0, 'Should produce vectors');
    assert.deepStrictEqual(vectors[0].metadata.topics, topics,
        'Class topics should be persisted into vector metadata');

    storageMocks.loadJson.mock.mockImplementation(async () => null);
});

test('runPipeline writes quarantined:false on every vector (always-present field, Story 10.17)', async () => {
    vectorStoreMocks.upsertChunks.mock.resetCalls();
    parserMocks.chunkText.mock.mockImplementation(() => ['chunk 1', 'chunk 2', 'chunk 3']);
    parserMocks.parseFile.mock.mockImplementation(async () => 'mocked text');

    const mockContext = {
        log: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
    };

    await runPipeline({
        fileBuffer: Buffer.from('test'),
        fileContentType: 'text/plain',
        fileName: 'quarantine-field.txt',
        classIds: ['class-q'],
        subjectId: 'subject-q',
        materialType: 'notes',
        materialId: 'mat-q',
        blobUrl: 'http://test',
    }, mockContext);

    const vectors = vectorStoreMocks.upsertChunks.mock.calls[0].arguments[0];
    assert.ok(vectors.length > 0, 'Should produce vectors');
    for (const vector of vectors) {
        assert.strictEqual(vector.metadata.quarantined, false,
            `Vector ${vector.id} debe nacer con quarantined:false`);
    }
});

// #564: el docente puede borrar el material mientras el pipeline procesa. El
// estado es lo que alimenta el inventario de la clase, así que reescribirlo
// "ready" devolvía un material fantasma cuyo blob ya estaba en deleted/.
test('runPipeline no revive un material borrado durante el procesamiento (#564)', async () => {
    vectorStoreMocks.upsertChunks.mock.resetCalls();
    vectorStoreMocks.deleteVectorsByFilter.mock.resetCalls();
    stateStoreMocks.upsertMaterialState.mock.resetCalls();
    storageMocks.saveJson.mock.resetCalls();
    parserMocks.chunkText.mock.mockImplementation(() => ['chunk 1', 'chunk 2']);
    parserMocks.parseFile.mock.mockImplementation(async () => 'mocked text');
    stateStoreMocks.materialStateExists.mock.mockImplementation(async () => false);

    const mockContext = { log: mock.fn(), warn: mock.fn(), error: mock.fn() };

    await runPipeline({
        fileBuffer: Buffer.from('test'),
        fileContentType: 'text/plain',
        fileName: 'borrado-en-vuelo.txt',
        classIds: ['class-01'],
        subjectId: 'arq-software-2026',
        materialType: 'notes',
        materialId: 'mat-borrado',
        blobUrl: 'http://test',
    }, mockContext);

    const readyWrites = stateStoreMocks.upsertMaterialState.mock.calls
        .filter((call) => call.arguments?.[0]?.materialId === 'mat-borrado');
    assert.deepStrictEqual(readyWrites, [], 'no debe reescribir el estado de un material borrado');

    const processedJsonWrites = storageMocks.saveJson.mock.calls
        .filter((call) => call.arguments?.[1] === 'mat-borrado.json');
    assert.deepStrictEqual(processedJsonWrites, [], 'no debe recrear el JSON procesado del material borrado');

    const cleanupCalls = vectorStoreMocks.deleteVectorsByFilter.mock.calls;
    assert.strictEqual(cleanupCalls.length, 1, 'debe limpiar los vectores que indexó antes de detectar el borrado');
    assert.deepStrictEqual(cleanupCalls[0].arguments[0], { materialId: { $eq: 'mat-borrado' } });

    assert.strictEqual(mockContext.error.mock.calls.length, 0, 'el borrado en vuelo no es un error del pipeline');

    stateStoreMocks.materialStateExists.mock.mockImplementation(async () => true);
});

test('runPipeline sigue persistiendo el estado de error de un material que existe (#564)', async () => {
    stateStoreMocks.upsertMaterialState.mock.resetCalls();
    parserMocks.parseFile.mock.mockImplementation(async () => {
        throw new Error('parse roto');
    });
    stateStoreMocks.materialStateExists.mock.mockImplementation(async () => true);

    const mockContext = { log: mock.fn(), warn: mock.fn(), error: mock.fn() };

    await runPipeline({
        fileBuffer: Buffer.from('test'),
        fileContentType: 'text/plain',
        fileName: 'roto.txt',
        classIds: ['class-02'],
        subjectId: 'arq-software-2026',
        materialType: 'notes',
        materialId: 'mat-roto',
        blobUrl: 'http://test',
    }, mockContext);

    const errorWrites = stateStoreMocks.upsertMaterialState.mock.calls
        .filter((call) => call.arguments?.[0]?.status === 'error' && call.arguments?.[0]?.materialId === 'mat-roto');
    assert.strictEqual(errorWrites.length, 1, 'un material que sigue en el inventario debe quedar marcado error');
    parserMocks.parseFile.mock.mockImplementation(async () => 'mocked text');
});

// #578: un `classIds` que llega anidado como texto (`['["class-01"]']`) se
// persistía tal cual en la fila del material, así que ninguna comparación
// contra una clase real matcheaba y el material quedaba invisible para las
// consultas acotadas. La verificación es sobre la fila resultante, no sobre el
// payload de entrada.
test('runPipeline persiste classIds planos cuando llegan anidados como texto (#578)', async () => {
    vectorStoreMocks.upsertChunks.mock.resetCalls();
    stateStoreMocks.upsertMaterialState.mock.resetCalls();
    storageMocks.saveJson.mock.resetCalls();
    parserMocks.parseFile.mock.mockImplementation(async () => 'mocked text');
    parserMocks.chunkText.mock.mockImplementation(() => ['chunk 1', 'chunk 2']);
    stateStoreMocks.materialStateExists.mock.mockImplementation(async () => true);

    const mockContext = { log: mock.fn(), warn: mock.fn(), error: mock.fn() };

    await runPipeline({
        fileBuffer: Buffer.from('test'),
        fileContentType: 'text/plain',
        fileName: 'anidado.txt',
        classIds: ['["class-01"]'],
        subjectId: 'arq-software-2026',
        materialType: 'notes',
        materialId: 'mat-anidado',
        blobUrl: 'http://test',
    }, mockContext);

    const readyWrites = stateStoreMocks.upsertMaterialState.mock.calls
        .filter((call) => call.arguments?.[0]?.materialId === 'mat-anidado' && call.arguments?.[0]?.status === 'ready');
    assert.strictEqual(readyWrites.length, 1, 'debe persistir la fila ready del material');
    assert.deepStrictEqual(readyWrites[0].arguments[0].classIds, ['class-01'],
        'la fila del material debe guardar ids planos');

    const processedWrites = storageMocks.saveJson.mock.calls
        .filter((call) => call.arguments?.[1] === 'mat-anidado.json');
    assert.strictEqual(processedWrites.length, 1, 'debe guardar el JSON procesado');
    assert.deepStrictEqual(processedWrites[0].arguments[2].classIds, ['class-01'],
        'el JSON procesado debe guardar ids planos');

    const vectors = vectorStoreMocks.upsertChunks.mock.calls[0].arguments[0];
    assert.deepStrictEqual(vectors[0].metadata.classIds, ['class-01'],
        'la metadata del vector debe guardar ids planos');
    assert.strictEqual(vectors[0].metadata.classId, 'class-01',
        'el classId principal del vector debe ser un id real');

    assert.strictEqual(mockContext.error.mock.calls.length, 0, 'la normalización no debe loguear errores');
});
