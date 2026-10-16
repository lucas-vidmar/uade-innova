import { test, mock } from 'node:test';
import assert from 'node:assert';

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ oid: 'test-user', userRoles: ['Alumno'] })),
    getAuthenticatedUser: mock.fn(() => null),
    // Mirrors the real resolveIdentityKey: session identity first, then headers.
    resolveIdentityKey: mock.fn((request, context) => context?.user?.userId || request.headers.get('x-edu-uid') || 'pilot-user'),
    // Mirrors the real hasResolvedIdentity: nobody without a real identity (#434).
    hasResolvedIdentity: mock.fn((user) => {
        if (!user) return false;
        const role = user.role;
        if (!role || role === 'Anonymous' || role === 'Denied') return false;
        const id = user.userId || user.id;
        return Boolean(id) && id !== 'anonymous' && id !== 'pilot-user';
    }),
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

function makeContext(userId = 'alu-001') {
    return { log: mock.fn(), error: mock.fn(), warn: mock.fn(), user: { userId, role: 'Alumno' } };
}

// #434: sin identidad resuelta no hay consentimiento que leer ni que registrar.
function makeAnonymousContext() {
    return { log: mock.fn(), error: mock.fn(), warn: mock.fn(), user: null };
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
    assert.strictEqual(body.error.code, 'INVALID_CONSENT');
});

// ── #327 regression: session-token identity (no oid) ──────────────
// Session principals resolved by withAuth carry userId but NO oid. Consent
// must be keyed by that session identity — previously `principal?.oid`
// collapsed every session user onto the literal 'pilot-user' row, so
// rag-query/quiz gates (which check the session userId) 403'd despite
// GET /api/consent showing accepted:true.
test('consent is keyed by session identity, not principal oid (#327)', async () => {
    const defaultPrincipal = () => ({ oid: 'test-user', userRoles: ['Alumno'] });
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation((request) => {
        if (request?.headers?.get?.('x-session-user')) {
            const uid = request.headers.get('x-session-user');
            return { userId: uid, userDetails: `${uid}@uade.edu.ar`, userRoles: ['authenticated', 'Alumno'] };
        }
        return defaultPrincipal();
    });

    try {
        const ctx = makeContext('alu-005');
        const postReq = makeRequest({ 'x-session-user': 'alu-005', 'content-type': 'application/json' }, { accepted: true });
        const postRes = await handlers['consent-post'](postReq, ctx);
        assert.strictEqual(postRes.status, 200);

        assert.ok(consentStore['alu-005:consent'], 'consent must be stored under the session userId');
        assert.strictEqual(consentStore['alu-005:consent'].accepted, 'true');
        assert.ok(!consentStore['pilot-user:consent'], 'consent must NOT collapse onto the pilot-user row');

        const getRes = await handlers['consent-get'](makeRequest({ 'x-session-user': 'alu-005' }), makeContext('alu-005'));
        assert.strictEqual(getRes.status, 200);
        assert.strictEqual(JSON.parse(getRes.body).data.accepted, true);
    } finally {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(defaultPrincipal);
    }
});

// ── #434: sin sesión no hay consentimiento ──────────────────────
test('#434: un cliente sin identidad no lee el consentimiento (401, sin tocar la fila compartida)', async () => {
    // Sin token y sin principal (el caso real del piloto: mock auth cerrado).
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => null);
    try {
        // La fila compartida existe con accepted=true: no debe alcanzarle a nadie sin sesión.
        consentStore['pilot-user:consent'] = {
            partitionKey: 'pilot-user', rowKey: 'consent',
            accepted: 'true', acceptedAt: '2026-09-18T05:40:07.254Z', version: 'v1',
        };
        const res = await handlers['consent-get'](makeRequest({}), makeAnonymousContext());
        assert.strictEqual(res.status, 401, `esperaba 401, llegó ${res.status}: ${res.body}`);
        assert.strictEqual(JSON.parse(res.body).error.code, 'AUTH_REQUIRED');
        delete consentStore['pilot-user:consent'];
    } finally {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ oid: 'test-user', userRoles: ['Alumno'] }));
    }
});

test('#434: un cliente sin identidad no escribe el consentimiento (401, sin tocar la fila compartida)', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => null);
    try {
        const res = await handlers['consent-post'](
            makeRequest({ 'content-type': 'application/json' }, { accepted: true }),
            makeAnonymousContext()
        );
        assert.strictEqual(res.status, 401, `esperaba 401, llegó ${res.status}: ${res.body}`);
        assert.strictEqual(JSON.parse(res.body).error.code, 'AUTH_REQUIRED');
        assert.ok(!consentStore['pilot-user:consent'], 'no debe escribirse la fila compartida');
    } finally {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ oid: 'test-user', userRoles: ['Alumno'] }));
    }
});
