import { test, mock } from 'node:test';
import assert from 'node:assert';

// ── UJ-12 (issue #372) ───────────────────────────────────────────────────────
// El acceso para llevarse un material se pide con identidad y matrícula, se
// declara su alcance y su vencimiento, y queda registrado.

process.env.AZURE_STORAGE_ACCOUNT_NAME = 'staccount';
process.env.AZURE_STORAGE_ACCESS_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ userId: 'prof-002', userRoles: ['Docente'] })),
    getAuthenticatedUser: mock.fn(() => ({ userId: 'prof-002', role: 'Docente' })),
};

const enrollmentState = { value: { status: 'active', role: 'teacher' } };
const savedBlobs = [];

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => enrollmentState.value),
    getMaterialState: mock.fn(async () => ({
        id: 'mat-1',
        subjectId: 'arq-software-2026',
        status: 'ready',
        filename: 'clase1_transcripcion.txt',
        blobUrl: 'https://staccount.blob.core.windows.net/class-materials/arq-software-2026/mat-1.txt',
    })),
};

const storageMocks = {
    saveJson: mock.fn(async (container, name, data) => { savedBlobs.push({ container, name, data }); }),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });

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

await import('./material-download.js');

const context = { log: mock.fn(), warn: mock.fn(), error: mock.fn(), correlationId: 'corr-1' };

function makeRequest(query) {
    return { url: `https://func.example/api/material-download?${query}`, headers: { get: () => null }, method: 'GET' };
}

test('material-download exige identidad: sin sesión no entrega nada', async () => {
    authUtilsMocks.getAuthenticatedUser.mock.mockImplementationOnce(() => ({ userId: 'anonymous' }));
    const res = await handlers['material-download'](makeRequest('subjectId=arq-software-2026&materialId=mat-1'), context);
    assert.strictEqual(res.status, 401);
});

test('material-download exige matrícula activa en la materia', async () => {
    enrollmentState.value = null;
    const res = await handlers['material-download'](makeRequest('subjectId=arq-software-2026&materialId=mat-1'), context);
    assert.strictEqual(res.status, 403);
    enrollmentState.value = { status: 'active', role: 'teacher' };
});

test('material-download declara el alcance, el vencimiento y deja constancia', async () => {
    savedBlobs.length = 0;
    const res = await handlers['material-download'](makeRequest('subjectId=arq-software-2026&materialId=mat-1'), context);
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);

    assert.ok(body.downloadUrl.includes('sig='), 'entrega un acceso firmado de un solo blob');
    assert.strictEqual(body.scope.materialId, 'mat-1');
    assert.strictEqual(body.scope.requestedBy, 'prof-002');
    assert.ok(body.expiresAt, 'el vencimiento viaja con la respuesta');
    assert.strictEqual(body.expiresInSeconds, 15 * 60, 'la ventana es acotada y declarada');
    const window = (new Date(body.expiresAt).getTime() - Date.now()) / 1000;
    assert.ok(window > 14 * 60 && window <= 15 * 60 + 5, `ventana realista: ${window}s`);

    assert.strictEqual(savedBlobs.length, 1, 'la extracción se registra');
    assert.strictEqual(savedBlobs[0].data.requestedBy, 'prof-002');
    assert.strictEqual(savedBlobs[0].data.materialId, 'mat-1');
    assert.strictEqual(savedBlobs[0].container, 'compliance');
});

test('material-download responde 409 (no un 500 genérico) si el material no tiene archivo', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementationOnce(async () => ({
        id: 'mat-1', subjectId: 'arq-software-2026', status: 'ready', filename: 'x.txt', blobUrl: undefined,
    }));
    const res = await handlers['material-download'](makeRequest('subjectId=arq-software-2026&materialId=mat-1'), context);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(JSON.parse(res.body).code, 'MATERIAL_BLOB_MISSING');
});
