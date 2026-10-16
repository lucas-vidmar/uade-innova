// #389 — updateMaterialVectorsMetadata reescribe el alcance de clases de los vectores de un
// material reutilizando los mismos `values` (sin volver a calcular embeddings) y sin perder
// el resto de los metadatos.
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert';

process.env.PINECONE_API_KEY = 'test-key';
process.env.PINECONE_HOST = 'https://index-test.svc.pinecone.io';
process.env.PINECONE_INDEX_NAME = 'test-index';

const originalFetch = global.fetch;
let calls = [];

function jsonResponse(body) {
    return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
    };
}

before(() => {
    global.fetch = mock.fn(async (url, init) => {
        const path = new URL(url).pathname;
        const payload = init?.body ? JSON.parse(init.body) : null;
        calls.push({ path, payload });

        if (path === '/vectors/list') {
            return jsonResponse({ vectors: [{ id: 'mat-9-chunk-0' }, { id: 'mat-9-chunk-1' }], pagination: {} });
        }
        if (path === '/vectors/fetch') {
            return jsonResponse({
                vectors: {
                    'mat-9-chunk-0': { id: 'mat-9-chunk-0', values: [0.1, 0.2], metadata: { subjectId: 's1', materialId: 'mat-9', classId: 'class-05', classIds: ['class-05', 'class-06'], text: 'hola' } },
                    'mat-9-chunk-1': { id: 'mat-9-chunk-1', values: [0.3, 0.4], metadata: { subjectId: 's1', materialId: 'mat-9', classId: 'class-05', classIds: ['class-05', 'class-06'], text: 'chau' } },
                },
            });
        }
        return jsonResponse({});
    });
});

after(() => { global.fetch = originalFetch; });

const { updateMaterialVectorsMetadata } = await import('./vector-store.js');

test('reescribe classId y classIds de todos los vectores del material conservando values y el resto de los metadatos', async () => {
    calls = [];
    const result = await updateMaterialVectorsMetadata('mat-9', { classIds: ['class-06'] }, { trackDependency: mock.fn() });

    assert.deepStrictEqual(result, { updated: 2, missing: 0 });

    const upsert = calls.find(c => c.path === '/vectors/upsert');
    assert.ok(upsert, 'debe hacer un upsert');
    assert.strictEqual(upsert.payload.vectors.length, 2);
    for (const vector of upsert.payload.vectors) {
        assert.deepStrictEqual(vector.values, vector.id.endsWith('0') ? [0.1, 0.2] : [0.3, 0.4]);
        assert.strictEqual(vector.metadata.classId, 'class-06');
        assert.deepStrictEqual(vector.metadata.classIds, ['class-06']);
        assert.strictEqual(vector.metadata.subjectId, 's1');
        assert.ok(vector.metadata.text);
    }

    const list = calls.find(c => c.path === '/vectors/list');
    assert.strictEqual(list.payload.prefix, 'mat-9-chunk-');
});

test('no toca el índice si no hay metadatos que reescribir', async () => {
    calls = [];
    const result = await updateMaterialVectorsMetadata('mat-9', {}, { trackDependency: mock.fn() });
    assert.deepStrictEqual(result, { updated: 0, missing: 0 });
    assert.strictEqual(calls.length, 0);
});

test('exige un materialId', async () => {
    await assert.rejects(() => updateMaterialVectorsMetadata('', { classIds: ['class-06'] }), /materialId/);
});
