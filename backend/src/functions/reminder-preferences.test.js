import { test, mock } from 'node:test';
import assert from 'node:assert';

// Mocks mirror the real auth-utils surface (same shape consent-api.test.js uses)
// so the withAuth wrapper resolves a session identity exactly like production.
const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    // A session-token principal carries `userId` and NO `oid` (with-auth.js
    // resolveSessionIdentity builds exactly this shape).
    parseClientPrincipal: mock.fn((request) => {
        const uid = request?.headers?.get?.('x-session-user');
        if (uid) return { userId: uid, userDetails: `${uid}@uade.edu.ar`, userRoles: ['authenticated', 'Alumno'] };
        return null;
    }),
    getAuthenticatedUser: mock.fn(() => null),
    resolveIdentityKey: mock.fn((request, context) => context?.user?.userId || request.headers.get('x-edu-uid') || 'pilot-user'),
    hasResolvedIdentity: mock.fn((user) => {
        if (!user) return false;
        const role = user.role;
        if (!role || role === 'Anonymous' || role === 'Denied') return false;
        const id = user.userId || user.id;
        return Boolean(id) && id !== 'anonymous' && id !== 'pilot-user';
    }),
};

let prefsStore = {};

const storageMocks = {
    getTableClient: mock.fn(() => ({
        getEntity: mock.fn(async (pk, rk) => {
            const key = `${pk}:${rk}`;
            if (!prefsStore[key]) {
                const err = new Error('Not Found');
                err.statusCode = 404;
                throw err;
            }
            return prefsStore[key];
        }),
        upsertEntity: mock.fn(async (entity) => {
            prefsStore[`${entity.partitionKey}:${entity.rowKey}`] = entity;
        }),
    })),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });

const handlers = {};
mock.module('@azure/functions', {
    namedExports: {
        app: { http: (name, options) => { handlers[name] = options.handler; } },
    },
});

await import('./reminder-preferences.js');

function makeRequest(headers = {}, body = null, method = 'GET') {
    return {
        method,
        headers: { get: (key) => headers[key] || null },
        json: async () => body,
    };
}

function makeContext(user = null) {
    return { log: mock.fn(), error: mock.fn(), warn: mock.fn(), user };
}

test.beforeEach(() => { prefsStore = {}; });

// ── Defaults ─────────────────────────────────────────────────────
test('get reminder-preferences returns defaults for a new user', async () => {
    const res = await handlers['reminder-preferences-get'](makeRequest({ 'x-session-user': 'alu-004' }), makeContext());
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { enabled: true, cadence: 'both', timeWindow: 'any', datePrefs: {} });
});

// ── #356 regression: preferences are per person, not a shared global row ──
// Session-token principals carry NO `oid`, so keying the row by
// `principal?.oid || 'pilot-user'` collapsed every student onto one shared
// 'pilot-user' record: one student changing the cadence changed it for
// everyone. Verified against the pilot: alu-004 wrote 48h and alu-005 read 48h.
test('#356: las preferencias de un alumno no se filtran a otro alumno', async () => {
    const alu004 = makeRequest({ 'x-session-user': 'alu-004', 'content-type': 'application/json' },
        { enabled: true, cadence: '48h' }, 'POST');
    const writeRes = await handlers['reminder-preferences-post'](alu004, makeContext());
    assert.strictEqual(writeRes.status, 200);

    assert.ok(prefsStore['alu-004:deadline-reminders'], 'la fila debe guardarse bajo la identidad de sesión');
    assert.ok(!prefsStore['pilot-user:deadline-reminders'], 'no debe escribirse la fila compartida pilot-user');

    // alu-005 must still read the defaults, NOT alu-004's cadence.
    const alu005Res = await handlers['reminder-preferences-get'](makeRequest({ 'x-session-user': 'alu-005' }), makeContext());
    assert.strictEqual(alu005Res.status, 200);
    assert.strictEqual(JSON.parse(alu005Res.body).cadence, 'both', 'alu-005 no debe heredar la cadencia de alu-004');

    // alu-004 keeps its own value.
    const alu004Res = await handlers['reminder-preferences-get'](makeRequest({ 'x-session-user': 'alu-004' }), makeContext());
    assert.strictEqual(JSON.parse(alu004Res.body).cadence, '48h');
});

// ── Per-date declaration (UJ-35 pasos 1, 2 y 9) + franja horaria (paso 3) ──
test('guarda y devuelve antelación por fecha y franja horaria (UJ-35)', async () => {
    const payload = {
        enabled: true,
        cadence: 'both',
        timeWindow: 'evening',
        datePrefs: {
            '2026-06-23': { watch: true, leadHours: 12 },
            '2026-06-30': { watch: false },
        },
    };
    const postRes = await handlers['reminder-preferences-post'](
        makeRequest({ 'x-session-user': 'alu-004', 'content-type': 'application/json' }, payload, 'POST'),
        makeContext());
    assert.strictEqual(postRes.status, 200);
    const saved = JSON.parse(postRes.body).data;
    assert.deepStrictEqual(saved.datePrefs, payload.datePrefs);
    assert.strictEqual(saved.timeWindow, 'evening');

    const getRes = await handlers['reminder-preferences-get'](makeRequest({ 'x-session-user': 'alu-004' }), makeContext());
    const read = JSON.parse(getRes.body);
    assert.strictEqual(read.timeWindow, 'evening');
    assert.deepStrictEqual(read.datePrefs, payload.datePrefs);
    // Constancia de qué fechas generan aviso y cuáles no.
    assert.strictEqual(read.datePrefs['2026-06-23'].watch, true);
    assert.strictEqual(read.datePrefs['2026-06-30'].watch, false);
});

