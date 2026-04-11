import { test, mock } from 'node:test';
import assert from 'node:assert';

const mockSearchResultItems = [];

const searchClientSearchMock = mock.fn(async () => ({
    results: {
        async *[Symbol.asyncIterator]() {
            for (const item of mockSearchResultItems) {
                yield item;
            }
        },
    },
}));

const searchClientMock = {
    search: searchClientSearchMock,
    mergeOrUploadDocuments: mock.fn(async () => ({ results: [] })),
};

const indexClientListIndexesMock = mock.fn(() => ({
    async *[Symbol.asyncIterator]() {
        yield { name: process.env.AZURE_SEARCH_INDEX_NAME || 'dashboard-edu-pilot' };
    },
}));

const indexClientMock = {
    listIndexes: indexClientListIndexesMock,
    createOrUpdateIndex: mock.fn(async () => ({})),
    getIndexStatistics: mock.fn(async () => ({ documentCount: 0 })),
};

mock.module('@azure/search-documents', {
    namedExports: {
        AzureKeyCredential: class AzureKeyCredential {
            constructor(key) {
                this.key = key;
            }
        },
        SearchClient: class SearchClient {
            constructor() {
                return searchClientMock;
            }
        },
        SearchIndexClient: class SearchIndexClient {
            constructor() {
                return indexClientMock;
            }
        },
    },
});

mock.module('@azure/identity', {
    namedExports: {
        DefaultAzureCredential: class DefaultAzureCredential {},
    },
});

process.env.AZURE_SEARCH_ENDPOINT = 'https://fake-search.search.windows.net';
process.env.AZURE_SEARCH_INDEX_NAME = 'test-index';
process.env.AZURE_SEARCH_API_KEY = 'fake-key';

const { querySimilarWithTelemetry } = await import('./vector-store.js');

test('querySimilarWithTelemetry emits success dependency telemetry including provider and index', async () => {
    searchClientSearchMock.mock.resetCalls();
    mockSearchResultItems.length = 0;
    mockSearchResultItems.push({
        score: 0.84,
        document: {
            id: 'doc-1',
            subjectId: 'arq-software-2026',
            classId: 'class-01',
            classIds: ['class-01'],
            materialId: 'm-1',
            materialType: 'transcript',
            chunkIndex: 1,
            sourceFilename: 'class-01-transcript.txt',
            lectureDate: '2026-03-05T00:00:00.000Z',
            text: 'Contenido de prueba',
        },
    });

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
    assert.strictEqual(trackDependency.mock.callCount(), 1);

    const payload = trackDependency.mock.calls[0].arguments[0];
    assert.strictEqual(payload.success, true);
    assert.strictEqual(payload.provider, 'azure-ai-search');
    assert.strictEqual(payload.index, 'test-index');
    assert.strictEqual(payload.resultCode, 200);
    assert.ok(Number(payload.durationMs) >= 0);
});

test('querySimilarWithTelemetry emits failed dependency telemetry when Azure Search throws', async () => {
    const azureError = new Error('search unavailable');
    azureError.status = 503;
    searchClientSearchMock.mock.mockImplementationOnce(async () => {
        throw azureError;
    });

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
    assert.strictEqual(payload.provider, 'azure-ai-search');
    assert.strictEqual(payload.index, 'test-index');
    assert.strictEqual(payload.resultCode, 503);
    assert.ok(Number(payload.durationMs) >= 0);
});

test('upsertChunks should map classId and lectureDate metadata fields', async () => {
    searchClientMock.mergeOrUploadDocuments.mock.resetCalls();

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
                chunkIndex: 7,
                sourceFilename: 'apuntes.docx',
                lectureDate: '2026-03-05T00:00:00.000Z',
                text: 'Texto chunk',
            },
        },
    ]);

    assert.strictEqual(searchClientMock.mergeOrUploadDocuments.mock.callCount(), 1);
    const payload = searchClientMock.mergeOrUploadDocuments.mock.calls[0].arguments[0][0];
    assert.strictEqual(payload.subjectId, 'arq-software-2026');
    assert.strictEqual(payload.classId, 'class-77');
    assert.deepStrictEqual(payload.classIds, ['class-77']);
    assert.strictEqual(payload.materialType, 'notes');
    assert.strictEqual(payload.lectureDate, '2026-03-05T00:00:00.000Z');
});

test('ensureIndexExists should define classId and lectureDate as filterable fields', async () => {
    indexClientMock.createOrUpdateIndex.mock.resetCalls();
    searchClientMock.mergeOrUploadDocuments.mock.resetCalls();

    indexClientListIndexesMock.mock.mockImplementationOnce(() => ({
        async *[Symbol.asyncIterator]() {
            // empty: force index creation path
        },
    }));

    const uniqueIndexName = `test-index-${Date.now()}`;
    process.env.AZURE_SEARCH_INDEX_NAME = uniqueIndexName;

    const { upsertChunks } = await import(`./vector-store.js?schema-test=${Date.now()}`);

    await upsertChunks([
        {
            id: 'doc-schema-1',
            values: [0.1, 0.2, 0.3],
            metadata: {
                subjectId: 'arq-software-2026',
                classId: 'class-01',
                classIds: ['class-01'],
                materialId: 'm-1',
                materialType: 'transcript',
                chunkIndex: 1,
                sourceFilename: 'class-01-transcript.txt',
                lectureDate: '2026-03-05T00:00:00.000Z',
                text: 'Contenido de prueba',
            },
        },
    ]);

    assert.strictEqual(indexClientMock.createOrUpdateIndex.mock.callCount(), 1);
    const indexDefinition = indexClientMock.createOrUpdateIndex.mock.calls[0].arguments[0];
    const classIdField = indexDefinition.fields.find((field) => field.name === 'classId');
    const lectureDateField = indexDefinition.fields.find((field) => field.name === 'lectureDate');

    assert.ok(classIdField, 'classId field should exist in index schema');
    assert.strictEqual(classIdField.filterable, true, 'classId should be filterable');
    assert.ok(lectureDateField, 'lectureDate field should exist in index schema');
    assert.strictEqual(lectureDateField.filterable, true, 'lectureDate should be filterable');

    process.env.AZURE_SEARCH_INDEX_NAME = 'test-index';
});
