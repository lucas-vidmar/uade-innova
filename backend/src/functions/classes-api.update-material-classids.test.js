// #389 — reubicar un material (PATCH /api/materials/{materialId}) tiene que reindexar
// el alcance de sus vectores: el filtro de recuperación usa los metadatos del vector,
// no el estado del material. Sin reindexar, el material sigue respondiendo en el
// encuentro del que se lo quitó y no aparece en el que se lo puso.
import { test, mock } from 'node:test';
import assert from 'node:assert';

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    readDevIdentityHeader: mock.fn((request, name) => request?.headers?.get?.(name) || null),
    parseClientPrincipal: mock.fn(() => ({ userId: 'prof-001', userRoles: ['Docente'] })),
    getAuthenticatedUser: mock.fn(() => ({ userId: 'prof-001' })),
};

const storageMocks = {
    loadJson: mock.fn(async () => null),
    saveJson: mock.fn(async () => true),
    deleteBlob: mock.fn(async () => true),
    moveBlob: mock.fn(async () => true),
    listBlobs: mock.fn(async () => []),
    getTableClient: mock.fn(() => ({ listEntities: async function* () {} })),
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
    upsertMaterialState: mock.fn(async (state) => state),
    deleteClassesBySubject: mock.fn(async () => true),
    deleteMaterialsBySubject: mock.fn(async () => true),
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'student' })),
    getEnrollmentsByUser: mock.fn(async () => []),
    listClassViewsByStudent: mock.fn(async () => []),
    deleteClassViewsBySubject: mock.fn(async () => true),
};

const vectorStoreMocks = {
    deleteVectorsByMaterialId: mock.fn(async () => true),
    searchSimilar: mock.fn(async () => []),
    upsertChunks: mock.fn(async () => true),
    updateMaterialVectorsMetadata: mock.fn(async () => ({ updated: 1, missing: 0 })),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('uuid', { namedExports: { v4: () => '1234' } });

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

const MATERIAL = {
    id: 'mat-389',
    materialId: 'mat-389',
    subjectId: 'arq-software-2026',
    status: 'ready',
    filename: 'apunte.docx',
    type: 'notes',
    classIds: ['class-05', 'class-06'],
};

function patchRequest(body) {
    return { params: { materialId: 'mat-389' }, json: async () => body };
}

const ctx = () => ({ log: mock.fn(), error: mock.fn(), warn: mock.fn() });

test('update-material reindexa los vectores cuando cambian los encuentros (#389)', async () => {
    vectorStoreMocks.updateMaterialVectorsMetadata.mock.resetCalls();
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => ({ ...MATERIAL }));
    stateStoreMocks.upsertMaterialState.mock.resetCalls();

    const response = await handlers['update-material'](
        patchRequest({ subjectId: 'arq-software-2026', classIds: ['class-06'] }),
        ctx()
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(vectorStoreMocks.updateMaterialVectorsMetadata.mock.callCount(), 1);
    assert.deepStrictEqual(
        vectorStoreMocks.updateMaterialVectorsMetadata.mock.calls[0].arguments.slice(0, 2),
        ['mat-389', { classIds: ['class-06'] }]
    );
    assert.strictEqual(stateStoreMocks.upsertMaterialState.mock.callCount(), 1);
    assert.deepStrictEqual(stateStoreMocks.upsertMaterialState.mock.calls[0].arguments[0].classIds, ['class-06']);
});

test('update-material no reindexa si los encuentros no cambian', async () => {
    vectorStoreMocks.updateMaterialVectorsMetadata.mock.resetCalls();
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => ({ ...MATERIAL }));

    const response = await handlers['update-material'](
        patchRequest({ subjectId: 'arq-software-2026', classIds: ['class-05', 'class-06'], reviewed: true }),
        ctx()
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(vectorStoreMocks.updateMaterialVectorsMetadata.mock.callCount(), 0);
});

test('update-material reindexa el tipo cuando cambia (misma metadata del índice)', async () => {
    vectorStoreMocks.updateMaterialVectorsMetadata.mock.resetCalls();
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => ({ ...MATERIAL }));

    const response = await handlers['update-material'](
        patchRequest({ subjectId: 'arq-software-2026', type: 'bibliography' }),
        ctx()
    );

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(
        vectorStoreMocks.updateMaterialVectorsMetadata.mock.calls[0].arguments.slice(0, 2),
        ['mat-389', { materialType: 'bibliography' }]
    );
});

test('update-material responde 500 y no deja estado mentiroso si la reindexación falla (#389)', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => ({ ...MATERIAL }));
    stateStoreMocks.upsertMaterialState.mock.resetCalls();
    vectorStoreMocks.updateMaterialVectorsMetadata.mock.mockImplementationOnce(async () => {
        throw new Error('Pinecone no disponible');
    });

    const response = await handlers['update-material'](
        patchRequest({ subjectId: 'arq-software-2026', classIds: ['class-06'] }),
        ctx()
    );

    assert.strictEqual(response.status, 500);
    assert.match(response.body, /MATERIAL_REINDEX_FAILED/);
    assert.strictEqual(stateStoreMocks.upsertMaterialState.mock.callCount(), 0);
});
