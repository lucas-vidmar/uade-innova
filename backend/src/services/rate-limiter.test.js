process.env.RATE_LIMIT_CHAT_PER_MIN = '2';
process.env.RATE_LIMIT_INGEST_PER_MIN = '1';
process.env.RATE_LIMIT_GENERAL_PER_MIN = '1';
// El conteo service-wide sólo se enciende en los tests que lo prueban explícito.
delete process.env.RATE_LIMIT_SHARED;
process.env.AZURE_FUNCTIONS_ENVIRONMENT = '';

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const { createRateLimiter, createSharedRateLimiter, isSharedRateLimitEnabled } = await import('./rate-limiter.js');

function createClock() {
    let t = 0;
    return {
        now: () => t,
        set: (value) => { t = value; },
    };
}

function createTestLimiter(overrides = {}) {
    return createRateLimiter({ windowMs: 60000, tiers: { chat: 3, ingest: 2, general: 4 }, ...overrides });
}

const authUtilsMocks = {
    getAuthenticatedUser: mock.fn(() => ({ sanitizedId: 'user-1' })),
};
mock.module('./auth-utils.js', { namedExports: authUtilsMocks });

// Sesión opaca (Bearer) para la clave por persona (#455): el test decide la
// respuesta de getSession por test vía sessionImpl.
let sessionImpl = async () => null;
mock.module('./sessions-store.js', {
    namedExports: {
        getSession: mock.fn((token) => sessionImpl(token)),
        generateSessionToken: () => 'test-token',
        createSession: async () => ({ token: 'test-token', userId: 'test', expiresAt: '' }),
        deleteSession: async () => true,
        deleteSessionsForUser: async () => 0,
    },
});

// Table Storage falso con semántica de ETag (404 / 409 en create, 412 en
// update con etag desactualizado) para probar el contenedor compartido.
const tableState = { rows: new Map(), etagSeq: 0, down: false };

function entityKey(partitionKey, rowKey) {
    return `${partitionKey}\n${rowKey}`;
}

function createFakeTableClient() {
    return {
        createTable: async () => {
            if (tableState.down) {
                const err = new Error('storage down');
                err.statusCode = 503;
                throw err;
            }
            return true;
        },
        getEntity: async (partitionKey, rowKey) => {
            if (tableState.down) {
                const err = new Error('storage down');
                err.statusCode = 503;
                throw err;
            }
            const row = tableState.rows.get(entityKey(partitionKey, rowKey));
            if (!row) {
                const err = new Error('Not Found');
                err.statusCode = 404;
                throw err;
            }
            return { ...row };
        },
        createEntity: async (entity) => {
            if (tableState.down) {
                const err = new Error('storage down');
                err.statusCode = 503;
                throw err;
            }
            const key = entityKey(entity.partitionKey, entity.rowKey);
            if (tableState.rows.has(key)) {
                const err = new Error('Conflict');
                err.statusCode = 409;
                throw err;
            }
            tableState.rows.set(key, { ...entity, etag: `W/"${++tableState.etagSeq}"` });
        },
        updateEntity: async (entity, mode, options) => {
            if (tableState.down) {
                const err = new Error('storage down');
                err.statusCode = 503;
                throw err;
            }
            const key = entityKey(entity.partitionKey, entity.rowKey);
            const row = tableState.rows.get(key);
            if (!row) {
                const err = new Error('Not Found');
                err.statusCode = 404;
                throw err;
            }
            if (options?.etag && row.etag !== options.etag) {
                const err = new Error('Conflict');
                err.statusCode = 412;
                throw err;
            }
            tableState.rows.set(key, { ...entity, etag: `W/"${++tableState.etagSeq}"` });
        },
    };
}

mock.module('./storage.js', { namedExports: { getTableClient: mock.fn(() => createFakeTableClient()) } });

const { withRateLimit, resolveRateLimitKey, resolveRateLimitDecision } = await import('../middleware/with-rate-limit.js');

test('BELOW_LIMIT — requests under the tier limit are allowed', () => {
    const limiter = createTestLimiter();
    assert.deepEqual(limiter.check('uid:alu-1', 'chat'), { allowed: true });
    assert.deepEqual(limiter.check('uid:alu-1', 'chat'), { allowed: true });
    assert.deepEqual(limiter.check('uid:alu-1', 'chat'), { allowed: true });
});

