/**
 * caudal-api.test.js — la superficie donde se lee qué se degradó (#458)
 */
process.env.RATE_LIMIT_CHAT_PER_MIN = '5';
process.env.RATE_LIMIT_INGEST_PER_MIN = '2';
process.env.RATE_LIMIT_GENERAL_PER_MIN = '5';
process.env.RATE_LIMIT_ESSENTIAL_PER_MIN = '10';
process.env.RATE_LIMIT_SERVICE_PER_MIN = '30';
process.env.RATE_LIMIT_RESERVE_PCT = '10';
process.env.RATE_LIMIT_ALERT_THRESHOLD_PCT = '80';
process.env.RATE_LIMIT_SHARED = 'true';
process.env.AZURE_FUNCTIONS_ENVIRONMENT = '';

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const tableState = { tables: new Map(), etagSeq: 0 };

function rowsFor(name) {
    if (!tableState.tables.has(name)) tableState.tables.set(name, new Map());
    return tableState.tables.get(name);
}

function createFakeTableClient(name) {
    const rows = () => rowsFor(name || 'default');
    return {
        createTable: async () => true,
        getEntity: async (partitionKey, rowKey) => {
            const row = rows().get(`${partitionKey}\n${rowKey}`);
            if (!row) {
                const err = new Error('Not Found');
                err.statusCode = 404;
                throw err;
            }
            return { ...row };
        },
        createEntity: async (entity) => {
            const key = `${entity.partitionKey}\n${entity.rowKey}`;
            if (rows().has(key)) {
                const err = new Error('Conflict');
                err.statusCode = 409;
                throw err;
            }
            rows().set(key, { ...entity, etag: `W/"${++tableState.etagSeq}"` });
        },
        updateEntity: async (entity, mode, options) => {
            const key = `${entity.partitionKey}\n${entity.rowKey}`;
            const row = rows().get(key);
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
            rows().set(key, { ...entity, etag: `W/"${tableState.etagSeq += 1}"` });
        },
        async *listEntities(options = {}) {
            const filter = options?.queryOptions?.filter || '';
            const match = /PartitionKey eq '([^']+)'/.exec(filter);
            for (const row of rows().values()) {
                if (match && row.partitionKey !== match[1]) continue;
                yield { ...row };
            }
        },
    };
}

const authState = { frontDoorValid: true, principal: { userId: 'dir-001', userRoles: ['Director'] } };

mock.module('../services/storage.js', {
    namedExports: { getTableClient: mock.fn((name) => createFakeTableClient(name)) },
});

mock.module('../services/auth-utils.js', {
    namedExports: {
        validateFrontDoorId: () => authState.frontDoorValid,
        parseClientPrincipal: () => authState.principal,
        setStashedIdentity: () => {},
        getAuthenticatedUser: (request) => ({
            sanitizedId: request?.headers?.get?.('x-test-uid') || 'anonymous',
            userId: request?.headers?.get?.('x-test-uid') || 'anonymous',
        }),
    },
});

mock.module('../services/sessions-store.js', {
    namedExports: {
        getSession: async () => null,
        generateSessionToken: () => 'token',
        createSession: async () => ({ token: 'token', userId: 'test', expiresAt: '' }),
        deleteSession: async () => true,
        deleteSessionsForUser: async () => 0,
    },
});

const handlers = {};
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
            },
        },
    },
});

await import('./caudal-api.js');
const { withRateLimit, _resetRateLimitForTests } = await import('../middleware/with-rate-limit.js');
const { _resetCaudalEventsForTests } = await import('../services/caudal-events.js');

function request({ url = 'https://pilot/api/dashboard-admin/caudal', uid = 'dir-001' } = {}) {
    const query = new URL(url).searchParams;
    return {
        method: 'GET',
        url,
        params: {},
        query: { get: (name) => query.get(name) },
        headers: { get: (name) => (String(name).toLowerCase() === 'x-test-uid' ? uid : null) },
    };
}

const context = () => ({ correlationId: 'corr-op', log: () => {}, warn: () => {}, error: () => {} });

function resetAll() {
    tableState.tables.clear();
    tableState.etagSeq = 0;
    _resetCaudalEventsForTests();
    _resetRateLimitForTests();
    authState.frontDoorValid = true;
    authState.principal = { userId: 'dir-001', userRoles: ['Director'] };
}