test('una fecha sin watch booleano no queda declarada', async () => {
    const postRes = await handlers['reminder-preferences-post'](
        makeRequest({ 'x-session-user': 'alu-004', 'content-type': 'application/json' },
            { datePrefs: { '2026-06-23': { leadHours: 12 } } }, 'POST'),
        makeContext());
    assert.strictEqual(postRes.status, 400);
    assert.ok(/datePrefs/.test(JSON.parse(postRes.body).error));
});

test('rechaza una franja horaria desconocida', async () => {
    const res = await handlers['reminder-preferences-post'](
        makeRequest({ 'x-session-user': 'alu-004', 'content-type': 'application/json' },
            { timeWindow: 'midnight' }, 'POST'),
        makeContext());
    assert.strictEqual(res.status, 400);
    assert.ok(/timeWindow/.test(JSON.parse(res.body).error));
});

test('rechaza una fecha inválida en datePrefs', async () => {
    const res = await handlers['reminder-preferences-post'](
        makeRequest({ 'x-session-user': 'alu-004', 'content-type': 'application/json' },
            { datePrefs: { '23/06/2026': { watch: true } } }, 'POST'),
        makeContext());
    assert.strictEqual(res.status, 400);
});

test('rechaza una cadencia desconocida', async () => {
    const res = await handlers['reminder-preferences-post'](
        makeRequest({ 'x-session-user': 'alu-004', 'content-type': 'application/json' },
            { cadence: '72h' }, 'POST'),
        makeContext());
    assert.strictEqual(res.status, 400);
});

// ── Fail closed: no identity, no shared row ──────────────────────
test('#356: un cliente sin identidad no lee preferencias (401)', async () => {
    prefsStore['pilot-user:deadline-reminders'] = {
        partitionKey: 'pilot-user', rowKey: 'deadline-reminders', enabled: 'true', cadence: '24h',
    };
    const res = await handlers['reminder-preferences-get'](makeRequest({}), makeContext(null));
    assert.strictEqual(res.status, 401, `esperaba 401, llegó ${res.status}: ${res.body}`);
    delete prefsStore['pilot-user:deadline-reminders'];
});

test('#356: un cliente sin identidad no escribe preferencias (401)', async () => {
    const res = await handlers['reminder-preferences-post'](
        makeRequest({ 'content-type': 'application/json' }, { cadence: '48h' }, 'POST'),
        makeContext(null));
    assert.strictEqual(res.status, 401);
    assert.ok(!prefsStore['pilot-user:deadline-reminders'], 'no debe escribirse la fila compartida');
});

// ── Legacy rows keep working ─────────────────────────────────────
test('una fila previa (sólo enabled+cadence) se lee con franja any y sin fechas', async () => {
    prefsStore['alu-004:deadline-reminders'] = {
        partitionKey: 'alu-004', rowKey: 'deadline-reminders', enabled: 'true', cadence: '24h',
    };
    const res = await handlers['reminder-preferences-get'](makeRequest({ 'x-session-user': 'alu-004' }), makeContext());
    const body = JSON.parse(res.body);
    assert.strictEqual(body.cadence, '24h');
    assert.strictEqual(body.timeWindow, 'any');
    assert.deepStrictEqual(body.datePrefs, {});
});

// ── Guardado parcial: Ajustes y Calendario no se pisan ───────────
test('un cuerpo parcial no borra la franja ni las fechas ya guardadas', async () => {
    prefsStore['alu-004:deadline-reminders'] = {
        partitionKey: 'alu-004', rowKey: 'deadline-reminders',
        enabled: 'true', cadence: 'both', timeWindow: 'evening',
        datePrefsJson: JSON.stringify({ '2026-06-23': { watch: true, leadHours: 12 } }),
    };
    const res = await handlers['reminder-preferences-post'](
        makeRequest({ 'x-session-user': 'alu-004', 'content-type': 'application/json' }, { cadence: '24h' }, 'POST'),
        makeContext());
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body).data;
    assert.strictEqual(body.cadence, '24h');
    assert.strictEqual(body.timeWindow, 'evening', 'la franja guardada no debe perderse');
    assert.deepStrictEqual(body.datePrefs, { '2026-06-23': { watch: true, leadHours: 12 } }, 'las fechas guardadas no deben perderse');
});
