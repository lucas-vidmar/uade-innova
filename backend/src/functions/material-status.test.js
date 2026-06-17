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
    upsertMaterialState: mock.fn(async () => true),
    deleteClassesBySubject: mock.fn(async () => true),
    deleteMaterialsBySubject: mock.fn(async () => true),
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'student' })),
    getEnrollmentsByUser: mock.fn(async () => []),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('uuid', { namedExports: { v4: () => '1234' } });

process.env.DIRECTOR_BUDGET_MONTHLY_USD = '97.50';

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

test('get-material-status normalizes unknown status to pending', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => ({
        materialId: 'mat-002',
        subjectId: 'arq-software-2026',
        status: 'done',
        filename: 'clase15.txt',
        classIds: ['class-15'],
    }));

    const response = await handlers['get-material-status'](
        {
            params: { materialId: 'mat-002' },
            query: new URLSearchParams({ subjectId: 'arq-software-2026' }),
        },
        { log: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.status, 'pending');
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

test('get-material-status-batch returns multi-status payload with per-id 404 semantics', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementation(async (subjectId, materialId) => {
        if (materialId === 'mat-ready') {
            return {
                materialId,
                subjectId,
                status: 'ready',
                filename: 'ready.txt',
                classIds: ['class-1'],
            };
        }
        if (materialId === 'mat-weird') {
            return {
                materialId,
                subjectId,
                status: 'completed',
                filename: 'completed.txt',
                classIds: ['class-1'],
            };
        }
        return null;
    });

    const response = await handlers['get-material-status-batch'](
        {
            query: new URLSearchParams({
                subjectId: 'arq-software-2026',
                materialIds: 'mat-ready,mat-missing,mat-weird',
            }),
        },
        { log: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.subjectId, 'arq-software-2026');
    assert.strictEqual(Array.isArray(body.results), true);
    assert.strictEqual(body.results.length, 3);

    const ready = body.results.find((item) => item.materialId === 'mat-ready');
    assert.strictEqual(ready.found, true);
    assert.strictEqual(ready.httpStatus, 200);
    assert.strictEqual(ready.status, 'ready');

    const missing = body.results.find((item) => item.materialId === 'mat-missing');
    assert.strictEqual(missing.found, false);
    assert.strictEqual(missing.httpStatus, 404);

    const weird = body.results.find((item) => item.materialId === 'mat-weird');
    assert.strictEqual(weird.found, true);
    assert.strictEqual(weird.httpStatus, 200);
    assert.strictEqual(weird.status, 'pending');
});
