import { test, mock } from 'node:test';
import assert from 'node:assert';
import { setupTestEnv } from '../test-utils/env.js';

const fetchMock = mock.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({}),
}));

global.fetch = fetchMock;

setupTestEnv();

const { listVectorIds, fetchVectorsByIds, listAllVectorIds } = await import('./vector-store.js');

test('listVectorIds returns vector IDs from Pinecone /vectors/list', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
            vectors: [{ id: 'vec-1' }, { id: 'vec-2' }, { id: 'vec-3' }],
            pagination: { next: 'page2-token' },
        }),
    }));

    const result = await listVectorIds({ limit: 100 });

    assert.strictEqual(result.vectorIds.length, 3);
    assert.deepStrictEqual(result.vectorIds, ['vec-1', 'vec-2', 'vec-3']);
    assert.strictEqual(result.pagination.next, 'page2-token');

    assert.strictEqual(fetchMock.mock.callCount(), 1);
    const [url, request] = fetchMock.mock.calls[0].arguments;
    assert.strictEqual(url.includes('/vectors/list'), true);
    const body = JSON.parse(request.body);
    assert.strictEqual(body.limit, 100);
});

test('listVectorIds passes prefix and paginationToken to payload', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ vectors: [], pagination: {} }),
    }));

    await listVectorIds({ limit: 50, prefix: 'mat-', paginationToken: 'tok-abc' });

    const [, request] = fetchMock.mock.calls[0].arguments;
    const body = JSON.parse(request.body);
    assert.strictEqual(body.limit, 50);
    assert.strictEqual(body.prefix, 'mat-');
    assert.strictEqual(body.paginationToken, 'tok-abc');
});

test('listVectorIds includes namespace when set', async () => {
    process.env.PINECONE_NAMESPACE = 'test-ns';
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ vectors: [], pagination: {} }),
    }));

    await listVectorIds({ limit: 100 });
    delete process.env.PINECONE_NAMESPACE;

    const [, request] = fetchMock.mock.calls[0].arguments;
    const body = JSON.parse(request.body);
    assert.strictEqual(body.namespace, 'test-ns');
});

test('fetchVectorsByIds returns vector data from Pinecone /vectors/fetch', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
            vectors: {
                'vec-1': { id: 'vec-1', values: [0.1, 0.2], metadata: { classId: 'c1', subjectId: 'subj-1' } },
                'vec-2': { id: 'vec-2', values: [0.3, 0.4], metadata: { classIds: ['c2'], subjectId: 'subj-1' } },
            },
        }),
    }));

    const result = await fetchVectorsByIds(['vec-1', 'vec-2']);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].id, 'vec-1');
    assert.deepStrictEqual(result[0].values, [0.1, 0.2]);
    assert.strictEqual(result[0].metadata.classId, 'c1');
    assert.strictEqual(result[1].id, 'vec-2');
    assert.deepStrictEqual(result[1].metadata.classIds, ['c2']);

    // Verify it's a GET request
    const [url] = fetchMock.mock.calls[0].arguments;
    assert.strictEqual(typeof url, 'string');
    assert.strictEqual(url.includes('/vectors/fetch'), true);
    assert.strictEqual(url.includes('ids=vec-1'), true);
    assert.strictEqual(url.includes('ids=vec-2'), true);
});

test('fetchVectorsByIds returns empty array for empty/no ids', async () => {
    fetchMock.mock.resetCalls();

    let result = await fetchVectorsByIds([]);
    assert.deepStrictEqual(result, []);

    result = await fetchVectorsByIds(['', null, undefined]);
    assert.deepStrictEqual(result, []);

    // No fetch calls made
    assert.strictEqual(fetchMock.mock.callCount(), 0);
});

test('fetchVectorsByIds includes namespace when set', async () => {
    process.env.PINECONE_NAMESPACE = 'test-ns';
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ vectors: {} }),
    }));

    await fetchVectorsByIds(['vec-1']);
    delete process.env.PINECONE_NAMESPACE;

    const [url] = fetchMock.mock.calls[0].arguments;
    assert.strictEqual(url.includes('namespace=test-ns'), true);
});

test('listAllVectorIds iterates over pagination to collect all IDs', async () => {
    fetchMock.mock.resetCalls();
    let callCount = 0;
    fetchMock.mock.mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    vectors: [{ id: 'a-1' }, { id: 'a-2' }],
                    pagination: { next: 'page2' },
                }),
            };
        }
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                vectors: [{ id: 'b-1' }],
                pagination: {},
            }),
        };
    });

    const allIds = await listAllVectorIds();

    assert.deepStrictEqual(allIds, ['a-1', 'a-2', 'b-1']);
    assert.strictEqual(fetchMock.mock.callCount(), 2);
});

test('listVectorIds throws on Pinecone error status', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ message: 'Service Unavailable' }),
    }));

    await assert.rejects(listVectorIds({ limit: 100 }));
});

test('fetchVectorsByIds throws on Pinecone error status', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ message: 'Internal Server Error' }),
    }));

    await assert.rejects(fetchVectorsByIds(['vec-1']));
});
