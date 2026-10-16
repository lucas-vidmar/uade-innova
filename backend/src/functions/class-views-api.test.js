import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert';

// Los encabezados x-edu-uid / x-mock-role no son identidad fuera de desarrollo:
// el endpoint de vistas de clase llegó a devolver el historial de otro alumno con
// solo mandar x-edu-uid (verificado contra producción, 16/10/2026). Sin identidad
// resuelta debe responder 401, nunca servir el bucket 'anonymous'.
const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    readDevIdentityHeader: mock.fn(() => null),
    parseClientPrincipal: mock.fn(() => null),
};

const stateStoreMocks = {
    listClassViewsByStudent: mock.fn(async () => []),
    listClassViewsBySubject: mock.fn(async () => []),
    upsertClassView: mock.fn(async () => true),
    getEnrollment: mock.fn(async () => null),
};

mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/structured-logger.js', {
    namedExports: {
        createStructuredLogger: () => ({ log: () => {}, error: () => {}, warn: () => {} }),
    },
});
mock.module('../middleware/with-auth.js', {
    namedExports: { withAuth: (handler) => async (request, context) => handler(request, context) },
});
mock.module('../middleware/with-correlation.js', {
    namedExports: { withCorrelation: (handler) => handler },
});

const handlers = {};
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => { handlers[name] = options.handler; },
        },
    },
});

await import('./class-views-api.js');

function req({ query = {}, headers = {}, body = null } = {}) {
    return {
        query: { get: (k) => query[k] ?? null },
        headers: { get: (k) => headers[k.toLowerCase()] ?? null },
        params: {},
        json: async () => body,
    };
}

beforeEach(() => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => null);
    authMocks.readDevIdentityHeader.mock.mockImplementation(() => null);
    stateStoreMocks.listClassViewsByStudent.mock.mockImplementation(async () => []);
    stateStoreMocks.listClassViewsBySubject.mock.mockImplementation(async () => []);
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => null);
});

test('get-class-views sin identidad → 401 AUTH_REQUIRED (no sirve el bucket anonymous)', async () => {
    const response = await handlers['get-class-views'](
        req({ query: { subjectId: 'arq-software-2026' } }),
        { log: () => {} }
    );

    assert.strictEqual(response.status, 401);
    assert.match(response.body, /AUTH_REQUIRED/);
    assert.strictEqual(stateStoreMocks.listClassViewsByStudent.mock.callCount(), 0);
});

test('get-class-views con encabezado x-edu-uid pero mock deshabilitado → 401', async () => {
    const response = await handlers['get-class-views'](
        req({ query: { subjectId: 'arq-software-2026' }, headers: { 'x-edu-uid': 'alu-001' } }),
        { log: () => {} }
    );

    assert.strictEqual(response.status, 401);
});

test('get-class-views con sesión de alumno → 200 con sus propias vistas', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'alu-001', userRoles: ['Alumno'] }));
    stateStoreMocks.listClassViewsByStudent.mock.mockImplementation(async () => [
        { subjectId: 'arq-software-2026', studentId: 'alu-001', classId: 'class-01' },
    ]);

    const response = await handlers['get-class-views'](
        req({ query: { subjectId: 'arq-software-2026' } }),
        { log: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const [subject, userId] = stateStoreMocks.listClassViewsByStudent.mock.calls.at(-1).arguments;
    assert.strictEqual(subject, 'arq-software-2026');
    assert.strictEqual(userId, 'alu-001');
});

test('get-class-views docente pidiendo un alumno puntual usa el id pedido, no el propio', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'prof-001', userRoles: ['Docente'] }));

    const response = await handlers['get-class-views'](
        req({ query: { subjectId: 'arq-software-2026', userId: 'alu-002' } }),
        { log: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const [, userId] = stateStoreMocks.listClassViewsByStudent.mock.calls.at(-1).arguments;
    assert.strictEqual(userId, 'alu-002');
});

test('track-class-view sin matrícula activa → 403', async () => {
    const response = await handlers['track-class-view'](
        req({ body: { subjectId: 'arq-software-2026', classId: 'class-01' } }),
        { log: () => {} }
    );

    assert.strictEqual(response.status, 403);
    assert.strictEqual(stateStoreMocks.upsertClassView.mock.callCount(), 0);
});
