/**
 * with-rate-limit.caudal.test.js — tope de servicio, reserva, umbral y registro (#458)
 *
 * Ejercita la decisión completa del middleware: los dos ejes (identidad y
 * servicio), la reserva de lo esencial, el aviso de umbral y el registro que
 * permite reconstruir la noche. Todo con el almacén simulado en memoria; no
 * se toca ninguna instancia real.
 */
process.env.RATE_LIMIT_CHAT_PER_MIN = '5';
process.env.RATE_LIMIT_INGEST_PER_MIN = '2';
process.env.RATE_LIMIT_GENERAL_PER_MIN = '5';
process.env.RATE_LIMIT_ESSENTIAL_PER_MIN = '10';
// Tope de servicio: 30 por ventana con 10% reservado → 27 interactivo + 3 esencial.
process.env.RATE_LIMIT_SERVICE_PER_MIN = '30';
process.env.RATE_LIMIT_RESERVE_PCT = '10';
process.env.RATE_LIMIT_ALERT_THRESHOLD_PCT = '80';
process.env.RATE_LIMIT_SHARED = 'true';
process.env.AZURE_FUNCTIONS_ENVIRONMENT = '';

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// ─── Almacén falso (contadores + registro), por tabla ────────────────────
const tableState = { tables: new Map(), etagSeq: 0, down: false };

function rowsFor(tableName) {
    if (!tableState.tables.has(tableName)) tableState.tables.set(tableName, new Map());
    return tableState.tables.get(tableName);
}

function resetTables() {
    tableState.tables.clear();
    tableState.etagSeq = 0;
    tableState.down = false;
}

function entityKey(partitionKey, rowKey) {
    return `${partitionKey}\n${rowKey}`;
}

function createFakeTableClient(tableName) {
    const rows = () => rowsFor(tableName);
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
            const row = rows().get(entityKey(partitionKey, rowKey));
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
            if (rows().has(key)) {
                const err = new Error('Conflict');
                err.statusCode = 409;
                throw err;
            }
            rows().set(key, { ...entity, etag: `W/"${++tableState.etagSeq}"` });
        },
        updateEntity: async (entity, mode, options) => {
            if (tableState.down) {
                const err = new Error('storage down');
                err.statusCode = 503;
                throw err;
            }
            const key = entityKey(entity.partitionKey, entity.rowKey);
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
            rows().set(key, { ...entity, etag: `W/"${++tableState.etagSeq}"` });
        },
        async *listEntities(options = {}) {
            if (tableState.down) {
                const err = new Error('storage down');
                err.statusCode = 503;
                throw err;
            }
            const filter = options?.queryOptions?.filter || '';
            const match = /PartitionKey eq '([^']+)'/.exec(filter);
            for (const row of rows().values()) {
                if (match && row.partitionKey !== match[1]) continue;
                yield { ...row };
            }
        },
    };
}

mock.module('../services/storage.js', {
    namedExports: { getTableClient: mock.fn((name) => createFakeTableClient(name || 'default')) },
});

