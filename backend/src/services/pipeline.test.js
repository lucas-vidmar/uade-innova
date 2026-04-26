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
    }))
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
    }))
};

const vectorStoreMocks = {
    upsertChunks: mock.fn(async () => true),
    getIndexStats: mock.fn(async () => ({ totalVectorCount: 5, indexFullness: 0.001, namespaces: {} }))
};

const storageMocks = {
    saveJson: mock.fn(async () => true),
    loadJson: mock.fn(async () => null),
};

const stateStoreMocks = {
    upsertMaterialState: mock.fn(async () => true),
};

mock.module('./parser.js', { namedExports: parserMocks });
mock.module('./openai.js', { namedExports: openaiMocks });
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
        materialType: 'notes',
        materialId: 'mat2',
        blobUrl: 'http://test'
    }, mockContext);

    const warnCalls = mockContext.warn.mock.calls;
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
