import { test, mock } from 'node:test';
import assert from 'node:assert';

const vectorStoreMocks = {
    getIndexStats: mock.fn(async () => ({
        totalVectorCount: 42,
        indexFullness: 0,
        namespaces: {},
    })),
};

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({ userId: 'test-user', userRoles: ['Director'] })),
};

mock.module('../services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });

let capturedHandler;
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                if (name === 'vector-health') capturedHandler = options.handler;
            },
        },
    },
});

await import('./vector-health.js');

test('vector-health handler should be registered', () => {
    assert.strictEqual(typeof capturedHandler, 'function');
});

test('vector-health should return provider and stats payload', async () => {
    process.env.PINECONE_INDEX_NAME = 'dashboard-edu-pilot';

    const response = await capturedHandler(
        { headers: { get: () => null } },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.provider, 'pinecone');
    assert.strictEqual(body.indexName, 'dashboard-edu-pilot');
    assert.strictEqual(body.stats.totalVectorCount, 42);
});

test('vector-health should reject when Front Door validation fails', async () => {
    authUtilsMocks.validateFrontDoorId.mock.mockImplementationOnce(() => false);

    const response = await capturedHandler(
        { headers: { get: () => null } },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 403);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'Forbidden - Invalid Front Door ID');
});
