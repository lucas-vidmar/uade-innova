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

const { listVectorIds, fetchVectorsByIds, listAllVectorIds, isTransientError, withRetry, querySimilar } = await import('./vector-store.js');

test('isTransientError treats network errors, timeouts, 408, 409, 429 and 5xx as transient', () => {
    assert.strictEqual(isTransientError(new TypeError('fetch failed')), true);
    assert.strictEqual(isTransientError({ code: 'PINECONE_TIMEOUT', status: 504 }), true);
    assert.strictEqual(isTransientError({ status: 408, message: 'request timeout' }), true);
    assert.strictEqual(isTransientError({ status: 409, message: 'conflict' }), true);
    assert.strictEqual(isTransientError({ status: 429, message: 'rate limited' }), true);
    assert.strictEqual(isTransientError({ status: 500, message: 'server error' }), true);
    assert.strictEqual(isTransientError({ status: 503, message: 'unavailable' }), true);
});

test('isTransientError treats 4xx validation errors as non-transient', () => {
    assert.strictEqual(isTransientError({ status: 400, message: 'bad request' }), false);
    assert.strictEqual(isTransientError({ status: 404, message: 'not found' }), false);
});

test('withRetry stops retrying once the total time budget is exhausted', async () => {
    const error = new Error('transient');
    error.status = 503;
    let calls = 0;
    const start = Date.now();

    await assert.rejects(
        withRetry(async () => { calls += 1; throw error; }, {
            maxAttempts: 100,
            baseMs: 1,
            maxMs: 5,
            totalBudgetMs: 30,
        }),
        (err) => {
            assert.strictEqual(err.retried, true);
            assert.ok(err.retryAttempts >= 1);
            return true;
        },
    );

    // Con presupuesto, se abandonan mucho antes de los 100 intentos permitidos.
    assert.ok(calls < 20, `esperado pocos intentos, obtuve ${calls}`);
    assert.ok(Date.now() - start < 2000, 'el retry no debe exceder el presupuesto de tiempo');
});

test('withRetry does not mutate the caller error object when attaching retry metadata', async () => {
    const original = new Error('boom');
    original.status = 500;
    let calls = 0;

    await assert.rejects(
        withRetry(async () => { calls += 1; throw original; }, { maxAttempts: 3, baseMs: 1, maxMs: 5 }),
        (err) => {
            assert.strictEqual(err.retryAttempts, 2);
            assert.strictEqual(err.retried, true);
            return true;
        },
    );

    assert.strictEqual(calls, 3);
    // El error original del caller no debe haber sido mutado.
    assert.strictEqual(original.retryAttempts, undefined);
    assert.strictEqual(original.retried, undefined);
});

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
    assert.strictEqual(request.method, 'GET');
    assert.strictEqual(request.body, undefined);
    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get('limit'), '100');
});

// #452/UJ-56: la operación `list` de Pinecone es GET con query params; enviarla
// como POST con body devolvía una página vacía en el índice real del piloto
// (scanned=0 con 478 vectores declarados), y toda superficie encima leía "la
// unidad no tiene nada indexado". Este test fija el contrato HTTP.
test('listVectorIds issues GET /vectors/list with query params and no JSON body (regression #452)', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ vectors: [{ id: 'a' }], pagination: {} }),
    }));

    await listVectorIds({ limit: 10, prefix: 'mat-', paginationToken: 'tok' });

    const [url, request] = fetchMock.mock.calls[0].arguments;
    assert.strictEqual(request.method, 'GET');
    assert.strictEqual(request.body, undefined, 'la lista no viaja en el cuerpo');
    const parsed = new URL(url);
    assert.strictEqual(parsed.pathname.endsWith('/vectors/list'), true);
    assert.strictEqual(parsed.searchParams.get('limit'), '10');
    assert.strictEqual(parsed.searchParams.get('prefix'), 'mat-');
    assert.strictEqual(parsed.searchParams.get('paginationToken'), 'tok');
});

test('listAllVectorIds follows pagination using GET query params (regression #452)', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementation(async (url) => {
        const token = new URL(url).searchParams.get('paginationToken');
        const body = token === 'page-2'
            ? { vectors: [{ id: 'v3' }], pagination: {} }
            : { vectors: [{ id: 'v1' }, { id: 'v2' }], pagination: { next: 'page-2' } };
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    });

    const ids = await listAllVectorIds({ prefix: 'mat-' });

    assert.deepStrictEqual(ids, ['v1', 'v2', 'v3']);
    assert.strictEqual(fetchMock.mock.callCount(), 2);
    const [, second] = fetchMock.mock.calls[1].arguments;
    assert.strictEqual(second.method, 'GET');
    const parsedSecond = new URL(fetchMock.mock.calls[1].arguments[0]);
    assert.strictEqual(parsedSecond.searchParams.get('paginationToken'), 'page-2');

    // Restaurar la implementación por defecto del archivo.
    fetchMock.mock.mockImplementation(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({}) }));
});

test('listVectorIds passes prefix and paginationToken as query params', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ vectors: [], pagination: {} }),
    }));

    await listVectorIds({ limit: 50, prefix: 'mat-', paginationToken: 'tok-abc' });

    const [url] = fetchMock.mock.calls[0].arguments;
    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get('limit'), '50');
    assert.strictEqual(parsed.searchParams.get('prefix'), 'mat-');
    assert.strictEqual(parsed.searchParams.get('paginationToken'), 'tok-abc');
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

    const [url] = fetchMock.mock.calls[0].arguments;
    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get('namespace'), 'test-ns');
});