test('SUPERFICIE — sin carga informa topes, reserva y umbral declarados', async () => {
    resetAll();
    const response = await handlers['caudal-operations'](request(), context());
    assert.equal(response.status, 200);
    const { data } = JSON.parse(response.body);
    assert.equal(data.state, 'ok');
    assert.equal(data.limits.service.totalPerWindow, 30);
    assert.equal(data.limits.service.reservePct, 10);
    assert.equal(data.limits.service.interactive, 27);
    assert.equal(data.limits.service.essential, 3);
    assert.equal(data.limits.service.alertThresholdPct, 80);
    assert.equal(data.limits.identityTiers.chat, 5);
    assert.equal(data.service.interactive.used, 0);
    assert.equal(data.service.interactive.limit, 27);
    assert.equal(data.service.interactive.state, 'ok');
    assert.equal(data.service.essential.limit, 3);
    // Declara qué rutas están bajo la reserva: es la política, no una promesa.
    assert.equal(data.limits.essentialRoutes.some((r) => r.pattern.includes('material-download')), true);
    assert.equal(data.events.total, 0);
});

test('SUPERFICIE — refleja el caudal consumido y el cruce de umbral sin reproducir la carga', async () => {
    resetAll();
    const chat = withRateLimit(async () => ({ status: 200, body: '{}' }), 'chat');
    for (let i = 0; i < 23; i += 1) {
        const uid = `alu-${String(i).padStart(3, '0')}`;
        await chat({ method: 'POST', url: 'https://pilot/api/rag-query', headers: { get: (n) => (n === 'x-test-uid' ? uid : null) } }, context());
    }

    const response = await handlers['caudal-operations'](request(), context());
    const { data } = JSON.parse(response.body);
    assert.equal(data.service.interactive.used, 23);
    assert.equal(data.service.interactive.state, 'umbral');
    assert.equal(data.state, 'umbral');
    assert.equal(data.events.thresholds, 1, 'el umbral quedó registrado una sola vez');
    assert.equal(data.events.rows.some((r) => r.kind === 'threshold'), true);
});

test('SUPERFICIE — distingue el tope del servicio de la reserva agotada', async () => {
    resetAll();
    const chat = withRateLimit(async () => ({ status: 200, body: '{}' }), 'chat');
    const req = (uid) => ({ method: 'POST', url: 'https://pilot/api/rag-query', headers: { get: (n) => (n === 'x-test-uid' ? uid : null) } });
    for (let i = 0; i < 27; i += 1) await chat(req(`alu-${i}`), context());
    await chat(req('alu-late'), context());

    const { data } = JSON.parse((await handlers['caudal-operations'](request(), context())).body);
    assert.equal(data.state, 'tope');
    assert.equal(data.service.interactive.state, 'tope');
    assert.equal(data.service.essential.state, 'ok');
    assert.equal(data.events.denials >= 1, true);
    assert.equal(data.events.byReason.SERVICE_CAP >= 1, true);

    const essential = withRateLimit(async () => ({ status: 200, body: '{}' }));
    const essentialReq = () => ({ method: 'GET', url: 'https://pilot/api/material-download?subjectId=s1&materialId=m1', headers: { get: () => null } });
    for (let i = 0; i < 4; i += 1) await essential(essentialReq(), context());

    const after = JSON.parse((await handlers['caudal-operations'](request(), context())).body).data;
    assert.equal(after.service.essential.state, 'reserva-agotada');
    assert.equal(after.state, 'tope');
    assert.equal(after.events.byReason.RESERVE_EXHAUSTED, 1);
});

test('SUPERFICIE — exige operador y Front Door válido', async () => {
    resetAll();
    authState.principal = { userId: 'alu-003', userRoles: ['Alumno'] };
    const forbidden = await handlers['caudal-operations'](request(), context());
    assert.equal(forbidden.status, 403);

    authState.principal = { userId: 'dir-001', userRoles: ['Director'] };
    authState.frontDoorValid = false;
    const noFrontDoor = await handlers['caudal-operations'](request(), context());
    assert.equal(noFrontDoor.status, 403);
    assert.equal(JSON.parse(noFrontDoor.body).error.code, 'FRONTDOOR_INVALID');
});
