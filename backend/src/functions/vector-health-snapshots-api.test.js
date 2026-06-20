import { test, mock } from 'node:test';
import assert from 'node:assert';

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({ userId: 'test-user', userRoles: ['Director'] })),
};

const snapshotsServiceMocks = {
    listSnapshotsWithContent: mock.fn(async ({ days } = {}) => [
        { provider: 'pinecone', totalVectorCount: 100, indexFullness: 0.3, timestamp: '2026-06-20T10:00:00.000Z' },
        { provider: 'pinecone', totalVectorCount: 105, indexFullness: 0.31, timestamp: '2026-06-20T10:15:00.000Z' },
    ]),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/vector-health-snapshots.js', { namedExports: snapshotsServiceMocks });

let capturedHandler;
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                if (name === 'vector-health-snapshots') capturedHandler = options.handler;
            },
        },
    },
});

await import('./vector-health-snapshots-api.js');

test('vector-health-snapshots handler should be registered', () => {
    assert.strictEqual(typeof capturedHandler, 'function');
});

test('should return snapshots with default 7-day window', async () => {
    const response = await capturedHandler(
        { headers: { get: () => null }, query: { get: () => null } },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.count, 2);
    assert.strictEqual(body.data[0].totalVectorCount, 100);
});

test('should return snapshots with custom days parameter', async () => {
    const callCountBefore = snapshotsServiceMocks.listSnapshotsWithContent.mock.callCount();

    const response = await capturedHandler(
        { headers: { get: () => null }, query: { get: (key) => key === 'days' ? '30' : null } },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    const callIndex = snapshotsServiceMocks.listSnapshotsWithContent.mock.callCount() - 1;
    assert.strictEqual(snapshotsServiceMocks.listSnapshotsWithContent.mock.calls[callIndex].arguments[0].days, 30);
});

test('should reject invalid days parameter', async () => {
    const response = await capturedHandler(
        { headers: { get: () => null }, query: { get: (key) => key === 'days' ? '-1' : null } },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 400);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'INVALID_DAYS');
});

test('should reject when Front Door validation fails', async () => {
    authUtilsMocks.validateFrontDoorId.mock.mockImplementationOnce(() => false);

    const response = await capturedHandler(
        { headers: { get: () => null }, query: { get: () => null } },
        { error: mock.fn() }
    );

    assert.strictEqual(response.status, 403);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'Forbidden - Invalid Front Door ID');
});
