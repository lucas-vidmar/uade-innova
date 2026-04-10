import { test, mock } from 'node:test';
import assert from 'node:assert';

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({ userRoles: [] })),
};

const storageMocks = {
    loadJson: mock.fn(async () => null),
    saveJson: mock.fn(async () => true),
    deleteBlob: mock.fn(async () => true),
    listBlobs: mock.fn(async () => []),
    getTableClient: mock.fn(() => ({
        listEntities: async function* () { }
    })),
};

const stateStoreMocks = {
    listClassesBySubject: mock.fn(async () => []),
    listMaterialsBySubject: mock.fn(async () => []),
    replaceClassesForSubject: mock.fn(async () => true),
    deleteMaterialStateById: mock.fn(async () => true),
    getMaterialState: mock.fn(async () => null),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('uuid', { namedExports: { v4: () => '1234' } });

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

await import('./classes-api.js');

test('get-material-status returns 400 when subjectId is missing', async () => {
    const response = await handlers['get-material-status'](
        {
            params: { materialId: 'mat-001' },
            query: new URLSearchParams(),
        },
        { log: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 400);
    assert.match(response.body, /subjectId/i);
});

test('get-material-status returns 200 with table material state', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => ({
        materialId: 'mat-001',
        subjectId: 'arq-software-2026',
        status: 'ready',
        filename: 'clase14.txt',
        classIds: ['class-14'],
    }));

    const response = await handlers['get-material-status'](
        {
            params: { materialId: 'mat-001' },
            query: new URLSearchParams({ subjectId: 'arq-software-2026' }),
        },
        { log: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.materialId, 'mat-001');
    assert.strictEqual(body.status, 'ready');
});

test('get-material-status returns 404 when material does not exist', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => null);
    storageMocks.loadJson.mock.mockImplementationOnce(async () => null);

    const response = await handlers['get-material-status'](
        {
            params: { materialId: 'missing-material' },
            query: new URLSearchParams({ subjectId: 'arq-software-2026' }),
        },
        { log: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 404);
});
