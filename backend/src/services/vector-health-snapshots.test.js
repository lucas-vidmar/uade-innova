import { test, mock } from 'node:test';
import assert from 'node:assert';

const storageMocks = {
    saveJson: mock.fn(async () => {}),
    listBlobs: mock.fn(async () => []),
    loadJson: mock.fn(async () => null),
    deleteBlob: mock.fn(async () => {}),
};

const vectorStoreMocks = {
    getIndexStats: mock.fn(async () => ({
        totalVectorCount: 15234,
        indexFullness: 0.45,
        namespaces: { 'arq-software-2026': { vectorCount: 15234 } },
    })),
};

mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/vector-store.js', { namedExports: vectorStoreMocks });

const { captureSnapshot, listSnapshots, listSnapshotsWithContent, deleteOlderThan } = await import('./vector-health-snapshots.js');

test('captureSnapshot should fetch stats and save blob', async () => {
    process.env.PINECONE_INDEX_NAME = 'dashboard-edu-pilot';

    const result = await captureSnapshot();

    assert.strictEqual(result.provider, 'pinecone');
    assert.strictEqual(result.indexName, 'dashboard-edu-pilot');
    assert.strictEqual(result.totalVectorCount, 15234);
    assert.strictEqual(result.indexFullness, 0.45);
    assert.ok(result.timestamp);

    assert.strictEqual(storageMocks.saveJson.mock.callCount(), 1);
    const [container, blobName] = storageMocks.saveJson.mock.calls[0].arguments;
    assert.strictEqual(container, 'vector-snapshots');
    assert.ok(blobName.endsWith('.json'));
});

test('captureSnapshot should propagate Pinecone errors', async () => {
    vectorStoreMocks.getIndexStats.mock.mockImplementationOnce(async () => {
        throw new Error('Pinecone unavailable');
    });

    await assert.rejects(() => captureSnapshot(), { message: 'Pinecone unavailable' });
});

test('listSnapshots should return blobs within the time window', async () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const lastMonth = new Date(today);
    lastMonth.setDate(lastMonth.getDate() - 45);
    const oldStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-${String(lastMonth.getDate()).padStart(2, '0')}`;

    storageMocks.listBlobs.mock.mockImplementationOnce(async () => [
        `${todayStr}/2026-06-20T10-00-00-000Z.json`,
        `${oldStr}/2026-05-06T10-00-00-000Z.json`,
    ]);

    const result = await listSnapshots({ days: 30 });

    assert.strictEqual(result.length, 1);
    assert.ok(result[0].startsWith(todayStr));
});

test('listSnapshots should return empty when no blobs exist', async () => {
    storageMocks.listBlobs.mock.mockImplementationOnce(async () => []);

    const result = await listSnapshots({ days: 7 });

    assert.deepStrictEqual(result, []);
});

test('listSnapshotsWithContent should load and return snapshot data', async () => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const blobName = `${dateStr}/2026-06-20T10-00-00-000Z.json`;

    storageMocks.listBlobs.mock.mockImplementationOnce(async () => [blobName]);
    storageMocks.loadJson.mock.mockImplementationOnce(async () => ({
        provider: 'pinecone',
        totalVectorCount: 100,
        indexFullness: 0.3,
        timestamp: '2026-06-20T10:00:00.000Z',
    }));

    const results = await listSnapshotsWithContent({ days: 7 });

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].totalVectorCount, 100);
});

test('deleteOlderThan should delete blobs past retention', async () => {
    const recent = new Date();
    const recentStr = `${recent.getFullYear()}-${String(recent.getMonth() + 1).padStart(2, '0')}-${String(recent.getDate()).padStart(2, '0')}`;
    const oldDate = new Date(recent);
    oldDate.setDate(oldDate.getDate() - 200);
    const oldStr = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}-${String(oldDate.getDate()).padStart(2, '0')}`;

    storageMocks.listBlobs.mock.mockImplementationOnce(async () => [
        `${recentStr}/snap-1.json`,
        `${oldStr}/snap-old.json`,
    ]);

    const deleted = await deleteOlderThan(90);

    assert.strictEqual(deleted, 1);
    assert.strictEqual(storageMocks.deleteBlob.mock.callCount(), 1);
    const deletedName = storageMocks.deleteBlob.mock.calls[0].arguments[1];
    assert.ok(deletedName.includes(oldStr));
});

test('deleteOlderThan should handle delete failures gracefully', async () => {
    const oldDate = new Date('2025-01-01');
    const oldStr = '2025-01-01';

    storageMocks.listBlobs.mock.mockImplementationOnce(async () => [`${oldStr}/snap.json`]);
    storageMocks.deleteBlob.mock.mockImplementationOnce(async () => {
        throw new Error('Storage error');
    });

    const deleted = await deleteOlderThan(90);

    assert.strictEqual(deleted, 0);
});
