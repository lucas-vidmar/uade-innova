import { test, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setupTestEnv } from '../src/test-utils/env.js';

setupTestEnv();

const vectorStoreMocks = {
    listAllVectorIds: mock.fn(),
    listVectorIds: mock.fn(),
    fetchVectorsByIds: mock.fn(),
    upsertChunks: mock.fn(),
    deleteVectorsByMaterialId: mock.fn(),
    getIndexStats: mock.fn(),
};
const stateStoreMocks = {
    getMaterialState: mock.fn(),
    getMaterialStateById: mock.fn(),
    listClassesBySubject: mock.fn(),
    upsertMaterialState: mock.fn(),
};
const storageMocks = {
    saveJson: mock.fn(),
    loadJson: mock.fn(),
    getTableClient: mock.fn(() => ({
        createTable: mock.fn(async () => {}),
        listEntities: mock.fn(() => ({ [Symbol.asyncIterator]: async function* () {} })),
        upsertEntity: mock.fn(async () => {}),
        getEntity: mock.fn(async () => ({})),
    })),
};
const telemetryMocks = {
    trackVectorQuarantineRun: mock.fn(),
};

mock.module('../src/services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../src/services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../src/services/storage.js', { namedExports: storageMocks });
mock.module('../src/services/telemetry.js', { namedExports: telemetryMocks });
mock.module('uuid', { namedExports: { v4: () => 'run-int-1' } });

const { quarantineMode } = await import('../scripts/quarantine-reindex-vectors.js');

function idList(count) {
    return Array.from({ length: count }, (_, i) => `id${i}`);
}

test('resume with a fabricated checkpoint: skips completed batches, backup has values, quarantined payloads, checkpoint removed on completion', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quarantine-int-'));
    const cpFile = path.join(dir, 'cp.json');

    const allIds = idList(1001); // id0..id1000 → 3 batches de 500
    const batch1Ids = allIds.slice(500, 1000);

    // Checkpoint fabricado: batch 0 ya procesado, con 1 candidato a cuarentena
    // y 1 candidato limpio restaurado (sin values, se re-fetchean).
    const checkpoint = {
        version: 1,
        completedBatches: 1,
        totalIds: 1001,
        updatedAt: new Date().toISOString(),
        counts: { scanned: 2, clean: 1, quarantined: 1, unresolvable: 0, failed: 0 },
        extra: {
            kind: 'quarantine',
            quarantineCandidates: [
                { id: 'id0', metadata: { subjectId: 's-wrong', classIds: ['x1'], materialId: 'm1', chunkIndex: 0 } },
            ],
            cleanCandidates: [
                { id: 'id1', metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'm1', chunkIndex: 1 } },
            ],
            failedVectors: [],
            incompleteBatchSeen: false,
        },
    };
    fs.writeFileSync(cpFile, JSON.stringify(checkpoint, null, 2));

    vectorStoreMocks.listAllVectorIds.mock.resetCalls();
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => allIds);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 1001 }));

    vectorStoreMocks.fetchVectorsByIds.mock.resetCalls();
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({
            id,
            values: [0.5],
            metadata: {
                subjectId: 's1',
                classIds: ['c1'],
                materialId: 'm1',
                chunkIndex: Number(id.slice(2)),
            },
        })),
        missingIds: [],
    }));

    const upserted = [];
    vectorStoreMocks.upsertChunks.mock.resetCalls();
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async (vectors) => { upserted.push(...vectors); });

    stateStoreMocks.getMaterialState.mock.resetCalls();
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({
        partitionKey: 's1',
        rowKey: 'm1',
        subjectId: 's1',
        classIds: ['c1'],
    }));

    const savedBlobs = [];
    storageMocks.saveJson.mock.resetCalls();
    storageMocks.saveJson.mock.mockImplementation(async (container, blobName, data) => {
        savedBlobs.push({ container, blobName, data });
    });
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    const code = await quarantineMode({ checkpointFile: cpFile, resume: true, isDryRun: false });

    // 1. Resume omite los batches completados: el primer fetch arranca en el batch 1.
    assert.strictEqual(code, 0, 'run completo → exit 0');
    const firstFetchIds = vectorStoreMocks.fetchVectorsByIds.mock.calls[0].arguments[0];
    assert.deepStrictEqual(firstFetchIds, batch1Ids, 'no debe re-fetch el batch 0');

    // 2. El backup pre-cuarentena se escribe y TODOS sus vectores tienen values no vacios.
    const backup = savedBlobs.find((b) => b.blobName === 'run-int-1.json');
    assert.ok(backup, 'backup blob debe escribirse');
    assert.strictEqual(backup.container, 'vector-quarantine');
    assert.ok(Array.isArray(backup.data.vectors) && backup.data.vectors.length > 0, 'backup con vectores');
    for (const v of backup.data.vectors) {
        assert.ok(Array.isArray(v.values) && v.values.length > 0, `backup vector ${v.id} debe tener values no vacios`);
    }

    // 3. Payloads: id0 (restaurado del checkpoint) se cuarentena con flag; los limpios normalizan.
    const all = upserted.flat();
    assert.strictEqual(all.length, 503); // id0 + id1 + batch1(500) + id1000
    const id0 = all.find((v) => v.id === 'id0');
    assert.strictEqual(id0.metadata.quarantined, true, 'id0 restaurado se re-clasifica y se cuarentena');
    assert.ok(id0.metadata.quarantineReason.includes('subjectId-mismatch'));
    assert.strictEqual(id0.metadata.expectedSubjectId, 's1');
    assert.strictEqual(id0.values.length, 1, 'valores re-fetcheados para vectores restaurados');

    const cleanOnes = all.filter((v) => v.id !== 'id0');
    assert.ok(cleanOnes.length === 502);
    for (const v of cleanOnes) {
        assert.strictEqual(v.metadata.quarantined, false, `vector limpio ${v.id} normalizado quarantined:false`);
    }

    // 4. El checkpoint se elimina al completar.
    assert.strictEqual(fs.existsSync(cpFile), false, 'checkpoint eliminado al completar');

    // 5. Reporte siempre escrito.
    const report = savedBlobs.find((b) => b.blobName.endsWith('-report.json'));
    assert.ok(report, 'reporte de auditoria debe escribirse');
    assert.strictEqual(report.data.quarantineCount, 1);

    // 6. Telemetria final exitosa con conteos reconciliados.
    const telem = telemetryMocks.trackVectorQuarantineRun.mock.calls.at(-1).arguments[0];
    assert.strictEqual(telem.success, true);
    assert.strictEqual(telem.quarantined, 1);
    assert.strictEqual(telem.clean, 502);
    assert.strictEqual(telem.failed, 0);

    fs.rmdirSync(dir);
});
