import { test, mock } from 'node:test';
import assert from 'node:assert';

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ userId: 'alu-001', userRoles: ['Docente'] })),
    getAuthenticatedUser: mock.fn(() => ({ userId: 'alu-001', sanitizedId: 'alu_001', principal: { userId: 'alu-001', userRoles: ['Docente'] }, role: 'Docente' })),
};

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => null),
    getEnrollmentsByUser: mock.fn(async () => []),
    getEnrollmentsBySubject: mock.fn(async () => []),
    upsertEnrollment: mock.fn(async (e) => e),
    deleteEnrollment: mock.fn(async () => true),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });

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

await import('./enrollments-api.js');

function makeRequest(query = {}, body = null) {
    const params = new Map(Object.entries(query));
    return {
        query: {
            get: (key) => params.get(key),
        },
        headers: {
            get: () => null,
        },
        json: async () => body,
    };
}

function makeContext() {
    return { log: mock.fn(), error: mock.fn(), warn: mock.fn() };
}

// ── GET /api/enrollments?userId=alu-001 ──────────────────────────
test('get-enrollments returns empty array when user has no enrollments', async () => {
    stateStoreMocks.getEnrollmentsByUser.mock.mockImplementation(() => []);
    const ctx = makeContext();
    const req = makeRequest({ userId: 'alu-001' });
    const res = await handlers['get-enrollments'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.length, 0);
});

test('get-enrollments returns enrollments for a user', async () => {
    stateStoreMocks.getEnrollmentsByUser.mock.mockImplementation(() => [
        { subjectId: 'arq-software-2026', userId: 'alu-001', role: 'student', status: 'active' },
    ]);
    const ctx = makeContext();
    const req = makeRequest({ userId: 'alu-001' });
    const res = await handlers['get-enrollments'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.length, 1);
    assert.strictEqual(body.data[0].subjectId, 'arq-software-2026');
});

test('get-enrollments returns 400 when userId is missing', async () => {
    const ctx = makeContext();
    const req = makeRequest({});
    const res = await handlers['get-enrollments'](req, ctx);
    assert.strictEqual(res.status, 400);
});

// ── GET /api/enrollments/check ──────────────────────────────────
test('check-enrollment returns enrolled=true for enrolled student', async () => {
    stateStoreMocks.getEnrollment.mock.mockImplementation(() => ({
        subjectId: 'arq-software-2026',
        userId: 'alu-001',
        role: 'student',
        status: 'active',
    }));
    const ctx = makeContext();
    const req = makeRequest({ userId: 'alu-001', subjectId: 'arq-software-2026' });
    const res = await handlers['check-enrollment'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.enrolled, true);
    assert.strictEqual(body.data.role, 'student');
    assert.strictEqual(body.data.status, 'active');
});

test('check-enrollment returns enrolled=false for unenrolled student', async () => {
    stateStoreMocks.getEnrollment.mock.mockImplementation(() => null);
    const ctx = makeContext();
    const req = makeRequest({ userId: 'alu-999', subjectId: 'arq-software-2026' });
    const res = await handlers['check-enrollment'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.enrolled, false);
    assert.strictEqual(body.data.role, null);
});

test('check-enrollment returns teacher role for teacher enrollment', async () => {
    stateStoreMocks.getEnrollment.mock.mockImplementation(() => ({
        subjectId: 'arq-software-2026',
        userId: 'doc-001',
        role: 'teacher',
        status: 'active',
    }));
    const ctx = makeContext();
    const req = makeRequest({ userId: 'doc-001', subjectId: 'arq-software-2026' });
    const res = await handlers['check-enrollment'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.data.role, 'teacher');
});

test('check-enrollment returns 400 when params missing', async () => {
    const ctx = makeContext();
    const req = makeRequest({ userId: 'alu-001' });
    const res = await handlers['check-enrollment'](req, ctx);
    assert.strictEqual(res.status, 400);
});

// ── POST /api/enrollments (teacher/director only) ────────────────
test('create-enrollment rejects anonymous users', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => null);
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const ctx = makeContext();
    const req = makeRequest({}, { subjectId: 'arq-software-2026', userId: 'alu-001', role: 'student' });
    req.json = async () => ({ subjectId: 'arq-software-2026', userId: 'alu-001', role: 'student' });
    const res = await handlers['create-enrollment'](req, ctx);
    assert.strictEqual(res.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('create-enrollment accepts teacher role', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    stateStoreMocks.upsertEnrollment.mock.mockImplementation(async (e) => ({
        ...e,
        status: e.status || 'active',
        enrolledAt: e.enrolledAt || '2026-03-10T00:00:00Z',
    }));

    const ctx = makeContext();
    const req = makeRequest({}, {});
    req.json = async () => ({ subjectId: 'arq-software-2026', userId: 'alu-001', role: 'student' });
    const res = await handlers['create-enrollment'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('create-enrollment validates role field', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const ctx = makeContext();
    const req = makeRequest({}, {});
    req.json = async () => ({ subjectId: 'arq-software-2026', userId: 'alu-001', role: 'admin' });
    const res = await handlers['create-enrollment'](req, ctx);
    assert.strictEqual(res.status, 400);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

// ── DELETE /api/enrollments (director only) ──────────────────────
test('delete-enrollment rejects non-director users', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const ctx = makeContext();
    const req = makeRequest({ userId: 'alu-001', subjectId: 'arq-software-2026' });
    const res = await handlers['delete-enrollment'](req, ctx);
    assert.strictEqual(res.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('delete-enrollment succeeds for director', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    stateStoreMocks.deleteEnrollment.mock.mockImplementation(async () => true);

    const ctx = makeContext();
    const req = makeRequest({ userId: 'alu-001', subjectId: 'arq-software-2026' });
    const res = await handlers['delete-enrollment'](req, ctx);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.deleted, true);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});