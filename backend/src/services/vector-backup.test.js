import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// UJ-57 / RV3: el resguardo habla con Pinecone (vector-store), con Blob Storage
// (storage) y con telemetría. Lo que importa acá es el par que se midió
// desalineado en el piloto: cuántos vectores enumera `/vectors/list` contra
// cuántos declara el propio índice (`getIndexStats().totalVectorCount`).
let ids = [];
let fetched = [];
let declaredTotal = 0;
let statsThrows = false;
const saved = [];
const telemetry = [];
const deletes = [];

mock.module('./vector-store.js', {
    namedExports: {
        listAllVectorIds: mock.fn(async () => ids),
        fetchVectorsByIds: mock.fn(async (batch) => ({
            vectors: fetched.filter((v) => batch.includes(v.id)),
            missingIds: [],
        })),
        deleteVectorsByFilter: mock.fn(async (filter) => { deletes.push(filter); }),
        getIndexStats: mock.fn(async () => {
            if (statsThrows) throw new Error('describe_index_stats caído');
            return { totalVectorCount: declaredTotal, indexFullness: 0, namespaces: {} };
        }),
    },
});

mock.module('./storage.js', {
    namedExports: {
        saveJson: mock.fn(async (container, name, data) => { saved.push({ container, name, data }); }),
        listBlobs: mock.fn(async () => saved.map((s) => s.name)),
    },
});

mock.module('./telemetry.js', {
    namedExports: {
        trackVectorBackupRun: mock.fn(async (evt) => { telemetry.push(evt); }),
    },
});

const { runVectorBackup } = await import('./vector-backup.js');

function seed({ ids: i = [], vectors: v = [], total = 0, throws = false } = {}) {
    ids = i;
    fetched = v;
    declaredTotal = total;
    statsThrows = throws;
    saved.length = 0;
    telemetry.length = 0;
    deletes.length = 0;
}

test('UJ-57: no guarda un resguardo vacío como completo cuando el índice declara vectores', async () => {
    seed({ ids: [], vectors: [], total: 478 });

    await assert.rejects(
        () => runVectorBackup({ mode: 'backup-only' }),
        (err) => {
            assert.strictEqual(err.code, 'BACKUP_SCAN_INCOMPLETE');
            assert.strictEqual(err.status, 502);
            assert.match(err.message, /478/, 'el mensaje declara cuántos vectores faltan');
            return true;
        }
    );

    assert.strictEqual(saved.length, 0, 'no se escribe ningún blob de resguardo');
    assert.strictEqual(telemetry.length, 1);
    assert.strictEqual(telemetry[0].success, false, 'la corrida queda registrada como fallida');
    assert.strictEqual(telemetry[0].errorCategory, 'RETRIEVAL_FAILURE');
});

test('UJ-57: un resguardo que no enumera no habilita el borrado (backup+cleanup)', async () => {
    seed({ ids: [], vectors: [], total: 478 });

    await assert.rejects(
        () => runVectorBackup({ mode: 'backup+cleanup', subjectScope: 'arq-software-2026' }),
        (err) => err.code === 'BACKUP_SCAN_INCOMPLETE'
    );

    assert.strictEqual(deletes.length, 0, 'no se borra el acervo sin respaldo');
});

test('UJ-57: un resguardo con vectores se completa y declara el total del índice', async () => {
    seed({
        ids: ['m1-chunk-0', 'm1-chunk-1'],
        vectors: [
            { id: 'm1-chunk-0', values: [0.1], metadata: { subjectId: 'arq-software-2026' } },
            { id: 'm1-chunk-1', values: [0.2], metadata: { subjectId: 'arq-software-2026' } },
        ],
        total: 2,
    });

    const result = await runVectorBackup({ mode: 'backup-only' });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.vectorCount, 2);
    assert.strictEqual(result.indexTotalVectorCount, 2, 'el alcance declarado viaja en la respuesta');
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].container, 'vector-backups');
    assert.strictEqual(saved[0].data.vectorCount, 2);
    assert.strictEqual(saved[0].data.indexTotalVectorCount, 2, 'el alcance declarado queda en el paquete');
    assert.ok(saved[0].data.exportedAt, 'el paquete lleva fecha');
    assert.strictEqual(telemetry[0].success, true);
});

test('UJ-57: si no se puede leer el total del índice, el resguardo no se bloquea por eso', async () => {
    seed({ ids: [], vectors: [], total: 0, throws: true });

    const result = await runVectorBackup({ mode: 'backup-only' });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.vectorCount, 0);
    assert.strictEqual(telemetry[0].success, true);
});

test('UJ-57: una unidad sin vectores propios no se confunde con un escaneo incompleto', async () => {
    seed({
        ids: ['otro-chunk-0'],
        vectors: [{ id: 'otro-chunk-0', values: [0.3], metadata: { subjectId: 'otra-materia' } }],
        total: 1,
    });

    const result = await runVectorBackup({ mode: 'backup-only', subjectScope: 'arq-software-2026' });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.vectorCount, 0);
    assert.strictEqual(result.indexTotalVectorCount, 1);
});