test('OVER_LIMIT — exceeding the tier limit returns allowed=false with retryAfterSec', () => {
    const clock = createClock();
    const limiter = createTestLimiter({ tiers: { chat: 2, ingest: 2, general: 4 }, now: clock.now });
    clock.set(0);
    assert.equal(limiter.check('uid:alu-1', 'chat').allowed, true);
    clock.set(1000);
    assert.equal(limiter.check('uid:alu-1', 'chat').allowed, true);
    clock.set(2000);
    const result = limiter.check('uid:alu-1', 'chat');
    assert.equal(result.allowed, false);
    assert.equal(typeof result.retryAfterSec, 'number');
    assert.equal(result.retryAfterSec, 58);
});

test('SLIDING_BOUNDARY — requests straddling the window edge use a sliding window', () => {
    const clock = createClock();
    const limiter = createTestLimiter({ tiers: { chat: 2, ingest: 2, general: 4 }, now: clock.now });
    clock.set(0);
    assert.equal(limiter.check('uid:alu-1', 'chat').allowed, true);
    clock.set(1000);
    assert.equal(limiter.check('uid:alu-1', 'chat').allowed, true);
    clock.set(1001);
    assert.equal(limiter.check('uid:alu-1', 'chat').allowed, false);
    clock.set(61000);
    assert.equal(limiter.check('uid:alu-1', 'chat').allowed, true);
});

test('RETRY_AFTER_ZERO — retryAfterSec clamps to a minimum of 1 second', () => {
    const clock = createClock();
    const limiter = createTestLimiter({ windowMs: 1000, tiers: { chat: 1, ingest: 1, general: 4 }, now: clock.now });
    clock.set(0);
    assert.equal(limiter.check('uid:alu-1', 'chat').allowed, true);
    clock.set(999);
    const result = limiter.check('uid:alu-1', 'chat');
    assert.equal(result.allowed, false);
    assert.equal(result.retryAfterSec, 1);
});

test('UNKNOWN_TIER — unknown tier falls back to the general tier limit', () => {
    const limiter = createTestLimiter();
    for (let i = 0; i < 4; i++) {
        assert.equal(limiter.check('uid:alu-1', 'unknown-endpoint').allowed, true);
    }
    assert.equal(limiter.check('uid:alu-1', 'unknown-endpoint').allowed, false);
});

test('INGEST_LIMIT — ingest tier enforces its own limit', () => {
    const limiter = createTestLimiter();
    assert.equal(limiter.check('uid:doc-1', 'ingest').allowed, true);
    assert.equal(limiter.check('uid:doc-1', 'ingest').allowed, true);
    assert.equal(limiter.check('uid:doc-1', 'ingest').allowed, false);
});

test('buckets are isolated per key', () => {
    const limiter = createTestLimiter({ tiers: { chat: 1, ingest: 2, general: 4 } });
    assert.equal(limiter.check('uid:a', 'chat').allowed, true);
    assert.equal(limiter.check('uid:a', 'chat').allowed, false);
    assert.equal(limiter.check('uid:b', 'chat').allowed, true);
});

test('TIER_ISOLATION — the same key has independent sliding windows per tier', () => {
    const limiter = createTestLimiter({ tiers: { chat: 2, ingest: 1, general: 4 } });
    assert.equal(limiter.check('uid:doc-1', 'chat').allowed, true);
    assert.equal(limiter.check('uid:doc-1', 'chat').allowed, true);
    assert.equal(limiter.check('uid:doc-1', 'ingest').allowed, true);
    assert.equal(limiter.check('uid:doc-1', 'ingest').allowed, false);
    assert.equal(limiter.check('uid:doc-1', 'chat').allowed, false);
});

test('MAX_BUCKETS — expired buckets are swept when the map approaches the cap', () => {
    const clock = createClock();
    const limiter = createTestLimiter({ maxBuckets: 5, windowMs: 60000, tiers: { chat: 1, ingest: 1, general: 4 }, now: clock.now });
    clock.set(0);
    for (let i = 0; i < 5; i++) {
        assert.equal(limiter.check(`uid:user-${i}`, 'chat').allowed, true);
    }
    clock.set(61000);
    assert.equal(limiter.check('uid:new-user', 'chat').allowed, true);
});

test('ANONYMOUS_NO_UID — no principal falls back to the client IP key', async () => {
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'anonymous' }));
    const request = { headers: { get: (name) => (name === 'x-forwarded-for' ? '203.0.113.9' : null) } };
    assert.equal(await resolveRateLimitKey(request), 'ip:203.0.113.9');
    assert.equal(await resolveRateLimitKey({ headers: { get: () => null } }), 'ip:unknown');
});

