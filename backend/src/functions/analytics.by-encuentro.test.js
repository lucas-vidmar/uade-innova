import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// #420 / UJ-50: la analítica docente tiene que poder leerse encuentro por
// encuentro. Este test cubre el corte por encuentro (`byClass`) que agrega
// `get-teacher-analytics`: cada consulta se atribuye a los encuentros de su
// alcance (`classIds`), y `all` no es un encuentro.

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    readDevIdentityHeader: mock.fn(() => null),
    parseClientPrincipal: mock.fn(() => ({ userId: 'doc-001', userRoles: ['authenticated', 'Docente'] })),
};

const LOGS = {
    'doc-001/arq-software-2026/a.json': { question: '¿Qué es la arquitectura hexagonal?', classIds: ['class-01'] },
    'doc-001/arq-software-2026/b.json': { question: '¿Qué es la arquitectura hexagonal?', classIds: ['class-01'] },
    'doc-001/arq-software-2026/c.json': { question: '¿Qué patrones SAGA se vieron?', classIds: ['class-02'], feedback: 'negative' },
    'doc-001/arq-software-2026/d.json': { question: '¿Qué se vio en toda la unidad?', classIds: ['all'] },
    'doc-001/arq-software-2026/e.json': { question: '¿Qué es la arquitectura hexagonal?', classIds: ['class-01', 'class-02'] },
};

const storageMocks = {
    listBlobs: mock.fn(async () => Object.keys(LOGS)),
    loadJson: mock.fn(async (container, name) => LOGS[name] || null),
};

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'teacher' })),
};

const safetyRateMocks = {
    computeSafetyRate: mock.fn(async () => ({ safetyRatePercent: 100, totalRequests: 0, blockedBySafety: 0, errorCategorizedFailures: 0 })),
};

mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/safety-rate.js', { namedExports: safetyRateMocks });
mock.module('../middleware/with-auth.js', {
    namedExports: { withAuth: (handler) => async (request, context) => handler(request, context) },
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

await import('./analytics.js');

const CONTEXT = { log: () => {}, error: () => {}, warn: () => {}, user: { id: 'doc-001', email: 'xavier@uade.edu.ar', role: 'Docente' } };

async function callAnalytics() {
    const response = await handlers['get-teacher-analytics'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
        CONTEXT,
    );
    assert.strictEqual(response.status, 200);
    return JSON.parse(response.body);
}

test('get-teacher-analytics corta las consultas por encuentro (UJ-50 paso 4)', async () => {
    const body = await callAnalytics();

    assert.ok(Array.isArray(body.byClass), 'la respuesta expone byClass');

    const c1 = body.byClass.find((c) => c.classId === 'class-01');
    assert.ok(c1, 'class-01 aparece con su propia lectura');
    assert.strictEqual(c1.questionCount, 3, 'dos consultas de clase 1 más la que abarcó clase 1 y 2');
    assert.deepStrictEqual(c1.topQuestions[0], { text: '¿Qué es la arquitectura hexagonal?', count: 3 });

    const c2 = body.byClass.find((c) => c.classId === 'class-02');
    assert.ok(c2, 'class-02 aparece con su propia lectura');
    assert.strictEqual(c2.questionCount, 2, 'la de SAGA más la que abarcó clase 1 y 2');

    // `all` no es un encuentro: no se mezcla con los cortes por encuentro.
    assert.strictEqual(body.byClass.some((c) => c.classId === 'all'), false);
    assert.strictEqual(body.byClass.length, 2);
});

test('get-teacher-analytics conserva el agregado de la unidad', async () => {
    const body = await callAnalytics();
    assert.ok(Array.isArray(body.topQuestions));
    const hexagonal = body.topQuestions.find((q) => q.text === '¿Qué es la arquitectura hexagonal?');
    assert.strictEqual(hexagonal.count, 3);
});
