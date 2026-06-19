import { test, mock } from 'node:test';
import assert from 'node:assert';

const vectorStoreMocks = {
    getIndexStats: mock.fn(async () => ({
        totalVectorCount: 42,
        indexFullness: 0,
        namespaces: {},
    })),
};

const vectorMetricsMocks = {
    getVectorMetrics: mock.fn((windowMinutes) => ({
        latencyMs: { p50: 120, p95: 350 },
        failureRatio: 0.03,
        sampleCount: 100,
        windowMinutes: windowMinutes || 5,
    })),
};

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({ userId: 'test-user', userRoles: ['Director'] })),
};

mock.module('../services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../services/vector-metrics.js', { namedExports: vectorMetricsMocks });
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
        { headers: { get: () => null }, query: { get: () => null } },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.provider, 'pinecone');
    assert.strictEqual(body.indexName, 'dashboard-edu-pilot');
    assert.strictEqual(body.stats.totalVectorCount, 42);
});

test('vector-health should include latency and failure ratio metrics', async () => {
    const response = await capturedHandler(
        { headers: { get: () => null }, query: { get: (key) => key === 'window' ? '10' : null } },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);

    assert.ok(body.latencyMs, 'latencyMs field must be present');
    assert.strictEqual(body.latencyMs.p50, 120);
    assert.strictEqual(body.latencyMs.p95, 350);
    assert.strictEqual(body.failureRatio, 0.03);
    assert.strictEqual(body.metricsSampleCount, 100);
    assert.strictEqual(body.metricsWindow, 10);
});

test('vector-health should include metrics with default window when not specified', async () => {
    const response = await capturedHandler(
        { headers: { get: () => null }, query: { get: () => null } },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);

    assert.strictEqual(body.metricsWindow, 5);
    assert.strictEqual(body.metricsSampleCount, 100);
});

test('vector-health should return null metrics when no samples exist', async () => {
    vectorMetricsMocks.getVectorMetrics.mock.mockImplementationOnce(() => ({
        latencyMs: { p50: null, p95: null },
        failureRatio: null,
        sampleCount: 0,
        windowMinutes: 5,
    }));

    const response = await capturedHandler(
        { headers: { get: () => null }, query: { get: () => null } },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.latencyMs.p50, null);
    assert.strictEqual(body.latencyMs.p95, null);
    assert.strictEqual(body.failureRatio, null);
    assert.strictEqual(body.metricsSampleCount, 0);
});

test('vector-health should reject when Front Door validation fails', async () => {
    authUtilsMocks.validateFrontDoorId.mock.mockImplementationOnce(() => false);

    const response = await capturedHandler(
        { headers: { get: () => null }, query: { get: () => null } },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 403);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'Forbidden - Invalid Front Door ID');
});
