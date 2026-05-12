import { test, mock } from 'node:test';
import assert from 'node:assert';

const fetchMock = mock.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({}),
}));

global.fetch = fetchMock;

process.env.PINECONE_HOST = 'https://test-index-test.svc.pinecone.io';
process.env.PINECONE_INDEX_NAME = 'test-index';
process.env.PINECONE_API_KEY = 'fake-key';
delete process.env.PINECONE_NAMESPACE;

const { listAllVectorIds, fetchVectorsByIds, upsertChunks } = await import('../src/services/vector-store.js');

function resolveClassId(metadata = {}, materialLookup = {}) {
    if (metadata.classId) return { classId: metadata.classId, source: 'existing' };

    if (Array.isArray(metadata.classIds) && metadata.classIds.length > 0 && metadata.classIds[0]) {
        return { classId: metadata.classIds[0], source: 'classIds[0]' };
    }

    if (metadata.materialId && materialLookup && materialLookup[metadata.materialId] && Array.isArray(materialLookup[metadata.materialId]) && materialLookup[metadata.materialId].length > 0) {
        return { classId: materialLookup[metadata.materialId][0], source: 'table-storage' };
    }

    return { classId: null, source: 'unresolved' };
}

const DRY_RUN_FLAG = '--dry-run';
const DRY_RUN_ENV = 'DRY_RUN';

function isDryRunMode(argv, env) {
    return env === 'true' || (Array.isArray(argv) && argv.includes(DRY_RUN_FLAG));
}

const FETCH_BATCH_SIZE = 500;

function buildMaterialLookupSync(metadataList, tableMap) {
    const lookup = {};
    for (const meta of metadataList) {
        if (!meta.classId && (!Array.isArray(meta.classIds) || meta.classIds.length === 0)) {
            if (meta.materialId && tableMap[meta.materialId]) {
                lookup[meta.materialId] = tableMap[meta.materialId];
            }
        }
    }
    return lookup;
}

test('resolveClassId returns existing classId when present', () => {
    const result = resolveClassId({ classId: 'class-5', classIds: ['class-5'] });
    assert.strictEqual(result.classId, 'class-5');
    assert.strictEqual(result.source, 'existing');
});

test('resolveClassId falls back to classIds[0] when classId missing', () => {
    const result = resolveClassId({ classIds: ['class-3', 'class-4'] });
    assert.strictEqual(result.classId, 'class-3');
    assert.strictEqual(result.source, 'classIds[0]');
});

test('resolveClassId returns null when both fields missing and no lookup match', () => {
    const result = resolveClassId({ subjectId: 's1', materialId: 'm1' });
    assert.strictEqual(result.classId, null);
    assert.strictEqual(result.source, 'unresolved');
});

test('resolveClassId uses table-storage lookup when available', () => {
    const lookup = { 'm1': ['class-7'] };
    const result = resolveClassId({ subjectId: 's1', materialId: 'm1' }, lookup);
    assert.strictEqual(result.classId, 'class-7');
    assert.strictEqual(result.source, 'table-storage');
});

test('resolveClassId skips lookup when classIds present', () => {
    const lookup = { 'm1': ['class-from-table'] };
    const result = resolveClassId({ classIds: ['class-4'], materialId: 'm1' }, lookup);
    assert.strictEqual(result.classId, 'class-4');
    assert.strictEqual(result.source, 'classIds[0]');
});

test('resolveClassId with empty classIds falls back to Table Storage', () => {
    const lookup = { 'm1': ['class-8'] };
    const result = resolveClassId({ classIds: [], subjectId: 's1', materialId: 'm1' }, lookup);
    assert.strictEqual(result.classId, 'class-8');
    assert.strictEqual(result.source, 'table-storage');
});

test('resolveClassId with null lookup returns unresolved', () => {
    const result = resolveClassId({ subjectId: 's1', materialId: 'm1' }, null);
    assert.strictEqual(result.classId, null);
    assert.strictEqual(result.source, 'unresolved');
});

