import { test, mock } from 'node:test';
import assert from 'node:assert';
import { setupTestEnv } from '../test-utils/env.js';

const fetchMock = mock.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ matches: [] }),
}));

global.fetch = fetchMock;

setupTestEnv();

const {
    querySimilarWithTelemetry,
    listVectorIds,
    fetchVectorsByIds,
    listAllVectorIds,
} = await import('./vector-store.js');

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
        { trackDependency, correlationId: 'test-corr-id-001' },
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
    assert.strictEqual(payload.correlationId, 'test-corr-id-001');
    assert.ok(Number(payload.durationMs) >= 0);
});

test('querySimilarWithTelemetry emits failed dependency telemetry when Pinecone fails after retry exhaustion', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementation(async () => ({
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
            { trackDependency, correlationId: 'test-corr-id-002' },
        ),
    );

    assert.strictEqual(trackDependency.mock.callCount(), 1);
    const payload = trackDependency.mock.calls[0].arguments[0];
    assert.strictEqual(payload.success, false);
    assert.strictEqual(payload.provider, 'pinecone');
    assert.strictEqual(payload.index, 'test-index');
    assert.strictEqual(payload.resultCode, 503);
    assert.strictEqual(payload.correlationId, 'test-corr-id-002');
    assert.ok(Number(payload.durationMs) >= 0);
});

test('listVectorIds emits success dependency telemetry with operation vector.list', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ vectors: [{ id: 'vec-1' }], pagination: {} }),
    }));

    const trackDependency = mock.fn(async () => {});

    const result = await listVectorIds({ limit: 100 }, { trackDependency, correlationId: 'corr-list-001' });

    assert.strictEqual(result.vectorIds.length, 1);
    assert.strictEqual(trackDependency.mock.callCount(), 1);
    const payload = trackDependency.mock.calls[0].arguments[0];
    assert.strictEqual(payload.operation, 'vector.list');
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.provider, 'pinecone');
    assert.strictEqual(payload.index, 'test-index');
    assert.strictEqual(payload.resultCode, 200);
    assert.strictEqual(payload.correlationId, 'corr-list-001');
});

test('listVectorIds records failed dependency telemetry after retry exhaustion', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementation(async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ message: 'Internal Server Error' }),
    }));

    const trackDependency = mock.fn(async () => {});

    await assert.rejects(listVectorIds({ limit: 100 }, { trackDependency, correlationId: 'corr-list-002' }));

    assert.strictEqual(trackDependency.mock.callCount(), 1);
    const payload = trackDependency.mock.calls[0].arguments[0];
    assert.strictEqual(payload.operation, 'vector.list');
    assert.strictEqual(payload.success, false);
    assert.strictEqual(payload.resultCode, 500);
    assert.strictEqual(payload.correlationId, 'corr-list-002');
    // Telemetria distingue falla tras reintentos agotados
    assert.strictEqual(payload.properties.retryAttempts, 2);
    assert.strictEqual(payload.properties.retried, true);
});

test('telemetry failure never fails the business operation', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ vectors: [{ id: 'vec-1' }], pagination: {} }),
    }));

    const trackDependency = mock.fn(async () => { throw new Error('telemetry down'); });

    const result = await listVectorIds({ limit: 100 }, { trackDependency });

    // La operacion de negocio tuvo exito a pesar del fallo de telemetria.
    assert.strictEqual(result.vectorIds.length, 1);
});

test('fetchVectorsByIds emits success dependency telemetry with operation vector.fetch', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
            vectors: { 'vec-1': { id: 'vec-1', values: [0.1], metadata: { classId: 'c1' } } },
        }),
    }));

    const trackDependency = mock.fn(async () => {});

    const result = await fetchVectorsByIds(['vec-1', 'vec-2'], {}, { trackDependency, correlationId: 'corr-fetch-001' });

    assert.strictEqual(result.vectors.length, 1);
    assert.deepStrictEqual(result.missingIds, ['vec-2']);
    assert.strictEqual(trackDependency.mock.callCount(), 1);
    const payload = trackDependency.mock.calls[0].arguments[0];
    assert.strictEqual(payload.operation, 'vector.fetch');
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.resultCode, 200);
    assert.strictEqual(payload.correlationId, 'corr-fetch-001');
});

test('listAllVectorIds emits a single dependency telemetry event with operation vector.listAll', async () => {
    fetchMock.mock.resetCalls();
    let callCount = 0;
    fetchMock.mock.mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    vectors: [{ id: 'a-1' }],
                    pagination: { next: 'page2' },
                }),
            };
        }
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ vectors: [{ id: 'b-1' }], pagination: {} }),
        };
    });

    const trackDependency = mock.fn(async () => {});

    const allIds = await listAllVectorIds({}, { trackDependency, correlationId: 'corr-all-001' });

    assert.deepStrictEqual(allIds, ['a-1', 'b-1']);
    assert.strictEqual(fetchMock.mock.callCount(), 2);
    assert.strictEqual(trackDependency.mock.callCount(), 1);
    const payload = trackDependency.mock.calls[0].arguments[0];
    assert.strictEqual(payload.operation, 'vector.listAll');
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.resultCode, 200);
    assert.strictEqual(payload.correlationId, 'corr-all-001');
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
