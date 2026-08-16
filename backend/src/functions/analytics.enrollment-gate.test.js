import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Gate-path tests for Story 10.24: teacher analytics + safety-rate must use the
// allowlist-resolved application id for enrollment checks and return structured
// 403 error codes (never a bare "Forbidden" string).

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ userId: '00000000-0000-0000-0000-000000000099', userRoles: ['authenticated', 'Docente'] })),
};

const storageMocks = {
    listBlobs: mock.fn(async () => []),
    loadJson: mock.fn(async () => null),
};

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => null),
};

const safetyRateMocks = {
    computeSafetyRate: mock.fn(async () => ({ safetyRatePercent: 100, totalRequests: 0, blockedBySafety: 0, errorCategorizedFailures: 0 })),
};

mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/safety-rate.js', { namedExports: safetyRateMocks });
// withAuth performs identity resolution + allowlist override; in tests the
// allowlist-resolved identity is passed directly as `context.user` (Story 10.24).
mock.module('../middleware/with-auth.js', {
    namedExports: {
        withAuth: (handler) => async (request, context) => handler(request, context),
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

await import('./analytics.js');

const TEACHER_CONTEXT_USER = { id: 'doc-001', email: 'xavier@uade.edu.ar', role: 'Docente' };

test('get-teacher-analytics returns 200 when allowlist-resolved teacher is actively enrolled', async () => {
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'teacher' }));

    const response = await handlers['get-teacher-analytics'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
        { log: () => {}, error: () => {}, warn: () => {}, user: TEACHER_CONTEXT_USER }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body.topQuestions));
    // The enrollment lookup must use the allowlist-resolved application id
    // (pilot data key doc-001), never the raw SWA OID.
    const lastCall = stateStoreMocks.getEnrollment.mock.calls.at(-1).arguments;
    assert.deepStrictEqual(lastCall, ['arq-software-2026', 'doc-001']);
});

test('get-teacher-analytics returns structured ENROLLMENT_INACTIVE when teacher is not enrolled', async () => {
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => null);

    const response = await handlers['get-teacher-analytics'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
        { log: () => {}, error: () => {}, warn: () => {}, user: TEACHER_CONTEXT_USER }
    );

    assert.strictEqual(response.status, 403);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.code, 'ENROLLMENT_INACTIVE');
    assert.strictEqual(body.errorCategory, 'AUTH');
});

test('get-teacher-analytics returns structured FORBIDDEN for a student role', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'alu-001', userRoles: ['authenticated', 'Alumno'] }));

    const response = await handlers['get-teacher-analytics'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
        { log: () => {}, error: () => {}, warn: () => {}, user: { id: 'alu-001', email: 'lvidmar@uade.edu.ar', role: 'Alumno' } }
    );

    assert.strictEqual(response.status, 403);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.code, 'FORBIDDEN');
    assert.strictEqual(body.errorCategory, 'AUTH');

    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: '00000000-0000-0000-0000-000000000099', userRoles: ['authenticated', 'Docente'] }));
});

test('get-safety-rate returns structured ENROLLMENT_INACTIVE when teacher is not enrolled', async () => {
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => null);

    const response = await handlers['get-safety-rate'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', days: '30' }) },
        { log: () => {}, error: () => {}, warn: () => {}, user: TEACHER_CONTEXT_USER }
    );

    assert.strictEqual(response.status, 403);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.code, 'ENROLLMENT_INACTIVE');
});