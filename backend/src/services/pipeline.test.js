import { test, mock } from 'node:test';
import assert from 'node:assert';

// Mock dependencies
const parserMocks = {
    parseFile: mock.fn(async () => 'mocked text'),
    chunkText: mock.fn(() => ['chunk 1', 'chunk 2']),
    cleanText: mock.fn((text) => text)
};

const openaiMocks = {
    generateEmbeddingsBatch: mock.fn(async () => [[0.1, 0.2], [0.3, 0.4]]),
    generateClassSummary: mock.fn(async () => 'summary'),
    generateClassMap: mock.fn(async () => ({ code: 'graph TD; A-->B', generatedAt: new Date().toISOString() }))
};

const pineconeMocks = {
    upsertChunks: mock.fn(async () => true),
    getIndexStats: mock.fn(async () => ({ totalVectorCount: 5, indexFullness: 0.001, namespaces: {} }))
};

const storageMocks = {
    saveJson: mock.fn(async () => true)
};

mock.module('./parser.js', { namedExports: parserMocks });
mock.module('./openai.js', { namedExports: openaiMocks });
mock.module('./pinecone.js', { namedExports: pineconeMocks });
mock.module('./storage.js', { namedExports: storageMocks });

const { runPipeline } = await import('./pipeline.js');

test('runPipeline should not crash when materialType is transcript and correctly call generateClassMap', async (t) => {
    // Reset call counts
    openaiMocks.generateClassMap.mock.resetCalls();
    
    const mockContext = {
        log: mock.fn(),
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
});
