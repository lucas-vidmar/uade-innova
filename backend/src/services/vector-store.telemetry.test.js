import { test, mock } from 'node:test';
import assert from 'node:assert';

const fetchMock = mock.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ matches: [] }),
}));

global.fetch = fetchMock;

process.env.PINECONE_HOST = 'https://test-index-test.svc.pinecone.io';
process.env.PINECONE_INDEX_NAME = 'test-index';
process.env.PINECONE_API_KEY = 'fake-key';

const { querySimilarWithTelemetry } = await import('./vector-store.js');

test('querySimilarWithTelemetry emits success dependency telemetry including provider and index', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
            matches: [
                {
                    id: 'doc-1',
                    score: 0.84,
                    metadata: {
                        subjectId: 'arq-software-2026',
                        classId: 'class-01',
                        classIds: ['class-01'],
                        materialId: 'm-1',
                        materialType: 'transcript',
                        materialPriority: 'primary',
                        chunkIndex: 1,
                        sourceFilename: 'class-01-transcript.txt',
                        lectureDate: '2026-03-05T00:00:00.000Z',
                        text: 'Contenido de prueba',
                    },
                },
            ],
        }),
    }));

    const trackDependency = mock.fn(async () => {});

    const matches = await querySimilarWithTelemetry(
        [0.1, 0.2, 0.3],
        { subjectId: { $eq: 'arq-software-2026' } },
        5,
        { trackDependency },
    );

    assert.strictEqual(Array.isArray(matches), true);
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].metadata.classId, 'class-01');
    assert.strictEqual(matches[0].metadata.materialPriority, 'primary');
    assert.strictEqual(trackDependency.mock.callCount(), 1);

    const payload = trackDependency.mock.calls[0].arguments[0];
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.provider, 'pinecone');
    assert.strictEqual(payload.index, 'test-index');
    assert.strictEqual(payload.resultCode, 200);
    assert.ok(Number(payload.durationMs) >= 0);
});

test('querySimilarWithTelemetry emits failed dependency telemetry when Pinecone fails', async () => {
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ message: 'pinecone unavailable' }),
    }));

    const trackDependency = mock.fn(async () => {});

    await assert.rejects(
        querySimilarWithTelemetry(
            [0.1, 0.2, 0.3],
            { subjectId: { $eq: 'arq-software-2026' } },
            5,
            { trackDependency },
        ),
    );

    assert.strictEqual(trackDependency.mock.callCount(), 1);
    const payload = trackDependency.mock.calls[0].arguments[0];
    assert.strictEqual(payload.success, false);
    assert.strictEqual(payload.provider, 'pinecone');
    assert.strictEqual(payload.index, 'test-index');
    assert.strictEqual(payload.resultCode, 503);
    assert.ok(Number(payload.durationMs) >= 0);
});

test('upsertChunks should map classId and lectureDate metadata fields', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ upsertedCount: 1 }),
    }));

    const { upsertChunks } = await import('./vector-store.js');

    await upsertChunks([
        {
            id: 'doc-upsert-1',
            values: [0.1, 0.2, 0.3],
            metadata: {
                subjectId: 'arq-software-2026',
                classId: 'class-77',
                classIds: ['class-77'],
                materialId: 'mat-77',
                materialType: 'notes',
                materialPriority: 'primary',
                chunkIndex: 7,
                sourceFilename: 'apuntes.docx',
                lectureDate: '2026-03-05T00:00:00.000Z',
                text: 'Texto chunk',
            },
        },
    ]);

    assert.strictEqual(fetchMock.mock.callCount(), 1);
    const [url, request] = fetchMock.mock.calls[0].arguments;
    assert.strictEqual(url.endsWith('/vectors/upsert'), true);
    const body = JSON.parse(request.body);
    const payload = body.vectors[0].metadata;
    assert.strictEqual(payload.subjectId, 'arq-software-2026');
    assert.strictEqual(payload.classId, 'class-77');
    assert.deepStrictEqual(payload.classIds, ['class-77']);
    assert.strictEqual(payload.materialType, 'notes');
    assert.strictEqual(payload.materialPriority, 'primary');
    assert.strictEqual(payload.lectureDate, '2026-03-05T00:00:00.000Z');
});