test('ANONYMOUS_NO_UID — client IP resolved from first x-forwarded-for value or x-azure-clientip', async () => {
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'anonymous' }));
    assert.equal(
        await resolveRateLimitKey({ headers: { get: (name) => (name === 'x-forwarded-for' ? '198.51.100.7, 10.0.0.1' : null) } }),
        'ip:198.51.100.7'
    );
    assert.equal(
        await resolveRateLimitKey({ headers: { get: (name) => (name === 'x-azure-clientip' ? '192.0.2.4' : null) } }),
        'ip:192.0.2.4'
    );
});

test('authenticated user is keyed by sanitized uid', async () => {
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'alumno-1' }));
    assert.equal(await resolveRateLimitKey({ headers: { get: () => null } }), 'uid:alumno-1');
});

test('withRateLimit allows requests under the tier limit and invokes the inner handler', async () => {
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'pass-1' }));
    const handler = mock.fn(async () => ({ status: 200, body: 'ok' }));
    const wrapped = withRateLimit(handler, 'chat');
    const response = await wrapped({ headers: { get: () => null } }, { log: () => {} });
    assert.equal(handler.mock.callCount(), 1);
    assert.equal(response.status, 200);
});

test('withRateLimit returns structured 429 with Retry-After when the tier is exceeded', async () => {
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'abu-1' }));
    const handler = async () => ({ status: 200, body: 'ok' });
    const wrapped = withRateLimit(handler, 'chat');
    await wrapped({ headers: { get: () => null } }, { log: () => {} });
    await wrapped({ headers: { get: () => null } }, { log: () => {} });
    const response = await wrapped({ headers: { get: () => null } }, { log: () => {} });
    assert.equal(response.status, 429);
    assert.equal(typeof response.headers['Retry-After'], 'string');
    assert.equal(Number(response.headers['Retry-After']) >= 1, true);
    const body = JSON.parse(response.body);
    assert.equal(body.errorCategory, 'RATE_LIMIT');
    assert.equal(body.code, 'RATE_LIMIT_EXCEEDED');
});

test('OPTIONS_PREFLIGHT — OPTIONS requests bypass the rate limiter', async () => {
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'opt-1' }));
    const handler = mock.fn(async () => ({ status: 204, body: '' }));
    const wrapped = withRateLimit(handler, 'chat');
    const response = await wrapped({ method: 'OPTIONS', headers: { get: () => null } }, { log: () => {} });
    assert.equal(response.status, 204);
    assert.equal(handler.mock.callCount(), 1);
});

// ─── #455: clave por persona + conteo service-wide ───────────────────────

test('SESSION_UID — un Bearer de sesión se agrupa por uid, no por la IP compartida', async () => {
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'anonymous' }));
    sessionImpl = async (token) => (token === 'valid-token' ? { userId: 'adm-001' } : null);
    try {
        const request = {
            headers: {
                get: (name) => {
                    if (name === 'authorization') return 'Bearer valid-token';
                    if (name === 'x-forwarded-for') return '203.0.113.9';
                    return null;
                },
            },
        };
        assert.equal(await resolveRateLimitKey(request), 'uid:adm_001');
    } finally {
        sessionImpl = async () => null;
    }
});

test('SESSION_FALLBACK — sin sesión válida (o storage caído) la clave cae a la IP', async () => {
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'anonymous' }));
    sessionImpl = async () => null;
    const request = {
        headers: {
            get: (name) => {
                if (name === 'authorization') return 'Bearer expired-token';
                if (name === 'x-forwarded-for') return '198.51.100.7';
                return null;
            },
        },
    };
    assert.equal(await resolveRateLimitKey(request), 'ip:198.51.100.7');
});

test('SHARED_FLAG — el conteo service-wide sólo se enciende en Production o con flag explícito', () => {
    delete process.env.RATE_LIMIT_SHARED;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = '';
    assert.equal(isSharedRateLimitEnabled(), false);
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    assert.equal(isSharedRateLimitEnabled(), true);
    process.env.RATE_LIMIT_SHARED = 'false';
    assert.equal(isSharedRateLimitEnabled(), false);
    process.env.RATE_LIMIT_SHARED = 'true';
    assert.equal(isSharedRateLimitEnabled(), true);
    delete process.env.RATE_LIMIT_SHARED;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = '';
});

