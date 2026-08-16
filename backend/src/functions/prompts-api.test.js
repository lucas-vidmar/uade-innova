import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Story 10.24: Gestión de Prompts must return the structured error contract
// (error/errorCategory/code) instead of a bare `{ error: ... }` 403.

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => null),
};

mock.module('../services/auth-utils.js', { namedExports: authMocks });
// withAuth role gating is exercised by its own unit tests; here we test the
// prompts requireDirector gate + structured 403 shape (Story 10.24).
mock.module('../middleware/with-auth.js', {
    namedExports: {
        withAuth: (handler) => async (request, context) => handler(request, context),
    },
});

const promptStoreMocks = {
    listTypes: mock.fn(async () => []),
    listVersions: mock.fn(async () => []),
    getActive: mock.fn(async () => null),
    getVersion: mock.fn(async () => null),
    createVersion: mock.fn(async () => ({ versionId: 'v1' })),
    updateVersion: mock.fn(async () => ({ versionId: 'v1' })),
    activateVersion: mock.fn(async () => ({ versionId: 'v1', isActive: true })),
    deleteVersion: mock.fn(async () => ({ success: true })),
};

mock.module('../services/prompt-store.js', { namedExports: promptStoreMocks });

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

await import('./prompts-api.js');

test('prompts-list-types returns structured FORBIDDEN 403 for a non-director', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'alu-001', userRoles: ['authenticated', 'Alumno'] }));

    const response = await handlers['prompts-list-types'](
        { method: 'GET' },
        { log: () => {} }
    );

    assert.strictEqual(response.status, 403);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.code, 'FORBIDDEN');
    assert.strictEqual(body.errorCategory, 'AUTH');
    assert.ok(body.error.includes('Director o Admin'));

    authMocks.parseClientPrincipal.mock.mockImplementation(() => null);
});

test('prompts-list-versions returns structured FORBIDDEN 403 without any principal', async () => {
    const response = await handlers['prompts-list-versions'](
        { method: 'GET', params: { type: 'rag-query' } },
        { log: () => {} }
    );

    assert.strictEqual(response.status, 403);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.code, 'FORBIDDEN');
});

test('prompts-list-types returns 200 for a director principal', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'dir-001', userRoles: ['authenticated', 'Director'] }));
    promptStoreMocks.listTypes.mock.mockImplementation(async () => [{ id: 'rag-query', label: 'RAG' }]);

    const response = await handlers['prompts-list-types'](
        { method: 'GET' },
        { log: () => {}, principal: { userRoles: ['authenticated', 'Director'] } }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));

    authMocks.parseClientPrincipal.mock.mockImplementation(() => null);
});