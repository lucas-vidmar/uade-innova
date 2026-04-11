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
