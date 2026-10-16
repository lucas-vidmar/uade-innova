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
    setStashedIdentity: mock.fn(() => {}),
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

// #468: 'authenticated' es el piso común de toda sesión (with-auth.js:116), no
// un rol. Mientras estuvo en la lista de permitidos, cualquier identidad con
// sesión —alumnado incluido— leía la salud del índice y el host del depósito.
//
// parseClientPrincipal se consulta dos veces por pedido: una en withAuth y otra
// en el handler, así que la identidad de prueba se fija como implementación
// vigente (no "once") y se restituye al terminar cada caso.
const DEFAULT_PRINCIPAL = () => ({ userId: 'test-user', userRoles: ['Director'] });

function asIdentity(principal) {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => principal);
}

function resetIdentity() {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(DEFAULT_PRINCIPAL);
}

test('vector-health should reject an authenticated student (#468)', async () => {
    asIdentity({ userId: 'alu-002', userRoles: ['authenticated', 'Alumno'] });
    try {
        const response = await capturedHandler(
            { headers: { get: () => null }, query: { get: () => null } },
            { error: mock.fn() }
        );

        assert.strictEqual(response.status, 403);
        const body = JSON.parse(response.body);
        assert.ok(!body.endpoint, 'no debe filtrar el host del depósito a una alumna');
        assert.ok(!body.stats, 'no debe filtrar el estado del índice a una alumna');
    } finally { resetIdentity(); }
});

test('vector-health should reject an anonymous principal', async () => {
    asIdentity(null);
    try {
        const response = await capturedHandler(
            { headers: { get: () => null }, query: { get: () => null } },
            { error: mock.fn() }
        );

        assert.strictEqual(response.status, 403);
    } finally { resetIdentity(); }
});

test('vector-health should allow Admin (its only consumer)', async () => {
    asIdentity({ userId: 'adm-001', userRoles: ['authenticated', 'Admin'] });
    try {
        const response = await capturedHandler(
            { headers: { get: () => null }, query: { get: () => null } },
            { error: mock.fn() }
        );

        assert.strictEqual(response.status, 200);
        assert.strictEqual(JSON.parse(response.body).provider, 'pinecone');
    } finally { resetIdentity(); }
});

test('vector-health should allow Docente', async () => {
    asIdentity({ userId: 'prof-001', userRoles: ['authenticated', 'Docente'] });
    try {
        const response = await capturedHandler(
            { headers: { get: () => null }, query: { get: () => null } },
            { error: mock.fn() }
        );

        assert.strictEqual(response.status, 200);
    } finally { resetIdentity(); }
});

test('vector-health should not leak the raw exception message on failure', async () => {
    asIdentity({ userId: 'adm-001', userRoles: ['authenticated', 'Admin'] });
    vectorStoreMocks.getIndexStats.mock.mockImplementationOnce(async () => {
        throw new Error('Pinecone host dashboard-edu-pilot.svc.aped-4627-b74a.pinecone.io unreachable');
    });
    try {
        const response = await capturedHandler(
            { headers: { get: () => null }, query: { get: () => null } },
            { error: mock.fn() }
        );

        assert.strictEqual(response.status, 500);
        const body = JSON.parse(response.body);
        assert.ok(!JSON.stringify(body).includes('pinecone.io'), 'no debe devolver el host en el error');
        assert.strictEqual(body.error, 'No se pudo obtener el estado del índice.');
    } finally { resetIdentity(); }
});