test('SHARED_CONCURRENCY — la ráfaga concurrente respeta el tope service-wide', async () => {
    tableState.rows.clear();
    const shared = createSharedRateLimiter({ tiers: { chat: 3, general: 60 }, windowMs: 60000, maxAttempts: 40 });
    const results = await Promise.all(
        Array.from({ length: 40 }, () => shared.check('uid:adm-001', 'chat'))
    );
    const allowed = results.filter((r) => r.allowed).length;
    assert.equal(allowed, 3, 'con 40 en vuelo sólo el tope del tier debe entrar');
    const denied = results.filter((r) => !r.allowed);
    assert.equal(denied.length, 37);
    assert.equal(typeof denied[0].retryAfterSec, 'number');
    assert.equal(denied[0].retryAfterSec >= 1, true);
});

test('SHARED_WINDOW_ROLL — al pasar de ventana el contador previo pesa y después se libera', async () => {
    tableState.rows.clear();
    let nowMs = 0;
    const shared = createSharedRateLimiter({ tiers: { chat: 2, general: 60 }, windowMs: 1000, now: () => nowMs, maxAttempts: 10 });
    assert.equal((await shared.check('uid:alu-1', 'chat')).allowed, true);
    assert.equal((await shared.check('uid:alu-1', 'chat')).allowed, true);
    assert.equal((await shared.check('uid:alu-1', 'chat')).allowed, false);
    // Nueva ventana, recién empezada: la anterior pesa 1 → sigue negando.
    nowMs = 1000;
    assert.equal((await shared.check('uid:alu-1', 'chat')).allowed, false);
    // Casi toda la ventana corrida: el peso de la anterior cae a ~0 → entra.
    nowMs = 1990;
    assert.equal((await shared.check('uid:alu-1', 'chat')).allowed, true);
});

test('SHARED_STORAGE_DOWN — storage caído lanza para que el caller caiga a memoria', async () => {
    tableState.rows.clear();
    tableState.down = true;
    try {
        const shared = createSharedRateLimiter({ tiers: { chat: 3 } });
        await assert.rejects(() => shared.check('uid:x', 'chat'));

        // En el middleware: fallback a la memoria de la instancia, aún así 429 anunciado.
        process.env.RATE_LIMIT_SHARED = 'true';
        authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'down-user' }));
        const handler = async () => ({ status: 200, body: 'ok' });
        const wrapped = withRateLimit(handler, 'chat');
        const ctx = { log: () => {} };
        assert.equal((await wrapped({ headers: { get: () => null } }, ctx)).status, 200);
        assert.equal((await wrapped({ headers: { get: () => null } }, ctx)).status, 200);
        const denied = await wrapped({ headers: { get: () => null } }, ctx);
        assert.equal(denied.status, 429);
        assert.equal(denied.headers['Retry-After'] !== undefined, true);
    } finally {
        delete process.env.RATE_LIMIT_SHARED;
        tableState.down = false;
    }
});

test('SHARED_MIDDLEWARE — la ráfaga concurrente recibe 429 anunciado desde el almacén compartido', async () => {
    tableState.rows.clear();
    process.env.RATE_LIMIT_SHARED = 'true';
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'burst-user' }));
    try {
        const decision = await resolveRateLimitDecision({ headers: { get: () => null } }, 'chat');
        assert.equal(decision.scope, 'shared');
        assert.equal(decision.allowed, true);

        tableState.rows.clear(); // arrancar la ráfaga desde cero
        const handler = mock.fn(async () => ({ status: 200, body: 'ok' }));
        const wrapped = withRateLimit(handler, 'chat');
        const ctx = { log: () => {} };
        const responses = await Promise.all(
            Array.from({ length: 10 }, () => wrapped({ headers: { get: () => null } }, ctx))
        );
        const allowed = responses.filter((r) => r.status === 200).length;
        const deniedResponses = responses.filter((r) => r.status === 429);
        assert.equal(allowed, 2, 'chat = 2/min según la env de este test');
        assert.equal(deniedResponses.length, 8);
        assert.equal(deniedResponses[0].headers['Retry-After'] !== undefined, true);
        const body = JSON.parse(deniedResponses[0].body);
        assert.equal(body.errorCategory, 'RATE_LIMIT');
        assert.equal(body.code, 'RATE_LIMIT_EXCEEDED');
    } finally {
        delete process.env.RATE_LIMIT_SHARED;
        tableState.rows.clear();
    }
});
