import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Regression tests for #337: POST /api/class-audio/{classId}/generate must
// reach the TTS pipeline (no-op clicks in QA hid a missing success path).
// The student "Generar audio" button binds to this route; these tests pin the
// server contract it depends on: 400 without script / without validation,
// 200 + persisted ttsGeneratedAt + blob upload when validated.

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    readDevIdentityHeader: mock.fn((request, name) => request?.headers?.get?.(name) || null),
    parseClientPrincipal: mock.fn(() => ({ userId: 'alu-001', userRoles: ['authenticated', 'Alumno'] })),
};

const storageMocks = {
    loadJson: mock.fn(async () => null),
    saveJson: mock.fn(async () => ({})),
    listBlobs: mock.fn(async () => []),
    deleteBlob: mock.fn(async () => {}),
    moveBlob: mock.fn(async () => {}),
    uploadFile: mock.fn(async () => 'https://stub.blob/class-audio/class-01.mp3'),
    downloadFile: mock.fn(async () => null),
    getTableClient: mock.fn(() => null),
};

const aiMocks = {
    chatCompletion: mock.fn(async () => ({})),
    generateClassSummary: mock.fn(async () => ({})),
    generateClassMap: mock.fn(async () => ({})),
    generateClassAudio: mock.fn(async () => Buffer.from('fake-mp3')),
    generatePodcastScript: mock.fn(async () => ({})),
};

mock.module('../services/auth-utils.js', { namedExports: { ...authMocks, getAuthenticatedUser: mock.fn(() => ({ userId: 'prof-001' })) } });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/ai.js', { namedExports: aiMocks });
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

await import('./classes-api.js');

const ctx = () => ({ log: () => {}, warn: () => {}, error: () => {} });
const req = (classId) => ({ params: { classId }, method: 'POST', headers: new Map() });

test('generate-class-audio-tts returns 400 when no podcast script exists', async () => {
    storageMocks.loadJson.mock.mockImplementation(async () => null);
    const response = await handlers['generate-class-audio-tts'](req('class-01'), ctx());
    assert.strictEqual(response.status, 400);
    assert.match(JSON.parse(response.body).error, /guión/i);
});

test('generate-class-audio-tts returns 400 when the script is not validated', async () => {
    storageMocks.loadJson.mock.mockImplementation(async () => ({ classId: 'class-01', script: 'Hola', validated: false }));
    const response = await handlers['generate-class-audio-tts'](req('class-01'), ctx());
    assert.strictEqual(response.status, 400);
    assert.match(JSON.parse(response.body).error, /validado/i);
    assert.strictEqual(aiMocks.generateClassAudio.mock.callCount(), 0);
});

test('generate-class-audio-tts generates, uploads and persists ttsGeneratedAt when validated', async () => {
    storageMocks.loadJson.mock.mockImplementation(async () => ({ classId: 'class-01', script: 'Hola', validated: true }));
    const before = aiMocks.generateClassAudio.mock.callCount();
    const response = await handlers['generate-class-audio-tts'](req('class-01'), ctx());
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.ok(body.ttsGeneratedAt, 'persists ttsGeneratedAt so the UI can show the player');
    assert.strictEqual(aiMocks.generateClassAudio.mock.callCount(), before + 1);
    assert.ok(storageMocks.uploadFile.mock.calls.some((c) => c.arguments[1] === 'class-01.mp3'), 'uploads class-01.mp3');
    assert.ok(storageMocks.saveJson.mock.calls.length > 0, 'persists the script with ttsGeneratedAt');
});

test('generate-class-audio-tts returns 403 when the Front Door check fails', async () => {
    authMocks.validateFrontDoorId.mock.mockImplementationOnce(() => false);
    const response = await handlers['generate-class-audio-tts'](req('class-01'), ctx());
    assert.strictEqual(response.status, 403);
});
