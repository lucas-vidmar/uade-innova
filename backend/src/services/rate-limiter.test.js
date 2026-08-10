process.env.RATE_LIMIT_CHAT_PER_MIN = '2';
process.env.RATE_LIMIT_INGEST_PER_MIN = '1';
process.env.RATE_LIMIT_GENERAL_PER_MIN = '1';

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const { createRateLimiter } = await import('./rate-limiter.js');

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

const { withRateLimit, resolveRateLimitKey } = await import('../middleware/with-rate-limit.js');

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

test('ANONYMOUS_NO_UID — no principal falls back to the client IP key', () => {
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'anonymous' }));
    const request = { headers: { get: (name) => (name === 'x-forwarded-for' ? '203.0.113.9' : null) } };
    assert.equal(resolveRateLimitKey(request), 'ip:203.0.113.9');
    assert.equal(resolveRateLimitKey({ headers: { get: () => null } }), 'ip:unknown');
});

test('ANONYMOUS_NO_UID — client IP resolved from first x-forwarded-for value or x-azure-clientip', () => {
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'anonymous' }));
    assert.equal(
        resolveRateLimitKey({ headers: { get: (name) => (name === 'x-forwarded-for' ? '198.51.100.7, 10.0.0.1' : null) } }),
        'ip:198.51.100.7'
    );
    assert.equal(
        resolveRateLimitKey({ headers: { get: (name) => (name === 'x-azure-clientip' ? '192.0.2.4' : null) } }),
        'ip:192.0.2.4'
    );
});

test('authenticated user is keyed by sanitized uid', () => {
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ sanitizedId: 'alumno-1' }));
    assert.equal(resolveRateLimitKey({ headers: { get: () => null } }), 'uid:alumno-1');
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
