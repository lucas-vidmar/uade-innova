import { test, mock } from 'node:test';
import assert from 'node:assert';

// Define mocks before importing the function under test
const openaiMocks = {
    generateEmbedding: mock.fn(async () => [0.1, 0.2, 0.3]),
    chatCompletion: mock.fn(async () => 'Respuesta simulada.')
};

const pineconeMocks = {
    querySimilar: mock.fn(async () => [
        {
            score: 0.9,
            metadata: {
                sourceFilename: 'clase1.pdf',
                text: 'Contenido',
                materialType: 'pdf',
                classIds: ['class1'],
                chunkIndex: 0
            }
        }
    ])
};

const storageMocks = {
    saveJson: mock.fn(async () => true)
};

// Mock dependencies
mock.module('../services/openai.js', { namedExports: openaiMocks });
mock.module('../services/pinecone.js', { namedExports: pineconeMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });

// Mock @azure/functions to capture the handler
let capturedHandler;
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                if (name === 'rag-query') {
                    capturedHandler = options.handler;
                }
            }
        }
    }
});

// Now import the function under test
await import('../functions/rag-query.js');

test('RAG Filter: should ALWAYS include subjectId: { $eq: subjectId }', async () => {
    pineconeMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';
    
    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = {
        json: async () => ({
            question: 'test',
            subjectId: subjectId,
            classIds: ['class1']
        }),
        user: { id: 'test-user' }
    };

    await capturedHandler(mockRequest, mockContext);

    const filter = pineconeMocks.querySimilar.mock.calls[0].arguments[1];
    assert.strictEqual(filter.subjectId.$eq, subjectId);
});

test('RAG Filter: should include $or with classIds and bibliography when classIds provided', async () => {
    pineconeMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';
    const classIds = ['class1', 'class2'];
    
    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = {
        json: async () => ({
            question: 'test',
            subjectId: subjectId,
            classIds: classIds
        }),
        user: { id: 'test-user' }
    };

    await capturedHandler(mockRequest, mockContext);

    const filter = pineconeMocks.querySimilar.mock.calls[0].arguments[1];
    assert.ok(filter.$or);
    assert.deepStrictEqual(filter.$or, [
        { classIds: { $in: classIds } },
        { materialType: { $eq: 'bibliography' } }
    ]);
});

test('RAG Filter: should simplify to ONLY subjectId when classIds is ["all"]', async () => {
    pineconeMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';
    
    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = {
        json: async () => ({
            question: 'test',
            subjectId: subjectId,
            classIds: ['all']
        }),
        user: { id: 'test-user' }
    };

    await capturedHandler(mockRequest, mockContext);

    const filter = pineconeMocks.querySimilar.mock.calls[0].arguments[1];
    assert.strictEqual(filter.subjectId.$eq, subjectId);
    assert.strictEqual(filter.$or, undefined);
});

test('RAG Filter: should simplify to ONLY subjectId when classIds is empty', async () => {
    pineconeMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';
    
    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = {
        json: async () => ({
            question: 'test',
            subjectId: subjectId,
            classIds: []
        }),
        user: { id: 'test-user' }
    };

    await capturedHandler(mockRequest, mockContext);

    const filter = pineconeMocks.querySimilar.mock.calls[0].arguments[1];
    assert.strictEqual(filter.subjectId.$eq, subjectId);
    assert.strictEqual(filter.$or, undefined);
});

test('RAG Filter: should simplify to ONLY subjectId when classIds is null', async () => {
    pineconeMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';
    
    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = {
        json: async () => ({
            question: 'test',
            subjectId: subjectId,
            classIds: null
        }),
        user: { id: 'test-user' }
    };

    await capturedHandler(mockRequest, mockContext);

    const filter = pineconeMocks.querySimilar.mock.calls[0].arguments[1];
    assert.strictEqual(filter.subjectId.$eq, subjectId);
    assert.strictEqual(filter.$or, undefined);
});

test('RAG Filter: cross-contamination prevention - ensure subjectId is strictly enforced', async () => {
    pineconeMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';
    
    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = {
        json: async () => ({
            question: 'test',
            subjectId: subjectId,
            classIds: ['class-from-another-subject']
        }),
        user: { id: 'test-user' }
    };

    await capturedHandler(mockRequest, mockContext);

    const filter = pineconeMocks.querySimilar.mock.calls[0].arguments[1];
    // Even if classIds are from another subject (which shouldn't happen if frontend is correct),
    // the subjectId filter MUST be present and correct.
    assert.strictEqual(filter.subjectId.$eq, subjectId);
    
    // Ensure no other top-level filter allows bypassing subjectId
    const topLevelKeys = Object.keys(filter);
    assert.ok(topLevelKeys.includes('subjectId'));
    // The only other allowed top-level key is $or (which is also scoped by subjectId because it's an AND at the top level)
    for (const key of topLevelKeys) {
        assert.ok(['subjectId', '$or'].includes(key), `Unexpected top-level filter key: ${key}`);
    }
});
