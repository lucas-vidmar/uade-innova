import { test, mock } from 'node:test';
import assert from 'node:assert';

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({ oid: 'test-user', userRoles: ['Alumno'] })),
};

let consentStore = {};

const storageMocks = {
    getTableClient: mock.fn(() => {
        return {
            createTable: mock.fn(async () => {}),
            getEntity: mock.fn(async (pk, rk) => {
                const key = `${pk}:${rk}`;
                if (!consentStore[key]) {
                    const err = new Error('Not Found');
                    err.statusCode = 404;
                    throw err;
                }
                return consentStore[key];
            }),
            upsertEntity: mock.fn(async (entity) => {
                const key = `${entity.partitionKey}:${entity.rowKey}`;
                consentStore[key] = entity;
            }),
        };
    }),
    downloadFile: mock.fn(async () => {
        return Buffer.from('# Términos de Uso\n\nTexto de prueba para consentimiento.', 'utf-8');
    }),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });

const handlers = {};
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
            }
        }
    }
});

await import('./consent-api.js');

function makeContext() {
    return { log: mock.fn(), error: mock.fn(), warn: mock.fn() };
}

function makeRequest(headers = {}, body = null) {
    return {
        headers: {
            get: (key) => headers[key] || null,
        },
        json: async () => body,
    };
}

// Reset shared store before each test
test.beforeEach(() => { consentStore = {}; });

// ── GET /api/consent ────────────────────────────────────────────
test('get-consent returns accepted=false for new user', async () => {
    const ctx = makeContext();
    const req = makeRequest({ 'x-edu-uid': 'alu-001' });
    const res = await handlers['consent-get'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.accepted, false);
    assert.strictEqual(body.data.acceptedAt, null);
});

test('get-consent returns accepted=true after POST', async () => {
    const ctx = makeContext();
    const req = makeRequest({ 'x-edu-uid': 'alu-001', 'content-type': 'application/json' }, { accepted: true });

    // First POST consent
    const postRes = await handlers['consent-post'](req, ctx);
    assert.strictEqual(postRes.status, 200);
    const postBody = JSON.parse(postRes.body);
    assert.strictEqual(postBody.success, true);
    assert.strictEqual(postBody.data.saved, true);

    // Then GET consent
    const getRes = await handlers['consent-get'](req, ctx);
    assert.strictEqual(getRes.status, 200);
    const getBody = JSON.parse(getRes.body);
    assert.strictEqual(getBody.success, true);
    assert.strictEqual(getBody.data.accepted, true);
    assert.ok(getBody.data.acceptedAt);
    assert.strictEqual(getBody.data.version, 'v1');
});

// ── POST /api/consent ───────────────────────────────────────────
test('post-consent creates record and returns saved=true', async () => {
    const ctx = makeContext();
    const req = makeRequest({ 'x-edu-uid': 'alu-002', 'x-forwarded-for': '192.168.1.1' }, { accepted: true });
    const res = await handlers['consent-post'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.saved, true);
});

// ── GET /api/terms ──────────────────────────────────────────────
test('get-terms returns markdown content', async () => {
    const ctx = makeContext();
    const req = makeRequest({});
    const res = await handlers['terms-get'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.version, 'v1');
    assert.ok(body.data.content.includes('Términos de Uso'));
});

// ── Duplicate POST (idempotent) ─────────────────────────────────
test('post-consent is idempotent on duplicate POST', async () => {
    const ctx = makeContext();
    const req = makeRequest({ 'x-edu-uid': 'alu-003', 'content-type': 'application/json' }, { accepted: true });

    // First POST
    const res1 = await handlers['consent-post'](req, ctx);
    assert.strictEqual(res1.status, 200);

    // Second POST — update acceptedAt
    const res2 = await handlers['consent-post'](req, ctx);
    assert.strictEqual(res2.status, 200);

    // Both succeed
    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);
    assert.strictEqual(body1.data.saved, true);
    assert.strictEqual(body2.data.saved, true);
});

test('post-consent returns 400 when body missing accepted field', async () => {
    const ctx = makeContext();
    const req = makeRequest({ 'x-edu-uid': 'alu-004', 'content-type': 'application/json' }, {});
    const res = await handlers['consent-post'](req, ctx);
    assert.strictEqual(res.status, 400);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, 'CONSENT_NOT_ACCEPTED');
});
