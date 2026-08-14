import { test, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setupTestEnv } from '../src/test-utils/env.js';

setupTestEnv();

const vectorStoreMocks = {
    listAllVectorIds: mock.fn(),
    fetchVectorsByIds: mock.fn(),
    upsertChunks: mock.fn(),
};
const stateStoreMocks = {
    getMaterialState: mock.fn(),
};

mock.module('../src/services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../src/services/state-store.js', { namedExports: stateStoreMocks });

const { main, ensureVectorValues } = await import('../scripts/reindex-vector-classid.js');

function idList(count) {
    return Array.from({ length: count }, (_, i) => `id${i}`);
}

test('resume with a fabricated checkpoint skips completed batches, uses restored state, rewrites and removes the checkpoint', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-int-'));
    const cpFile = path.join(dir, 'cp.json');

    const allIds = idList(1001); // id0..id1000 → 3 batches de 500
    const batch1Ids = allIds.slice(500, 1000);

    const checkpoint = {
        version: 1,
        completedBatches: 1,
        totalIds: 1001,
        updatedAt: new Date().toISOString(),
        counts: { scanned: 500, skipped: 400, updated: 100, failed: 0 },
        correctedVectors: [{ id: 'id0', metadata: { subjectId: 's1', materialId: 'm1', classId: 'c-early' } }],
        needsResolutionMeta: [{ subjectId: 's1', materialId: 'm2', chunkIndex: 7, _vectorId: 'id42' }],
    };
    fs.writeFileSync(cpFile, JSON.stringify(checkpoint, null, 2));

    const checkpointSnapshots = [];
    const upserted = [];

    vectorStoreMocks.listAllVectorIds.mock.resetCalls();
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => allIds);

    vectorStoreMocks.fetchVectorsByIds.mock.resetCalls();
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => {
        try {
            checkpointSnapshots.push(JSON.parse(fs.readFileSync(cpFile, 'utf-8')));
        } catch {
            // Checkpoint aun no escrito en la primer llamada (batch 0 omitido).
        }

        const vectors = ids.map((id) => {
            if (id === 'id0') {
                return { id, values: [0.9], metadata: { subjectId: 's1', materialId: 'm1' } };
            }
            if (id === 'id42') {
                return { id, values: [0.7], metadata: { subjectId: 's1', materialId: 'm2' } };
            }
            if (id === 'id1000') {
                return { id, values: [0.7], metadata: { subjectId: 's1', materialId: 'm2', chunkIndex: 1000 } };
            }
            return { id, values: [0.5], metadata: { subjectId: 's1', materialId: 'm1', classIds: ['c-new'], chunkIndex: Number(id.slice(2)) } };
        });
        return { vectors, missingIds: [] };
    });

    vectorStoreMocks.upsertChunks.mock.resetCalls();
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async (vectors) => { upserted.push(...vectors); });

    stateStoreMocks.getMaterialState.mock.resetCalls();
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ classIds: ['c-table'] }));

    await main({ checkpointFile: cpFile, resume: true, isDryRun: false });

    // 1. Resume omite los batches completados: el primer fetch arranca en el batch 1.
    const firstFetchIds = vectorStoreMocks.fetchVectorsByIds.mock.calls[0].arguments[0];
    assert.deepStrictEqual(firstFetchIds, batch1Ids);
    assert.ok(firstFetchIds.every(id => Number(id.slice(2)) >= 500), 'no debe re-fetch el batch 0');

    // 2. El checkpoint se reescribe tras cada batch (completedBatches 2 y luego 3).
    const snapshots = checkpointSnapshots.filter(Boolean);
    assert.ok(snapshots.some(s => s.completedBatches === 2), 'checkpoint debe registrar el batch 2');
    assert.ok(snapshots.some(s => s.completedBatches === 3), 'checkpoint debe registrar el batch 3');

    // 3. correctedVectors y needsResolutionMeta restaurados se usan en el upsert.
    assert.strictEqual(upserted.length, 503); // id0 + batch1 (500) + id42 + id1000
    const ids = new Set(upserted.map(v => v.id));
    assert.ok(ids.has('id0'), 'correctedVector restaurado del checkpoint debe estar en el upsert');
    assert.ok(ids.has('id42'), 'needsResolutionMeta restaurado del checkpoint debe resolverse y upsertearse');
    assert.ok(ids.has('id1000'));

    const id0 = upserted.find(v => v.id === 'id0');
    assert.deepStrictEqual(id0.values, [0.9], 'id0 debe re-fetchear sus valores antes del upsert');
    assert.strictEqual(id0.metadata.classId, 'c-early');

    const id42 = upserted.find(v => v.id === 'id42');
    assert.strictEqual(id42.metadata.classId, 'c-table', 'id42 debe resolverse via Table Storage');

    // 4. El checkpoint se elimina al completar la migracion.
    assert.strictEqual(fs.existsSync(cpFile), false, 'el checkpoint debe eliminarse al completar');

    fs.rmdirSync(dir);
});

test('ensureVectorValues returns vectors unchanged when all have values (no refetch)', async () => {
    vectorStoreMocks.fetchVectorsByIds.mock.resetCalls();

    const vectors = [{ id: 'v1', values: [0.1], metadata: {} }];
    const result = await ensureVectorValues(vectors);

    assert.strictEqual(result.skippedCount, 0);
    assert.deepStrictEqual(result.vectors, vectors);
    assert.strictEqual(vectorStoreMocks.fetchVectorsByIds.mock.callCount(), 0);
});

test('ensureVectorValues refetches values for checkpointed vectors and skips unfetchable ones', async () => {
    vectorStoreMocks.fetchVectorsByIds.mock.resetCalls();
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => {
        const vectors = ids
            .filter(id => id === 'id-present')
            .map(id => ({ id, values: [0.8], metadata: {} }));
        return { vectors, missingIds: ids.filter(id => id !== 'id-present') };
    });

    const input = [
        { id: 'id-present', metadata: { classId: 'c1' } }, // checkpointed, sin values → refetch OK
        { id: 'id-absent', metadata: { classId: 'c2' } },  // checkpointed, refetch falla
        { id: 'id-has-values', values: [0.5], metadata: {} },
    ];

    const result = await ensureVectorValues(input);

    assert.strictEqual(result.skippedCount, 1);
    assert.deepStrictEqual(result.vectors.map(v => v.id), ['id-present', 'id-has-values']);
    assert.deepStrictEqual(result.vectors[0].values, [0.8]);
    assert.ok(!result.vectors.some(v => v.id === 'id-absent'), 'vectores sin valores no deben upsertearse');
});
