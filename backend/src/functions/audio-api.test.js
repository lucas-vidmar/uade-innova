import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Regression tests for #337: GET /api/class-audio/{classId} es el único lector
// que sirve el audio del podcast a quien lo escucha (el reproductor del detalle
// de clase). Los derivados se guardan con alcance de materia desde #328
// (`class-audio/{subjectId}/{classId}.mp3` y
// `class-audio-scripts/{subjectId}/{classId}.json`); un lector que busque el
// nombre suelto (`{classId}.mp3` / `{classId}.json`) mira un documento que nadie
// escribe y responde 404 aunque el guión esté avalado y el audio generado.

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    readDevIdentityHeader: mock.fn((request, name) => request?.headers?.get?.(name) || null),
    parseClientPrincipal: mock.fn(() => ({ userId: 'alu-003', userRoles: ['authenticated', 'Alumno'] })),
    getAuthenticatedUser: mock.fn(() => ({ userId: 'alu-003' })),
    setStashedIdentity: mock.fn(() => {}),
};

const storageMocks = {
    loadJson: mock.fn(async () => null),
    saveJson: mock.fn(async () => true),
    listBlobs: mock.fn(async () => []),
    deleteBlob: mock.fn(async () => true),
    moveBlob: mock.fn(async () => true),
    getTableClient: mock.fn(() => null),
    uploadFile: mock.fn(async () => 'https://stub.blob/class-audio/class-01.mp3'),
    downloadFile: mock.fn(async () => null),
};

const aiMocks = {
    chatCompletion: mock.fn(async () => ({})),
    generateClassSummary: mock.fn(async () => ({})),
    generateClassMap: mock.fn(async () => ({})),
    generateClassAudio: mock.fn(async () => Buffer.from('fake-mp3')),
    generatePodcastScript: mock.fn(async () => ({})),
};

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active' })),
    getEnrollmentsBySubject: mock.fn(async () => []),
    listClassesBySubject: mock.fn(async () => []),
    upsertClassPublicationState: mock.fn(async () => ({})),
};

mock.module('../middleware/with-auth.js', {
    namedExports: { withAuth: (handler) => async (request, context) => handler(request, context) },
});
mock.module('../middleware/with-correlation.js', {
    namedExports: { withCorrelation: (handler) => handler },
});
mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/ai.js', { namedExports: aiMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });

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

await import('./audio-api.js');

const SUBJECT = 'arq-software-2026';
const SCOPED_SCRIPT = `${SUBJECT}/class-01.json`;
const SCOPED_AUDIO = `${SUBJECT}/class-01.mp3`;

const ctx = () => ({ log: () => {}, warn: () => {}, error: () => {} });
const req = (classId, subjectId = SUBJECT) => ({
    params: { classId },
    method: 'GET',
    headers: new Map(),
    query: new URLSearchParams(subjectId ? { subjectId } : {}),
});

const get = (classId, subjectId) => handlers['get-class-audio'](req(classId, subjectId), ctx());

test('get-class-audio sirve el audio ya generado de la materia', async () => {
    storageMocks.downloadFile.mock.mockImplementation(async (container, blobName) =>
        (container === 'class-audio' && blobName === SCOPED_AUDIO ? Buffer.from('mp3-guardado') : null));
    const response = await get('class-01');
    assert.strictEqual(response.status, 200, 'el derivado de la materia se entrega');
    assert.strictEqual(response.headers['Content-Type'], 'audio/mpeg');
    assert.ok(
        storageMocks.downloadFile.mock.calls.some((c) => c.arguments[1] === SCOPED_AUDIO),
        'busca el audio en el alcance de materia',
    );
});

test('get-class-audio genera el audio desde el guión avalado de la materia y lo guarda ahí', async () => {
    storageMocks.downloadFile.mock.mockImplementation(async () => null);
    storageMocks.loadJson.mock.mockImplementation(async (container, blobName) =>
        (container === 'class-audio-scripts' && blobName === SCOPED_SCRIPT
            ? { classId: 'class-01', subjectId: SUBJECT, script: 'Bienvenidos a la clase.', validated: true }
            : null));
    const before = aiMocks.generateClassAudio.mock.callCount();
    const response = await get('class-01');
    assert.strictEqual(response.status, 200, 'el guión avalado de la materia alcanza para generar');
    assert.strictEqual(aiMocks.generateClassAudio.mock.callCount(), before + 1);
    assert.ok(
        storageMocks.uploadFile.mock.calls.some(
            (c) => c.arguments[0] === 'class-audio' && c.arguments[1] === SCOPED_AUDIO && c.arguments[3] === 'audio/mpeg',
        ),
        'guarda el audio generado con alcance de materia',
    );
});

test('get-class-audio no entrega audio mientras el guión de la materia no está avalado', async () => {
    storageMocks.downloadFile.mock.mockImplementation(async () => null);
    storageMocks.loadJson.mock.mockImplementation(async (container, blobName) =>
        (container === 'class-audio-scripts' && blobName === SCOPED_SCRIPT
            ? { classId: 'class-01', subjectId: SUBJECT, script: 'Bienvenidos a la clase.', validated: false }
            : null));
    const before = aiMocks.generateClassAudio.mock.callCount();
    const response = await get('class-01');
    assert.strictEqual(response.status, 404);
    assert.strictEqual(aiMocks.generateClassAudio.mock.callCount(), before, 'no gasta voz sin aval');
});

test('get-class-audio conserva el audio heredado como respaldo de la materia', async () => {
    storageMocks.downloadFile.mock.mockImplementation(async (container, blobName) =>
        (container === 'class-audio' && blobName === 'class-01.mp3' ? Buffer.from('mp3-heredado') : null));
    const response = await get('class-01');
    assert.strictEqual(response.status, 200, 'el derivado sin alcance sigue sirviéndose');
    assert.ok(
        storageMocks.downloadFile.mock.calls.some((c) => c.arguments[1] === SCOPED_AUDIO),
        'primero busca el derivado de la materia',
    );
});
