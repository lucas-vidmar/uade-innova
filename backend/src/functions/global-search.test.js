import { test, mock } from 'node:test';
import assert from 'node:assert';

const openaiMocks = {
    generateEmbedding: mock.fn(async () => ({ embedding: [0.11, 0.22, 0.33] })),
};

const vectorStoreMocks = {
    querySimilar: mock.fn(async () => [
        {
            score: 0.81,
            metadata: {
                materialId: 'm-1',
                classIds: ['class-01'],
                materialType: 'transcript',
                materialPriority: 'primary',
                sourceFilename: 'class-01-transcript.txt',
                chunkIndex: 0,
                text: 'Architecture decisions are tied to quality attributes and trade-offs.',
            },
        },
        {
            score: 0.79,
            metadata: {
                materialId: 'm-2',
                classIds: ['class-03'],
                materialType: 'bibliography',
                materialPriority: 'secondary',
                sourceFilename: 'clean-architecture.pdf',
                chunkIndex: 4,
                text: 'Architecture should protect business rules from framework details.',
            },
        },
    ]),
};

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({ userId: 'alu-001', userRoles: ['Alumno'] })),
    getAuthenticatedUser: mock.fn(() => ({ userId: 'alu-001', sanitizedId: 'alu_001', principal: { userId: 'alu-001' }, role: 'Alumno' })),
};

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'student' })),
    listClassesBySubject: mock.fn(async () => []),
};

const correlationMocks = {
    resolveCorrelationId: mock.fn((request) => request?.headers?.get?.('x-correlation-id') || 'test-correlation-id'),
    resolveTraceContext: mock.fn(() => ({ traceparent: '00-trace-id-span-id-01', tracestate: null, traceId: 'trace-id', spanId: 'span-id' })),
    buildDependencyHeaders: mock.fn((cid) => ({ 'x-correlation-id': cid })),
    withCorrelationResponseHeaders: mock.fn((cid, headers) => ({ ...headers, 'x-correlation-id': cid })),
    generateCorrelationId: mock.fn(() => 'test-correlation-id'),
};

mock.module('../services/ai.js', { namedExports: openaiMocks });
mock.module('../services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/correlation.js', { namedExports: correlationMocks });

const errorCategoriesMocks = {
    ErrorCategory: {
        RETRIEVAL_FAILURE: 'RETRIEVAL_FAILURE',
        SAFETY: 'SAFETY',
        PARSING: 'PARSING',
        LLM: 'LLM',
        VALIDATION: 'VALIDATION',
        AUTH: 'AUTH',
        STORAGE: 'STORAGE',
        NOT_FOUND: 'NOT_FOUND',
        RATE_LIMIT: 'RATE_LIMIT',
        INTERNAL: 'INTERNAL',
    },
    normalizeCategorizedError: mock.fn((err, fallback) => ({
        message: err?.message || 'error',
        errorCategory: fallback,
        code: err?.code || 'UNKNOWN_ERROR',
        status: 500,
    })),
    structuredErrorResponse: mock.fn((status, message, errorCategory, code) => ({
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: message, errorCategory, code }),
    })),
};
mock.module('../services/error-categories.js', { namedExports: errorCategoriesMocks });

const storageMocks = {
    loadJson: mock.fn(async () => null),
    listBlobs: mock.fn(async () => []),
};
mock.module('../services/storage.js', { namedExports: storageMocks });

let capturedHandler;
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                if (name === 'global-search') capturedHandler = options.handler;
            },
        },
    },
});

await import('./global-search.js');

test('global-search handler should be registered', () => {
    assert.strictEqual(typeof capturedHandler, 'function');
});

function mockRequest(body, correlationId) {
    return {
        json: async () => body,
        headers: {
            get: (name) => {
                if (name === 'x-correlation-id') return correlationId || null;
                if (name === 'origin') return 'http://localhost:4280';
                return null;
            },
        },
    };
}

test('global-search should reject missing required fields with errorCategory', async () => {
    const response = await capturedHandler(
        mockRequest({ query: 'Architecture' }),
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 400);
    const body = JSON.parse(response.body);
    assert.ok(body.error.includes('query, subjectId'));
    assert.strictEqual(body.errorCategory, 'VALIDATION');
    assert.strictEqual(body.code, 'MISSING_FIELDS');
});

test('global-search should query full subject index scoped to transcript+bibliography', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();

    const response = await capturedHandler(
        mockRequest({ query: 'Architecture', subjectId: 'arq-software-2026' }),
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);

    const filter = vectorStoreMocks.querySimilar.mock.calls[0].arguments[1];
    assert.strictEqual(filter.subjectId.$eq, 'arq-software-2026');
    assert.deepStrictEqual(filter.materialType.$in, ['transcript', 'bibliography', 'presentation', 'notes']);

    const body = JSON.parse(response.body);
    assert.strictEqual(Array.isArray(body.results), true);
    assert.strictEqual(body.results.length, 2);
    const transcriptResult = body.results.find((item) => item.sourceFilename === 'class-01-transcript.txt');
    const bibliographyResult = body.results.find((item) => item.sourceFilename === 'clean-architecture.pdf');
    assert.strictEqual(transcriptResult?.materialPriority, 'primary');
    assert.strictEqual(bibliographyResult?.materialPriority, 'secondary');
    assert.ok(body.results[0].score >= body.results[1].score, 'Results should be sorted by boosted score');
});

test('global-search should propagate correlation header to embedding call and response', async () => {
    openaiMocks.generateEmbedding.mock.resetCalls();

    const response = await capturedHandler(
        mockRequest({ query: 'Architecture', subjectId: 'arq-software-2026' }, 'corr-gs-123'),
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers['x-correlation-id'], 'corr-gs-123');
    assert.strictEqual(openaiMocks.generateEmbedding.mock.calls[0].arguments[1].headers['x-correlation-id'], 'corr-gs-123');
});