mock.module('../services/auth-utils.js', {
    namedExports: {
        getAuthenticatedUser: mock.fn((request) => ({
            sanitizedId: request?.headers?.get?.('x-test-uid') || 'anonymous',
            userId: request?.headers?.get?.('x-test-uid') || 'anonymous',
        })),
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

const { withRateLimit, resolveCaudalDecision, readServiceUsage, _resetRateLimitForTests } =
    await import('./with-rate-limit.js');
const { createSharedRateLimiter } = await import('../services/rate-limiter.js');
const { listCaudalEvents, _resetCaudalEventsForTests } = await import('../services/caudal-events.js');
const { classifyCaudal, serviceCaps, CAUDAL_CLASS } = await import('../services/caudal-policy.js');

function request({ uid = 'alu-001', method = 'POST', url = 'https://pilot/api/rag-query' } = {}) {
    return {
        method,
        url,
        headers: {
            get: (name) => {
                const key = String(name).toLowerCase();
                if (key === 'x-test-uid') return uid;
                return null;
            },
        },
    };
}

function context() {
    return {
        correlationId: 'corr-test',
        log: () => {},
        warn: () => {},
        error: () => {},
    };
}

function resetAll() {
    resetTables();
    _resetCaudalEventsForTests();
    _resetRateLimitForTests();
}

const okHandler = async () => ({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' });

// ─── El hueco: el tope por identidad no acota el agregado ────────────────

test('SIN_TOPE_DE_SERVICIO — 40 identidades con su tope por persona pasan todas (el hueco de #570)', async () => {
    resetAll();
    // Lo que había: una entidad por (tier, clave) por persona, sin contador del
    // agregado. 40 personas × 5 = 200 pedidos en la misma ventana y ninguno ve
    // el pico de las demás.
    const shared = createSharedRateLimiter({ tiers: { chat: 5 }, windowMs: 60000, maxAttempts: 40 });
    const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
            Array.from({ length: 5 }, () => shared.check(`uid:alu-${String(i).padStart(3, '0')}`, 'chat')))
            .flat()
    );
    const allowed = results.filter((r) => r.allowed).length;
    assert.equal(allowed, 200, 'sin tope de servicio, el agregado son N × tope por persona');
});

test('SERVICE_CAP — con el tope de servicio, el agregado se detiene en el techo', async () => {
    resetAll();
    const caps = serviceCaps();
    assert.equal(caps.total, 30);
    assert.equal(caps.essential, 3);
    assert.equal(caps.interactive, 27);

    const wrapped = withRateLimit(okHandler, 'chat');
    const responses = [];
    for (let i = 0; i < 40; i += 1) {
        const uid = `alu-${String(i).padStart(3, '0')}`;
        for (let j = 0; j < 5; j += 1) {
            responses.push(await wrapped(request({ uid }), context()));
        }
    }

    const allowed = responses.filter((r) => r.status === 200).length;
    const denied = responses.filter((r) => r.status === 429);
    assert.equal(allowed, 27, 'sólo el techo interactivo pasa, aunque cada persona esté bajo su tope');
    assert.equal(denied.length, 173);
    const body = JSON.parse(denied[0].body);
    assert.equal(body.caudal.reason, 'SERVICE_CAP');
    assert.equal(body.caudal.limit, 27);
    assert.equal(body.caudal.serviceTotal, 30);
    assert.equal(body.caudal.reserve, 3);
    assert.equal(Number(denied[0].headers['Retry-After']) >= 1, true);
});

test('RESERVA — el pico del asistente no se come la capacidad de lo esencial', async () => {
    resetAll();
    const chat = withRateLimit(okHandler, 'chat');
    // 27 interactivos: el techo interactivo queda lleno.
    const chatResponses = [];
    for (let i = 0; i < 27; i += 1) chatResponses.push(await chat(request({ uid: `alu-${i}` }), context()));
    assert.equal(chatResponses.filter((r) => r.status === 200).length, 27);
    assert.equal((await chat(request({ uid: 'alu-late' }), context())).status, 429);

    // Lo esencial sigue entrando: la reserva es suya.
    const essential = withRateLimit(okHandler);
    const essentialRequest = () => request({ uid: 'alu-003', method: 'GET', url: 'https://pilot/api/material-download?subjectId=s1&materialId=m1' });
    const essentialResponses = [];
    for (let i = 0; i < 3; i += 1) essentialResponses.push(await essential(essentialRequest(), context()));
    assert.equal(essentialResponses.filter((r) => r.status === 200).length, 3, 'la reserva atiende lo esencial');
    essentialResponses.forEach((r) => assert.equal(r.headers['X-Caudal-Class'], 'essential'));

    // Y más allá de la reserva, lo esencial también se topa —y se distingue del tope interactivo.
    const beyond = await essential(essentialRequest(), context());
    assert.equal(beyond.status, 429);
    assert.equal(JSON.parse(beyond.body).caudal.reason, 'RESERVE_EXHAUSTED');
});

test('IDENTITY_CAP — el eje por identidad sigue vigente y no consume caudal del servicio', async () => {
    resetAll();
    const wrapped = withRateLimit(okHandler, 'chat');
    const responses = [];
    for (let i = 0; i < 7; i += 1) responses.push(await wrapped(request({ uid: 'alu-004' }), context()));
    const denied = responses.filter((r) => r.status === 429);
    assert.equal(denied.length, 2, 'chat = 5 por persona');
    assert.equal(JSON.parse(denied[0].body).caudal.reason, 'IDENTITY_CAP');

    // El servicio sólo contó las 5 admitidas de esa persona.
    const usage = await readServiceUsage(CAUDAL_CLASS.INTERACTIVE);
    assert.equal(usage.used, 5, 'las denegadas por identidad no gastan caudal del servicio');
});

// ─── Aviso al operador ──────────────────────────────────────────────────

test('UMBRAL — se anota una sola vez por ventana y clase, aunque el umbral se cruce muchas veces', async () => {
    resetAll();
    const wrapped = withRateLimit(okHandler, 'chat');
    const logs = [];
    const ctx = { correlationId: 'corr-1', log: () => {}, warn: (line) => logs.push(line), error: () => {} };

    const responses = [];
    for (let i = 0; i < 25; i += 1) responses.push(await wrapped(request({ uid: `alu-${i}` }), ctx));

    // 22 de 27 = 81% ≥ 80%: el umbral se cruza y la respuesta lo anuncia.
    const crossed = responses.filter((r) => r.headers['X-Caudal-Threshold'] === 'umbral');
    assert.equal(crossed.length > 0, true);
    assert.equal(typeof crossed[0].headers.Warning, 'string');
    assert.match(crossed[0].headers.Warning, /^299 - "caudal de servicio al \d+%/);

    const avisos = logs.filter((l) => l.includes('UMBRAL'));
    assert.equal(avisos.length, 1, 'un solo aviso por ventana y clase, no uno por pedido');

    const events = await listCaudalEvents({ limit: 200 });
    const thresholds = events.filter((e) => e.kind === 'threshold');
    assert.equal(thresholds.length, 1);
    assert.equal(thresholds[0].caudalClass, 'interactive');
    assert.equal(thresholds[0].reason, 'THRESHOLD');
    assert.equal(Number(thresholds[0].limit), 27);
    assert.equal(Number(thresholds[0].used) >= 22, true);
});

test('AVISO — la respuesta normal anuncia el caudal; el 429 dice qué eje cortó', async () => {
    resetAll();
    const wrapped = withRateLimit(okHandler, 'chat');
    const first = await wrapped(request({ uid: 'alu-001' }), context());
    assert.equal(first.headers['X-Caudal-Class'], 'interactive');
    assert.equal(first.headers['X-Caudal-Service-Used'], '1');
    assert.equal(first.headers['X-Caudal-Service-Limit'], '27');
    assert.equal(first.headers['X-Caudal-Service-Total'], '30');
    assert.equal(first.headers['X-Caudal-Reserve-Limit'], '3');
    assert.equal(first.headers['X-Caudal-Threshold'], 'ok');

    for (let i = 0; i < 26; i += 1) await wrapped(request({ uid: `alu-x${i}` }), context());
    const denied = await wrapped(request({ uid: 'alu-z' }), context());
    assert.equal(denied.status, 429);
    assert.equal(denied.headers['X-Caudal-Reason'], 'SERVICE_CAP');
    const body = JSON.parse(denied.body);
    assert.equal(body.code, 'RATE_LIMIT_EXCEEDED');
    assert.equal(body.errorCategory, 'RATE_LIMIT');
});

// ─── Registro: reconstruir la noche ─────────────────────────────────────

test('REGISTRO — cada denegación deja fila con ventana, clave, ruta y motivo, y se lee por día', async () => {
    resetAll();
    const chat = withRateLimit(okHandler, 'chat');
    for (let i = 0; i < 27; i += 1) await chat(request({ uid: `alu-${i}` }), context());
    await chat(request({ uid: 'alu-099', method: 'POST', url: 'https://pilot/api/rag-query' }), context());

    const events = await listCaudalEvents({ limit: 100 });
    const denials = events.filter((e) => e.kind === 'denial');
    assert.equal(denials.length, 1, 'el primero que sobra queda registrado');

    const row = denials[0];
    assert.equal(row.key, 'uid:alu-099');
    assert.equal(row.caudalClass, 'interactive');
    assert.equal(row.tier, 'chat');
    assert.equal(row.route, 'rag-query');
    assert.equal(row.method, 'POST');
    assert.equal(row.reason, 'SERVICE_CAP');
    assert.equal(Number(row.used), 27);
    assert.equal(Number(row.limit), 27);
    assert.equal(Number(row.windowIdx) > 0, true);
    assert.equal(typeof row.at, 'string');
    assert.match(row.partitionKey, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(row.correlationId, 'corr-test');

    // La segunda denegación (otra persona, mismo tope) también queda.
    await chat(request({ uid: 'alu-004' }), context());
    const after = await listCaudalEvents({ limit: 100 });
    assert.equal(after.filter((e) => e.kind === 'denial').length, 2);
    // El registro se lee por día y por tipo.
    const onlyThresholds = await listCaudalEvents({ date: row.partitionKey, kind: 'threshold', limit: 100 });
    assert.equal(onlyThresholds.every((e) => e.kind === 'threshold'), true);

    // Reconstrucción: quién, cuándo y por qué, sin haber estado.
    const porPersona = after.filter((e) => e.key === 'uid:alu-099');
    assert.equal(porPersona.length, 1);
    assert.equal(porPersona[0].reason, 'SERVICE_CAP');
});

// ─── Disponibilidad ────────────────────────────────────────────────────

test('STORAGE_CAIDO — sin almacén el tope sigue en memoria y la API no se cae', async () => {
    resetAll();
    tableState.down = true;
    try {
        const wrapped = withRateLimit(okHandler, 'chat');
        const responses = [];
        for (let i = 0; i < 32; i += 1) responses.push(await wrapped(request({ uid: `alu-${i}` }), context()));
        const allowed = responses.filter((r) => r.status === 200).length;
        const denied = responses.filter((r) => r.status === 429);
        assert.equal(allowed, 27, 'el tope de servicio se sostiene por instancia');
        assert.equal(denied.length, 5);
        assert.equal(JSON.parse(denied[0].body).caudal.reason, 'SERVICE_CAP');
    } finally {
        tableState.down = false;
    }
});

// ─── Clasificación de lo esencial ──────────────────────────────────────

test('CLASIFICACION — material y entrega son esenciales; el asistente no', () => {
    const cases = [
        [{ method: 'GET', url: 'https://pilot/api/material-download?subjectId=s1&materialId=m1' }, CAUDAL_CLASS.ESSENTIAL],
        [{ method: 'GET', url: 'https://pilot/api/material-status/m1?subjectId=s1' }, CAUDAL_CLASS.ESSENTIAL],
        [{ method: 'GET', url: 'https://pilot/api/material-status?subjectId=s1' }, CAUDAL_CLASS.ESSENTIAL],
        [{ method: 'POST', url: 'https://pilot/api/material-status/batch' }, CAUDAL_CLASS.ESSENTIAL],
        [{ method: 'GET', url: 'https://pilot/api/classes/s1' }, CAUDAL_CLASS.ESSENTIAL],
        [{ method: 'POST', url: 'https://pilot/api/classes' }, CAUDAL_CLASS.INTERACTIVE],
        [{ method: 'POST', url: 'https://pilot/api/rag-query' }, CAUDAL_CLASS.INTERACTIVE],
        [{ method: 'POST', url: 'https://pilot/api/generate-quiz' }, CAUDAL_CLASS.INTERACTIVE],
        [{ method: 'POST', url: 'https://pilot/api/ingest-material' }, CAUDAL_CLASS.INTERACTIVE],
    ];
    for (const [req, expected] of cases) {
        assert.equal(classifyCaudal(req), expected, `${req.method} ${req.url}`);
    }
});

test('DECISION — resolver sin contexto ni handler devuelve el eje que cortó y el caudal', async () => {
    resetAll();
    const decision = await resolveCaudalDecision(request({ uid: 'alu-001' }), { tier: 'chat' });
    assert.equal(decision.allowed, true);
    assert.equal(decision.caudalClass, 'interactive');
    assert.equal(decision.tier, 'chat');
    assert.equal(decision.service.limit, 27);
    assert.equal(decision.caps.total, 30);
    assert.equal(decision.scope, 'shared');
});