test('fetchVectorsByIds returns vector data and empty missingIds from Pinecone /vectors/fetch', async () => {
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

    assert.strictEqual(result.vectors.length, 2);
    assert.strictEqual(result.vectors[0].id, 'vec-1');
    assert.deepStrictEqual(result.vectors[0].values, [0.1, 0.2]);
    assert.strictEqual(result.vectors[0].metadata.classId, 'c1');
    assert.strictEqual(result.vectors[1].id, 'vec-2');
    assert.deepStrictEqual(result.vectors[1].metadata.classIds, ['c2']);
    assert.deepStrictEqual(result.missingIds, []);

    // Verify it's a GET request
    const [url] = fetchMock.mock.calls[0].arguments;
    assert.strictEqual(typeof url, 'string');
    assert.strictEqual(url.includes('/vectors/fetch'), true);
    assert.strictEqual(url.includes('ids=vec-1'), true);
    assert.strictEqual(url.includes('ids=vec-2'), true);
});

test('fetchVectorsByIds reports missingIds for IDs absent from Pinecone', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
            vectors: {
                'vec-1': { id: 'vec-1', values: [0.1], metadata: { classId: 'c1' } },
            },
        }),
    }));

    const result = await fetchVectorsByIds(['vec-1', 'vec-2', 'vec-3']);

    assert.strictEqual(result.vectors.length, 1);
    assert.strictEqual(result.vectors[0].id, 'vec-1');
    assert.deepStrictEqual(result.missingIds, ['vec-2', 'vec-3']);
});

test('fetchVectorsByIds returns empty vectors and missingIds for empty/no ids', async () => {
    fetchMock.mock.resetCalls();

    let result = await fetchVectorsByIds([]);
    assert.deepStrictEqual(result, { vectors: [], missingIds: [] });

    result = await fetchVectorsByIds(['', null, undefined]);
    assert.deepStrictEqual(result, { vectors: [], missingIds: [] });

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

test('listVectorIds retries transient 429 then succeeds', async () => {
    fetchMock.mock.resetCalls();
    let callCount = 0;
    fetchMock.mock.mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
            return { ok: false, status: 429, text: async () => JSON.stringify({ message: 'rate limited' }) };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ vectors: [{ id: 'v-1' }], pagination: {} }) };
    });

    const result = await listVectorIds({ limit: 100 });

    assert.strictEqual(result.vectorIds.length, 1);
    assert.strictEqual(result.vectorIds[0], 'v-1');
    assert.strictEqual(fetchMock.mock.callCount(), 2);
});

test('listVectorIds throws CategorizedError after retry exhaustion on persistent 5xx', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementation(async () => ({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ message: 'Service Unavailable' }),
    }));

    await assert.rejects(
        listVectorIds({ limit: 100 }),
        (err) => {
            assert.strictEqual(err.name, 'CategorizedError');
            assert.strictEqual(err.errorCategory, 'RETRIEVAL_FAILURE');
            assert.strictEqual(err.retryAttempts, 2);
            assert.strictEqual(err.retried, true);
            return true;
        },
    );
    assert.strictEqual(fetchMock.mock.callCount(), 3);
});

test('listVectorIds fails immediately on 4xx validation error (no retry)', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'Invalid request', code: 'VALIDATION_ERROR' }),
    }));

    await assert.rejects(
        listVectorIds({ limit: 100 }),
        (err) => {
            assert.strictEqual(err.status, 400);
            assert.strictEqual(err.name, 'Error');
            return true;
        },
    );
    assert.strictEqual(fetchMock.mock.callCount(), 1);
});

test('fetchVectorsByIds fails immediately on 4xx validation error (no retry)', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'Invalid request' }),
    }));

    await assert.rejects(
        fetchVectorsByIds(['vec-1']),
        (err) => {
            assert.strictEqual(err.status, 400);
            assert.strictEqual(err.name, 'Error');
            return true;
        },
    );
    assert.strictEqual(fetchMock.mock.callCount(), 1);
});

test('querySimilar passes the filter (including the quarantined exclusion) through to the Pinecone payload (Task 4.5)', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ matches: [] }),
    }));

    const filter = { subjectId: { $eq: 'arq-software-2026' }, quarantined: { $ne: true } };
    await querySimilar([0.1, 0.2, 0.3], filter, 5);

    assert.strictEqual(fetchMock.mock.callCount(), 1);
    const [url, request] = fetchMock.mock.calls[0].arguments;
    assert.ok(url.includes('/query'));
    const body = JSON.parse(request.body);
    assert.deepStrictEqual(body.filter, filter, 'el filtro (con quarantined $ne true) debe llegar al payload de Pinecone');
    assert.strictEqual(body.topK, 5);
});

test('querySimilar omits the filter key when the filter is empty (no filter leak)', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ matches: [] }),
    }));

    await querySimilar([0.1], null, 5);
    const [, request] = fetchMock.mock.calls[0].arguments;
    const body = JSON.parse(request.body);
    assert.strictEqual(body.filter, undefined);
});
