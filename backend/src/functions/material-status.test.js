import { test, mock } from 'node:test';
import assert from 'node:assert';

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    readDevIdentityHeader: mock.fn((request, name) => request?.headers?.get?.(name) || null),
    parseClientPrincipal: mock.fn(() => ({ userRoles: [] })),
};

const storageMocks = {
    loadJson: mock.fn(async () => null),
    saveJson: mock.fn(async () => true),
    deleteBlob: mock.fn(async () => true),
    moveBlob: mock.fn(async () => true),
    listBlobs: mock.fn(async () => []),
    getTableClient: mock.fn(() => ({
        listEntities: async function* () { }
    })),
    uploadFile: mock.fn(async () => true),
    downloadFile: mock.fn(async () => Buffer.from('file-content')),
};

const stateStoreMocks = {
    listClassesBySubject: mock.fn(async () => []),
    listMaterialsBySubject: mock.fn(async () => []),
    listMaterialsByClass: mock.fn(async () => []),
    replaceClassesForSubject: mock.fn(async () => true),
    deleteMaterialStateById: mock.fn(async () => true),
    getMaterialState: mock.fn(async () => null),
    getMaterialStateById: mock.fn(async () => null),
    upsertMaterialState: mock.fn(async () => true),
    deleteClassesBySubject: mock.fn(async () => true),
    deleteMaterialsBySubject: mock.fn(async () => true),
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'student' })),
    getEnrollmentsByUser: mock.fn(async () => []),
    getEnrollmentsBySubject: mock.fn(async () => []),
    listClassViewsByStudent: mock.fn(async () => []),
    deleteClassViewsBySubject: mock.fn(async () => true),
    // #428: servicios compartidos que ahora entran en el grafo de classes-api.js.
    getEnrollmentsBySubject: mock.fn(async () => []),
    upsertClassPublicationState: mock.fn(async () => ({})),
};

const vectorStoreMocks = {
    deleteVectorsByMaterialId: mock.fn(async () => true),
    searchSimilar: mock.fn(async () => []),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('uuid', { namedExports: { v4: () => '1234' } });

process.env.DIRECTOR_BUDGET_MONTHLY_USD = '97.50';
process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';

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

test('reprocess-material returns 400 when subjectId is missing', async () => {
    const response = await handlers['reprocess-material'](
        {
            params: { materialId: 'mat-001' },
            query: new URLSearchParams(),
        },
        { log: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 400);
    assert.match(response.body, /subjectId/i);
});

test('reprocess-material returns 404 when material does not exist', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => null);

    const response = await handlers['reprocess-material'](
        {
            params: { materialId: 'missing-mat' },
            query: new URLSearchParams({ subjectId: 'arq-software-2026' }),
        },
        { log: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 404);
});

test('reprocess-material returns 400 when material is not in error state', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => ({
        materialId: 'mat-ready',
        subjectId: 'arq-software-2026',
        status: 'ready',
        filename: 'ready.txt',
        classIds: ['class-1'],
    }));

    const response = await handlers['reprocess-material'](
        {
            params: { materialId: 'mat-ready' },
            query: new URLSearchParams({ subjectId: 'arq-software-2026' }),
        },
        { log: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 400);
    assert.match(response.body, /error/i);
});

test('reprocess-material returns 200 and resets material to pending', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => ({
        materialId: 'mat-error-001',
        subjectId: 'arq-software-2026',
        status: 'error',
        filename: 'error-file.pdf',
        classIds: ['class-1'],
        errorMessage: 'El archivo PDF parece estar escaneado o es una imagen',
        blobUrl: 'https://storage.blob.core.windows.net/class-materials/class-1/mat-error-001-error-file.pdf',
    }));

    storageMocks.loadJson.mock.mockImplementationOnce(async () => ({
        status: 'error',
        errorMessage: 'El archivo PDF parece estar escaneado o es una imagen',
    }));

    const mockedUpsert = stateStoreMocks.upsertMaterialState;
    mockedUpsert.mock.mockImplementationOnce(async (state) => state);

    const response = await handlers['reprocess-material'](
        {
            params: { materialId: 'mat-error-001' },
            query: new URLSearchParams({ subjectId: 'arq-software-2026' }),
        },
        { log: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(vectorStoreMocks.deleteVectorsByMaterialId.mock.calls.length, 1);
});

// #387: el "a medio procesar" del recorrido de recuperación es un material
// detenido en 'processing', que antes quedaba sin ninguna vía de reintento.
test('reprocess-material admite un material detenido en processing', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => ({
        materialId: 'mat-stuck-001',
        subjectId: 'arq-software-2026',
        status: 'processing',
        filename: 'stuck.txt',
        classIds: ['class-06'],
    }));
    const mockedUpsert = stateStoreMocks.upsertMaterialState;
    mockedUpsert.mock.mockImplementationOnce(async (state) => state);

    const response = await handlers['reprocess-material'](
        {
            params: { materialId: 'mat-stuck-001' },
            query: new URLSearchParams({ subjectId: 'arq-software-2026' }),
        },
        { log: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(JSON.parse(response.body).success, true);
});

// #387: el origen de la descarga es el blob real del material; el nombre
// versionado es sólo el destino que vuelve a disparar el pipeline.
test('reprocess-material descarga el blob real y re-sube a un nombre versionado', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => ({
        materialId: 'mat-error-002',
        subjectId: 'arq-software-2026',
        status: 'error',
        filename: 'guia.txt',
        classIds: ['class-06'],
        blobUrl: 'https://storage.blob.core.windows.net/class-materials/arq-software-2026/mat-error-002.txt',
    }));
    stateStoreMocks.upsertMaterialState.mock.mockImplementationOnce(async (state) => state);
    storageMocks.downloadFile.mock.resetCalls();
    storageMocks.uploadFile.mock.resetCalls();

    const response = await handlers['reprocess-material'](
        {
            params: { materialId: 'mat-error-002' },
            query: new URLSearchParams({ subjectId: 'arq-software-2026' }),
        },
        { log: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(
        storageMocks.downloadFile.mock.calls[0].arguments[1],
        'arq-software-2026/mat-error-002.txt',
        'el origen debe ser el blob existente, no el nombre versionado'
    );
    const uploadedName = storageMocks.uploadFile.mock.calls[0].arguments[1];
    assert.match(uploadedName, /^arq-software-2026\/mat-error-002-v\d+\.txt$/);
    assert.strictEqual(storageMocks.downloadFile.mock.calls[0].arguments[1] === uploadedName, false);
});

// #387: si el archivo original falta, el reintento explica qué hacer en vez de
// responder un 500 de infraestructura.
test('reprocess-material responde 409 cuando falta el archivo original', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => ({
        materialId: 'mat-sin-blob',
        subjectId: 'arq-software-2026',
        status: 'error',
        filename: '',
        classIds: ['class-06'],
        blobUrl: '',
    }));

    const response = await handlers['reprocess-material'](
        {
            params: { materialId: 'mat-sin-blob' },
            query: new URLSearchParams({ subjectId: 'arq-software-2026' }),
        },
        { log: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 409);
});
