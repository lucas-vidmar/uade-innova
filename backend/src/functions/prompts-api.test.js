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

test('prompts-activate exige motivo y lo registra junto con quién activa', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'adm-001', userRoles: ['authenticated', 'Admin'] }));
    promptStoreMocks.activateVersion.mock.resetCalls();

    const sinMotivo = await handlers['prompts-activate'](
        { method: 'POST', params: { type: 'rag-master', versionId: 'v1' }, json: async () => ({}) },
        { log: () => {} },
    );
    assert.strictEqual(sinMotivo.status, 400);
    assert.strictEqual(JSON.parse(sinMotivo.body).error, 'ACTIVATION_REASON_REQUIRED');
    assert.strictEqual(promptStoreMocks.activateVersion.mock.callCount(), 0, 'sin motivo no se activa nada');

    promptStoreMocks.activateVersion.mock.mockImplementation(async (type, versionId, options) => (
        { type, versionId, isActive: true, activatedAt: '2026-10-16T00:00:00.000Z', ...options }
    ));
    const conMotivo = await handlers['prompts-activate'](
        { method: 'POST', params: { type: 'rag-master', versionId: 'v1' }, json: async () => ({ reason: 'el tono nuevo es más claro' }) },
        { log: () => {} },
    );

    assert.strictEqual(conMotivo.status, 200);
    const passed = promptStoreMocks.activateVersion.mock.calls.at(-1).arguments[2];
    assert.deepStrictEqual(passed, { activatedBy: 'adm-001', reason: 'el tono nuevo es más claro' });
    const body = JSON.parse(conMotivo.body);
    assert.strictEqual(body.activatedBy, 'adm-001');
    assert.strictEqual(body.activatedAt, '2026-10-16T00:00:00.000Z', 'la respuesta declara el momento de la activación');

    authMocks.parseClientPrincipal.mock.mockImplementation(() => null);
});

test('prompts-update registra a quién editó el contenido', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'dir-001', userRoles: ['authenticated', 'Director'] }));
    promptStoreMocks.updateVersion.mock.resetCalls();

    await handlers['prompts-update'](
        { method: 'PUT', params: { type: 'rag-master', versionId: 'v1' }, json: async () => ({ content: 'nuevo' }) },
        { log: () => {} },
    );

    const passed = promptStoreMocks.updateVersion.mock.calls.at(-1).arguments[2];
    assert.strictEqual(passed.updatedBy, 'dir-001');
    authMocks.parseClientPrincipal.mock.mockImplementation(() => null);
});

// ── UJ-49: quién enseña necesita enumerar las versiones para poder enfrentar la
// vigente contra una propuesta en el banco de pruebas, sin leer su contenido.
test('prompts-list-available deja a un Docente enumerar las versiones (sólo metadatos)', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'prof-001', userRoles: ['authenticated', 'Docente'] }));
    promptStoreMocks.listVersions.mock.mockImplementation(async () => ([
        { versionId: 'v1-baseline', isActive: true, description: 'baseline', createdAt: '2026-06-29T20:06:15.282Z', model: null, content: 'SECRETO-VIGENTE', systemPrompt: 'SECRETO-SISTEMA' },
        { versionId: 'v-propuesta', isActive: false, description: 'propuesta', createdAt: '2026-10-17T00:00:00.000Z', model: null, content: 'SECRETO-PROPUESTA' },
    ]));

    const response = await handlers['prompts-list-available'](
        { method: 'GET', params: { type: 'rag-master' } },
        { log: () => {} },
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.activeVersion, 'v1-baseline');
    assert.strictEqual(body.versions.length, 2);
    assert.deepStrictEqual(body.versions.map((v) => v.versionId), ['v1-baseline', 'v-propuesta']);
    // El contenido NUNCA viaja por esta ruta.
    assert.ok(!/SECRETO/.test(response.body), 'la ruta de disponibilidad no expone contenido');
    assert.ok(!('content' in body.versions[0]));
    assert.ok(!('systemPrompt' in body.versions[0]));

    authMocks.parseClientPrincipal.mock.mockImplementation(() => null);
});

test('prompts-list-available sigue cerrada para un Alumno', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'alu-001', userRoles: ['authenticated', 'Alumno'] }));

    const response = await handlers['prompts-list-available'](
        { method: 'GET', params: { type: 'rag-master' } },
        { log: () => {} },
    );

    assert.strictEqual(response.status, 403);
    assert.strictEqual(JSON.parse(response.body).code, 'FORBIDDEN');

    authMocks.parseClientPrincipal.mock.mockImplementation(() => null);
});