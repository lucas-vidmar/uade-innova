import { test, mock } from 'node:test';
import assert from 'node:assert';

const openaiMocks = {
    generateEmbedding: mock.fn(async () => ({ embedding: [0.11, 0.22, 0.33] })),
};

const pineconeMocks = {
    querySimilar: mock.fn(async () => [
        {
            score: 0.81,
            metadata: {
                materialId: 'm-1',
                classIds: ['class-01'],
                materialType: 'transcript',
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
                sourceFilename: 'clean-architecture.pdf',
                chunkIndex: 4,
                text: 'Architecture should protect business rules from framework details.',
            },
        },
    ]),
};

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
};

mock.module('../services/openai.js', { namedExports: openaiMocks });
mock.module('../services/pinecone.js', { namedExports: pineconeMocks });
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });

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

test('global-search should reject missing required fields', async () => {
    const response = await capturedHandler(
        { json: async () => ({ query: 'Architecture' }) },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 400);
    const body = JSON.parse(response.body);
    assert.ok(body.error.includes('query, subjectId'));
});

test('global-search should query full subject index scoped to transcript+bibliography', async () => {
    pineconeMocks.querySimilar.mock.resetCalls();

    const response = await capturedHandler(
        { json: async () => ({ query: 'Architecture', subjectId: 'arq-software-2026' }) },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);

    const filter = pineconeMocks.querySimilar.mock.calls[0].arguments[1];
    assert.strictEqual(filter.subjectId.$eq, 'arq-software-2026');
    assert.deepStrictEqual(filter.materialType.$in, ['transcript', 'bibliography']);

    const body = JSON.parse(response.body);
    assert.strictEqual(Array.isArray(body.results), true);
    assert.strictEqual(body.results.length, 2);
    assert.ok(body.results[0].score >= body.results[1].score, 'Results should be sorted by boosted score');
});