test('resolveClassId with empty lookup returns unresolved', () => {
    const result = resolveClassId({ subjectId: 's1', materialId: 'm1' }, {});
    assert.strictEqual(result.classId, null);
    assert.strictEqual(result.source, 'unresolved');
});

test('dry-run detection via --dry-run flag', () => {
    assert.strictEqual(isDryRunMode(['node', 'script.js', '--dry-run'], undefined), true);
    assert.strictEqual(isDryRunMode(['node', 'script.js'], undefined), false);
});

test('dry-run detection via DRY_RUN env var', () => {
    assert.strictEqual(isDryRunMode([], 'true'), true);
    assert.strictEqual(isDryRunMode([], 'false'), false);
    assert.strictEqual(isDryRunMode([], undefined), false);
});

test('migration skips vectors with existing classId', () => {
    const meta = { classId: 'c1', classIds: ['c1'], subjectId: 's1' };
    const needsUpdate = !meta.classId;
    assert.strictEqual(needsUpdate, false);
});

test('migration identifies vectors missing classId', () => {
    const meta = { classIds: ['c3'], subjectId: 's1' };
    const needsUpdate = !meta.classId;
    assert.strictEqual(needsUpdate, true);
});

test('buildMaterialLookupSync creates entries for vectors missing both classId and classIds', () => {
    const metadataList = [
        { materialId: 'm1', subjectId: 's1', classId: 'c1' },         // skip - has classId
        { materialId: 'm2', subjectId: 's1', classIds: ['c2'] },       // skip - has classIds
        { materialId: 'm3', subjectId: 's1' },                          // needs lookup
        { materialId: 'm4', subjectId: 's1', classIds: [] },            // needs lookup (empty array)
    ];
    const tableMap = { 'm3': ['c9'], 'm4': ['c10'] };

    const lookup = buildMaterialLookupSync(metadataList, tableMap);

    assert.strictEqual(Object.keys(lookup).length, 2);
    assert.deepStrictEqual(lookup['m3'], ['c9']);
    assert.deepStrictEqual(lookup['m4'], ['c10']);
});

test('buildMaterialLookupSync skips materialIds not in tableMap', () => {
    const metadataList = [
        { materialId: 'm1', subjectId: 's1' },
    ];
    const tableMap = {}; // empty

    const lookup = buildMaterialLookupSync(metadataList, tableMap);

    assert.strictEqual(Object.keys(lookup).length, 0);
});

test('fetchVectorsByIds correctly handles the Pinecone fetch response format', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
            vectors: {
                'mat1-chunk-0': {
                    id: 'mat1-chunk-0',
                    values: [0.5, 0.6],
                    metadata: {
                        subjectId: 's1',
                        classIds: ['class-01'],
                        materialId: 'mat1',
                        chunkIndex: 0,
                        sourceFilename: 'file.txt',
                        lectureDate: '2026-03-05',
                    },
                },
            },
        }),
    }));

    const result = await fetchVectorsByIds(['mat1-chunk-0']);
    assert.strictEqual(result.length, 1);

    const meta = result[0].metadata;
    const needsUpdate = !meta.classId;
    assert.strictEqual(needsUpdate, true);

    const resolved = resolveClassId(meta);
    assert.strictEqual(resolved.classId, 'class-01');
    assert.strictEqual(resolved.source, 'classIds[0]');
});

test('listAllVectorIds returns IDs from Paginated list endpoint', async () => {
    fetchMock.mock.resetCalls();
    fetchMock.mock.mockImplementation(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
            vectors: [{ id: 'v1' }, { id: 'v2' }],
            pagination: {},
        }),
    }));

    const ids = await listAllVectorIds();
    assert.strictEqual(ids.length, 2);
    assert.deepStrictEqual(ids, ['v1', 'v2']);
});
