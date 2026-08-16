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
};
const telemetryMocks = {
    trackVectorQuarantineRun: mock.fn(),
};
const aiMocks = {
    generateEmbeddingsBatch: mock.fn(),
};
const parserMocks = {
    chunkText: mock.fn(),
};

mock.module('../src/services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../src/services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../src/services/storage.js', { namedExports: storageMocks });
mock.module('../src/services/telemetry.js', { namedExports: telemetryMocks });
mock.module('../src/services/ai.js', { namedExports: aiMocks });
mock.module('../src/services/parser.js', { namedExports: parserMocks });
mock.module('uuid', { namedExports: { v4: () => 'run-123' } });

const {
    quarantineMode,
    reindexMaterialMode,
    runCli,
    parseQuarantineArgs,
    parseReindexMaterialArg,
    resolveLectureDate,
    fetchExistingChunksPaginated,
    verifyReindex,
    CliExitError,
} = await import('../scripts/quarantine-reindex-vectors.js');

function tmpDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function idList(count) {
    return Array.from({ length: count }, (_, i) => `id${i}`);
}

// ── CLI parsing ───────────────────────────────────────────────────────────────

test('parseQuarantineArgs uses the quarantine default checkpoint when --checkpoint is absent', () => {
    const args = parseQuarantineArgs([], {});
    assert.strictEqual(args.checkpointFile, 'reindex-quarantine-checkpoint.json');
    assert.strictEqual(args.reindexMaterial, null);
    assert.strictEqual(args.reindexMaterialInvalid, false);
});

test('parseQuarantineArgs honors --checkpoint verbatim (even when it equals the migration default)', () => {
    const args = parseQuarantineArgs(['--checkpoint', 'reindex-classid-checkpoint.json'], {});
    assert.strictEqual(args.checkpointFile, 'reindex-classid-checkpoint.json');
    assert.strictEqual(args.hasExplicitCheckpoint, true);
});

test('parseReindexMaterialArg is the single parser: valid, malformed, missing', () => {
    assert.deepStrictEqual(parseReindexMaterialArg(['--reindex-material', 's1:m1']), {
        reindexMaterial: { subjectId: 's1', materialId: 'm1' },
        reindexMaterialInvalid: false,
    });
    assert.strictEqual(parseReindexMaterialArg(['--reindex-material', 'no-colon']).reindexMaterialInvalid, true);
    assert.strictEqual(parseReindexMaterialArg(['--reindex-material']).reindexMaterialInvalid, true);
    assert.strictEqual(parseReindexMaterialArg(['--reindex-material', '--dry-run']).reindexMaterialInvalid, true);
    assert.strictEqual(parseReindexMaterialArg([]).reindexMaterialInvalid, false);
});

test('runCli --help returns 0 and does not scan', async () => {
    vectorStoreMocks.listAllVectorIds.mock.resetCalls();
    const code = await runCli(['--help'], {});
    assert.strictEqual(code, 0);
    assert.strictEqual(vectorStoreMocks.listAllVectorIds.mock.callCount(), 0);
});

test('runCli malformed --reindex-material aborts exit 2 BEFORE any scan', async () => {
    vectorStoreMocks.listAllVectorIds.mock.resetCalls();
    const code = await runCli(['--reindex-material', 'no-colon'], {});
    assert.strictEqual(code, 2);
    assert.strictEqual(vectorStoreMocks.listAllVectorIds.mock.callCount(), 0);
    assert.strictEqual(stateStoreMocks.getMaterialState.mock.callCount(), 0);
});

// ── quarantineMode: dry-run (Loopback 5) ─────────────────────────────────────

test('quarantineMode dry-run performs no writes, no telemetry, no checkpoint and exits 0 (patch #11)', async () => {
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['v1', 'v2']);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 2 }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id, i) => ({
            id,
            values: [0.1 + i],
            metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'mat-1', chunkIndex: i },
        })),
        missingIds: [],
    }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', classIds: ['c1'] }));
    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => null);

    vectorStoreMocks.upsertChunks.mock.resetCalls();
    storageMocks.saveJson.mock.resetCalls();
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    const dir = tmpDir('quar-dry-');
    const cp = path.join(dir, 'cp.json');

    const code = await quarantineMode({ checkpointFile: cp, resume: false, isDryRun: true });

    assert.strictEqual(code, 0, 'dry-run exit 0');
    assert.strictEqual(vectorStoreMocks.upsertChunks.mock.callCount(), 0, 'no upsertChunks');
    assert.strictEqual(storageMocks.saveJson.mock.callCount(), 0, 'no saveJson');
    assert.strictEqual(fs.existsSync(cp), false, 'no checkpoint write');
    assert.strictEqual(telemetryMocks.trackVectorQuarantineRun.mock.callCount(), 0, 'dry-run no emite telemetria');

    fs.rmSync(dir, { recursive: true, force: true });
});

test('quarantineMode dry-run propagates computed success=false to exit code (no telemetry)', async () => {
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['v1']);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 1 }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'mat-1' } })),
        missingIds: [],
    }));
    // lookup throws (transient outage) → counted failed, NEVER quarantined
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => { throw new Error('table outage'); });
    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => { throw new Error('table outage'); });

    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();
    const dir = tmpDir('quar-dry-fail-');
    const cp = path.join(dir, 'cp.json');

    const code = await quarantineMode({ checkpointFile: cp, resume: false, isDryRun: true });
    assert.strictEqual(code, 1, 'dry-run con failed > 0 → exit 1');
    assert.strictEqual(telemetryMocks.trackVectorQuarantineRun.mock.callCount(), 0, 'dry-run no emite telemetria');

    fs.rmSync(dir, { recursive: true, force: true });
});

// ── quarantineMode: live ─────────────────────────────────────────────────────

test('quarantineMode live quarantines conflicts and normalizes clean vectors', async () => {
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['q1', 'c1']);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 2 }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({
            id,
            values: [0.5],
            metadata: id === 'q1'
                ? { subjectId: 's-wrong', classIds: ['x99'], materialId: 'mat-1', chunkIndex: 0 }
                : { subjectId: 's1', classIds: ['c1'], materialId: 'mat-1', chunkIndex: 1 },
        })),
        missingIds: [],
    }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', classIds: ['c1'] }));

    const upserted = [];
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async (vectors) => { upserted.push(...vectors); });
    storageMocks.saveJson.mock.mockImplementation(async () => {});

    const dir = tmpDir('quar-live-');
    const cp = path.join(dir, 'cp.json');

    const code = await quarantineMode({ checkpointFile: cp, resume: false, isDryRun: false });
    assert.strictEqual(code, 0);

    const all = upserted.flat();
    assert.strictEqual(all.length, 2);
    const q = all.find((v) => v.id === 'q1');
    const c = all.find((v) => v.id === 'c1');
    assert.strictEqual(q.metadata.quarantined, true);
    assert.ok(q.metadata.quarantineReason.includes('subjectId-mismatch'));
    assert.strictEqual(q.metadata.expectedSubjectId, 's1');
    assert.strictEqual(c.metadata.quarantined, false, 'vector limpio normalizado quarantined:false');
    assert.strictEqual(fs.existsSync(cp), false, 'checkpoint eliminado en exito');
    assert.strictEqual(telemetryMocks.trackVectorQuarantineRun.mock.calls.at(-1).arguments[0].success, true);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('quarantineMode live reconciles counts when a vector has no values (failed=1, success=false, checkpoint preserved, excluded from both upserts)', async () => {
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['v1', 'v2']);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 2 }));

    let fetchCall = 0;
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => {
        fetchCall += 1;
        if (fetchCall === 1) {
            return {
                vectors: ids.map((id) => ({
                    id,
                    values: id === 'v1' ? [] : [0.5],
                    metadata: id === 'v1'
                        ? { subjectId: 's-wrong', classIds: ['c1'], materialId: 'mat-1', chunkIndex: 0 }
                        : { subjectId: 's1', classIds: ['c1'], materialId: 'mat-1', chunkIndex: 1 },
                })),
                missingIds: [],
            };
        }
        return { vectors: [], missingIds: ids }; // refetch falla para v1
    });
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', classIds: ['c1'] }));

    const upserted = [];
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async (vectors) => { upserted.push(...vectors); });
    storageMocks.saveJson.mock.mockImplementation(async () => {});
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    const dir = tmpDir('quar-noval-');
    const cp = path.join(dir, 'cp.json');

    const code = await quarantineMode({ checkpointFile: cp, resume: false, isDryRun: false });
    assert.strictEqual(code, 1, 'failed > 0 → exit 1');

    const all = upserted.flat();
    assert.ok(!all.some((v) => v.id === 'v1'), 'vector sin values excluido de AMBOS upserts');
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].id, 'v2');
    assert.strictEqual(all[0].metadata.quarantined, false);

    assert.strictEqual(fs.existsSync(cp), true, 'checkpoint preservado con failed > 0');
    const saved = JSON.parse(fs.readFileSync(cp, 'utf-8'));
    assert.strictEqual(saved.extra.failedVectors.length, 1);
    assert.strictEqual(saved.extra.failedVectors[0].id, 'v1');

    const telem = telemetryMocks.trackVectorQuarantineRun.mock.calls[0].arguments[0];
    assert.strictEqual(telem.success, false);
    assert.strictEqual(telem.failed, 1);
    assert.strictEqual(telem.quarantined, 0, 'conteo reconciliado: v1 no cuenta como quarantined');
    assert.strictEqual(telem.clean, 1);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('quarantineMode never quarantines verified-answer vectors but normalizes them clean', async () => {
    vectorStoreMocks.listAllVectorIds.mock.resetCalls();
    stateStoreMocks.getMaterialState.mock.resetCalls();
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['va1']);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 1 }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { materialType: 'verified-answer', subjectId: 's1', materialId: 'corr-1', classIds: ['c1'] } })),
        missingIds: [],
    }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => null);

    const upserted = [];
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async (vectors) => { upserted.push(...vectors); });
    storageMocks.saveJson.mock.mockImplementation(async () => {});

    const dir = tmpDir('quar-va-');
    const cp = path.join(dir, 'cp.json');

    const code = await quarantineMode({ checkpointFile: cp, resume: false, isDryRun: false });
    assert.strictEqual(code, 0);

    const all = upserted.flat();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].metadata.materialType, 'verified-answer');
    assert.strictEqual(all[0].metadata.quarantined, false, 'verified-answer NUNCA se cuarentena; se normaliza');
    assert.strictEqual(stateStoreMocks.getMaterialState.mock.callCount(), 0, 'no se hace lookup para verified-answer');
    assert.strictEqual(fs.existsSync(cp), false);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('quarantineMode quarantines a vector with no subjectId/classIds (metadata-incomplete)', async () => {
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['legacy1']);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 1 }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { materialId: 'mat-1', chunkIndex: 0 } })),
        missingIds: [],
    }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', classIds: ['c1'] }));
    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', classIds: ['c1'] }));

    const upserted = [];
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async (vectors) => { upserted.push(...vectors); });
    storageMocks.saveJson.mock.mockImplementation(async () => {});

    const dir = tmpDir('quar-mi-');
    const cp = path.join(dir, 'cp.json');

    const code = await quarantineMode({ checkpointFile: cp, resume: false, isDryRun: false });
    assert.strictEqual(code, 0);

    const all = upserted.flat();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].metadata.quarantined, true);
    assert.ok(all[0].metadata.quarantineReason.includes('metadata-incomplete'), 'razon metadata-incomplete en el payload');

    fs.rmSync(dir, { recursive: true, force: true });
});

test('quarantineMode writes the audit report even with zero quarantined vectors (Loopback 5)', async () => {
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['v1']);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 1 }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'mat-1', chunkIndex: 0 } })),
        missingIds: [],
    }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', classIds: ['c1'] }));
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async () => {});
    storageMocks.saveJson.mock.mockImplementation(async () => {});
    storageMocks.saveJson.mock.resetCalls();

    const dir = tmpDir('quar-zero-');
    const cp = path.join(dir, 'cp.json');

    const code = await quarantineMode({ checkpointFile: cp, resume: false, isDryRun: false });
    assert.strictEqual(code, 0);

    const reportCall = storageMocks.saveJson.mock.calls.find((c) => c.arguments[1].endsWith('-report.json'));
    assert.ok(reportCall, 'reporte debe escribirse incluso con 0 cuarentenados');
    assert.strictEqual(reportCall.arguments[2].quarantineCount, 0);
    assert.strictEqual(reportCall.arguments[2].counts.quarantined, 0);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('quarantineMode counts EVERY reason of a dual conflict in quarantineReasons (Loopback 5)', async () => {
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['dual1']);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 1 }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's-wrong', classIds: ['x99'], materialId: 'mat-1', chunkIndex: 0 } })),
        missingIds: [],
    }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', classIds: ['c1'] }));
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async () => {});
    storageMocks.saveJson.mock.mockImplementation(async () => {});

    const dir = tmpDir('quar-dual-');
    const cp = path.join(dir, 'cp.json');

    await quarantineMode({ checkpointFile: cp, resume: false, isDryRun: false });

    const telem = telemetryMocks.trackVectorQuarantineRun.mock.calls.at(-1).arguments[0];
    assert.strictEqual(telem.quarantined, 1);
    assert.strictEqual(telem.quarantineReasons['subjectId-mismatch'], 1);
    assert.strictEqual(telem.quarantineReasons['classId-mismatch'], 1, 'dual conflict no subcuenta');

    fs.rmSync(dir, { recursive: true, force: true });
});

test('quarantineMode aborts exit 2 when listing was truncated (never audits a partial index)', async () => {
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['v1', 'v2']);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 3 }));
    vectorStoreMocks.fetchVectorsByIds.mock.resetCalls();

    const code = await quarantineMode({ checkpointFile: 'irrelevant.json', resume: false, isDryRun: false });
    assert.strictEqual(code, 2);
    assert.strictEqual(vectorStoreMocks.fetchVectorsByIds.mock.callCount(), 0);
});

// ── Resume ───────────────────────────────────────────────────────────────────

test('quarantineMode resume retries previously-skipped vectors and removes the checkpoint on completion', async () => {
    const dir = tmpDir('quar-resume-');
    const cp = path.join(dir, 'cp.json');

    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['v1', 'v2']);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 2 }));

    let valuesAvailable = false; // run 1: v2 sin values; run 2 (resume): todos con values
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => {
        if (!valuesAvailable) {
            return {
                vectors: ids.map((id) => ({
                    id,
                    values: id === 'v2' ? [] : [0.5],
                    metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'mat-1', chunkIndex: 0 },
                })),
                missingIds: [],
            };
        }
        return {
            vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'mat-1', chunkIndex: 0 } })),
            missingIds: [],
        };
    });
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', classIds: ['c1'] }));
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async () => {});
    storageMocks.saveJson.mock.mockImplementation(async () => {});
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    // Run 1 → incompleto (v2 sin values)
    const code1 = await quarantineMode({ checkpointFile: cp, resume: false, isDryRun: false });
    assert.strictEqual(code1, 1);
    assert.strictEqual(fs.existsSync(cp), true);
    const saved = JSON.parse(fs.readFileSync(cp, 'utf-8'));
    assert.strictEqual(saved.extra.failedVectors[0].id, 'v2');

    // Run 2 → resume: v2 reintentado y ahora con values
    valuesAvailable = true;
    const code2 = await quarantineMode({ checkpointFile: cp, resume: true, isDryRun: false });
    assert.strictEqual(code2, 0);
    assert.strictEqual(fs.existsSync(cp), false, 'checkpoint eliminado al completar el resume');

    const telem = telemetryMocks.trackVectorQuarantineRun.mock.calls.at(-1).arguments[0];
    assert.strictEqual(telem.success, true);
    assert.strictEqual(telem.clean, 2);
    assert.strictEqual(telem.failed, 0);

    fs.rmSync(dir, { recursive: true, force: true });
});

// ── Reindex material mode ────────────────────────────────────────────────────

test('runCli routes valid --reindex-material to reindex mode without entering the full scan', async () => {
    vectorStoreMocks.listAllVectorIds.mock.resetCalls();
    stateStoreMocks.getMaterialState.mock.resetCalls();
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => { throw new Error('scan no debe entrar'); });
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({ vectorIds: [], pagination: {} }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({ vectors: [], missingIds: [] }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', materialId: 'mat-1', classIds: ['c1'], type: 'notes', filename: 'file.txt' }));
    storageMocks.loadJson.mock.mockImplementation(async () => ({ extractedText: 'contenido del material', classIds: ['c1'], filename: 'file.txt', priority: 'primary' }));
    parserMocks.chunkText.mock.mockImplementation(() => ['chunk1', 'chunk2']);
    aiMocks.generateEmbeddingsBatch.mock.resetCalls();
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    const code = await runCli(['--reindex-material', 's1:mat-1', '--dry-run'], {});
    assert.strictEqual(code, 0);
    assert.strictEqual(vectorStoreMocks.listAllVectorIds.mock.callCount(), 0, 'scan de indice completo no se entra');
    assert.strictEqual(aiMocks.generateEmbeddingsBatch.mock.callCount(), 0, 'dry-run no consume quota de embeddings');
    assert.strictEqual(telemetryMocks.trackVectorQuarantineRun.mock.callCount(), 0, 'dry-run no emite telemetria (patch #11)');
});

test('reindexMaterialMode live deletes quarantined vectors, re-upserts with quarantined:false and verifies', async () => {
    const dir = tmpDir('reindex-live-');
    vectorStoreMocks.listVectorIds.mock.resetCalls();
    vectorStoreMocks.fetchVectorsByIds.mock.resetCalls();
    vectorStoreMocks.deleteVectorsByMaterialId.mock.resetCalls();
    vectorStoreMocks.upsertChunks.mock.resetCalls();
    storageMocks.saveJson.mock.resetCalls();
    stateStoreMocks.upsertMaterialState.mock.resetCalls();
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({ vectorIds: ['mat-1-chunk-0', 'mat-1-chunk-1'], pagination: {} }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { materialId: 'mat-1', subjectId: 's1', materialType: 'notes', classIds: ['c1'], chunkIndex: 0, lectureDate: '2026-03-05' } })),
        missingIds: [],
    }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', materialId: 'mat-1', classIds: ['c1'], type: 'notes', filename: 'file.txt' }));
    storageMocks.loadJson.mock.mockImplementation(async () => ({ extractedText: 'contenido', classIds: ['c1'], filename: 'file.txt' }));
    parserMocks.chunkText.mock.mockImplementation(() => ['c0', 'c1']);
    aiMocks.generateEmbeddingsBatch.mock.mockImplementation(async (texts) => ({
        embeddings: texts.map(() => [0.1, 0.2]),
        usage: { total_tokens: 10 },
    }));
    vectorStoreMocks.deleteVectorsByMaterialId.mock.mockImplementation(async () => {});
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async () => {});
    storageMocks.saveJson.mock.mockImplementation(async () => {});
    stateStoreMocks.upsertMaterialState.mock.mockImplementation(async () => {});
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    const code = await reindexMaterialMode({ subjectId: 's1', materialId: 'mat-1', isDryRun: false });

    assert.strictEqual(code, 0);
    assert.strictEqual(vectorStoreMocks.deleteVectorsByMaterialId.mock.callCount(), 1);
    assert.strictEqual(vectorStoreMocks.deleteVectorsByMaterialId.mock.calls[0].arguments[0], 'mat-1');

    const upsertCalls = vectorStoreMocks.upsertChunks.mock.calls;
    const lastBatch = upsertCalls.at(-1).arguments[0];
    assert.strictEqual(lastBatch.length, 2);
    for (const v of lastBatch) {
        assert.strictEqual(v.metadata.quarantined, false, 'reindex escribe quarantined:false');
        assert.strictEqual(v.metadata.subjectId, 's1');
        assert.deepStrictEqual(v.metadata.classIds, ['c1']);
        assert.strictEqual(v.metadata.materialType, 'notes');
        assert.strictEqual(v.metadata.lectureDate, '2026-03-05', 'lectureDate preservada de chunk existente');
    }

    // Machine-readable ids + chunkCount writeback
    const idsCall = storageMocks.saveJson.mock.calls.find((c) => c.arguments[1].endsWith('-quarantined-material-ids.json'));
    assert.ok(idsCall, 'debe emitir quarantined-material-ids.json');
    assert.strictEqual(idsCall.arguments[2].quarantinedMaterialIds[0], 'mat-1');
    const writeback = stateStoreMocks.upsertMaterialState.mock.calls[0].arguments[0];
    assert.strictEqual(writeback.chunkCount, 2);

    const telem = telemetryMocks.trackVectorQuarantineRun.mock.calls.at(-1).arguments[0];
    assert.strictEqual(telem.mode, 'reindex');
    assert.strictEqual(telem.success, true);
    assert.strictEqual(telem.chunkCount, 2);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('reindexMaterialMode aborts exit 2 (before delete) when a vector cannot be re-fetched (backup would be incomplete)', async () => {
    vectorStoreMocks.listVectorIds.mock.resetCalls();
    vectorStoreMocks.fetchVectorsByIds.mock.resetCalls();
    vectorStoreMocks.deleteVectorsByMaterialId.mock.resetCalls();
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({ vectorIds: ['mat-1-chunk-0', 'mat-1-chunk-1'], pagination: {} }));
    // Fetch del scan devuelve vectores SIN values → ensureVectorValues debe re-fetchear
    let call = 0;
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => {
        call += 1;
        if (call === 1) {
            return {
                vectors: ids.map((id) => ({ id, values: [], metadata: { materialId: 'mat-1', subjectId: 's1' } })),
                missingIds: [],
            };
        }
        return { vectors: [], missingIds: ids };
    });
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', materialId: 'mat-1', classIds: ['c1'], type: 'notes' }));
    storageMocks.loadJson.mock.mockImplementation(async () => ({ extractedText: 'contenido', classIds: ['c1'] }));
    parserMocks.chunkText.mock.mockImplementation(() => ['c0', 'c1', 'c2']);
    aiMocks.generateEmbeddingsBatch.mock.mockImplementation(async (texts) => ({ embeddings: texts.map(() => [0.1]) }));
    vectorStoreMocks.deleteVectorsByMaterialId.mock.resetCalls();

    await assert.rejects(
        () => reindexMaterialMode({ subjectId: 's1', materialId: 'mat-1', isDryRun: false }),
        (err) => err instanceof CliExitError && err.exitCode === 2 && err.category === 'REINDEX_BACKUP_INCOMPLETE',
    );
    assert.strictEqual(vectorStoreMocks.deleteVectorsByMaterialId.mock.callCount(), 0, 'delete nunca supera al backup');
});

test('reindexMaterialMode aborts exit 2 when CLI subjectId does not match the authoritative record', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 'other', rowKey: 'mat-1', subjectId: 'other', materialId: 'mat-1', classIds: ['c1'] }));
    stateStoreMocks.getMaterialStateById.mock.resetCalls();

    await assert.rejects(
        () => reindexMaterialMode({ subjectId: 's1', materialId: 'mat-1', isDryRun: true }),
        (err) => err instanceof CliExitError && err.exitCode === 2 && err.category === 'SUBJECT_MISMATCH',
    );
});

test('reindexMaterialMode aborts exit 2 when re-chunk produces zero chunks (before delete)', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', materialId: 'mat-1', classIds: ['c1'], type: 'notes' }));
    storageMocks.loadJson.mock.mockImplementation(async () => ({ extractedText: 'contenido' }));
    parserMocks.chunkText.mock.mockImplementation(() => []);
    vectorStoreMocks.deleteVectorsByMaterialId.mock.resetCalls();

    await assert.rejects(
        () => reindexMaterialMode({ subjectId: 's1', materialId: 'mat-1', isDryRun: false }),
        (err) => err instanceof CliExitError && err.exitCode === 2 && err.category === 'ZERO_CHUNKS',
    );
    assert.strictEqual(vectorStoreMocks.deleteVectorsByMaterialId.mock.callCount(), 0);
});

test('reindexMaterialMode catches emit telemetry success:false with error category before rethrowing (Loopback 4)', async () => {
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 'other', rowKey: 'mat-1', subjectId: 'other', materialId: 'mat-1', classIds: ['c1'] }));
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    await assert.rejects(
        () => reindexMaterialMode({ subjectId: 's1', materialId: 'mat-1', isDryRun: false }),
        (err) => err instanceof CliExitError,
    );
    const telem = telemetryMocks.trackVectorQuarantineRun.mock.calls.at(-1).arguments[0];
    assert.strictEqual(telem.mode, 'reindex');
    assert.strictEqual(telem.success, false);
    assert.strictEqual(telem.errorCategory, 'SUBJECT_MISMATCH');
});

// ── fetchExistingChunksPaginated ─────────────────────────────────────────────

test('fetchExistingChunksPaginated iterates multiple pages', async () => {
    vectorStoreMocks.listVectorIds.mock.resetCalls();
    vectorStoreMocks.fetchVectorsByIds.mock.resetCalls();
    let page = 0;
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => {
        page += 1;
        if (page === 1) return { vectorIds: ['m1-chunk-0'], pagination: { next: 'tok-2' } };
        return { vectorIds: ['m1-chunk-1'], pagination: {} };
    });
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { materialId: 'm1' } })),
        missingIds: [],
    }));

    const all = await fetchExistingChunksPaginated('m1', { limit: 500, maxPages: 100 });
    assert.strictEqual(all.length, 2);
    assert.strictEqual(vectorStoreMocks.listVectorIds.mock.callCount(), 2);
    assert.strictEqual(vectorStoreMocks.fetchVectorsByIds.mock.callCount(), 2);
});

test('fetchExistingChunksPaginated aborts on a cyclic pagination token', async () => {
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({ vectorIds: ['m1-chunk-0'], pagination: { next: 'same-token' } }));
    await assert.rejects(
        () => fetchExistingChunksPaginated('m1'),
        (err) => err instanceof CliExitError && err.exitCode === 2 && err.category === 'REINDEX_PAGINATION_LOOP',
    );
});

test('fetchExistingChunksPaginated aborts when any fetch returns missingIds', async () => {
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({ vectorIds: ['m1-chunk-0'], pagination: {} }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async () => ({ vectors: [], missingIds: ['m1-chunk-0'] }));
    await assert.rejects(
        () => fetchExistingChunksPaginated('m1'),
        (err) => err instanceof CliExitError && err.category === 'REINDEX_FETCH_MISSING',
    );
});

// ── resolveLectureDate ───────────────────────────────────────────────────────

test('resolveLectureDate returns null when no date is resolvable (key omitted)', async () => {
    assert.strictEqual(await resolveLectureDate({ extractedText: 'x' }, [], []), null);
});

test('resolveLectureDate precedence: processed → existing chunk → class date', async () => {
    assert.strictEqual(
        await resolveLectureDate({ lectureDate: '2026-03-01' }, [{ metadata: { lectureDate: '2026-03-02' } }], ['c1']),
        '2026-03-01',
    );

    stateStoreMocks.listClassesBySubject.mock.mockImplementation(async () => [{ id: 'c1', date: '2026-03-03' }]);
    assert.strictEqual(
        await resolveLectureDate({ subjectId: 's1' }, [{ metadata: { lectureDate: '2026-03-02' } }], ['c1']),
        '2026-03-02',
        'chunk existente antes que clase',
    );
    assert.strictEqual(
        await resolveLectureDate({ subjectId: 's1' }, [], ['c1']),
        '2026-03-03',
        'clase como ultimo recurso',
    );
    assert.strictEqual(await resolveLectureDate({ subjectId: 's1' }, [], ['c-unknown']), null);
});

test('resolveLectureDate NEVER falls back to processing timestamps', async () => {
    // processedAt/uploadedAt presentes pero NO lectureDate → null (no se usan como fecha de clase)
    stateStoreMocks.listClassesBySubject.mock.mockImplementation(async () => []);
    assert.strictEqual(
        await resolveLectureDate({ subjectId: 's1', processedAt: '2026-08-14T00:00:00Z', uploadedAt: '2026-08-13T00:00:00Z' }, [], ['c1']),
        null,
    );
});

// ── verifyReindex ────────────────────────────────────────────────────────────

test('verifyReindex classIds check runs even when expected sources are empty (requires vector empty)', async () => {
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({ vectorIds: ['m1-chunk-0', 'm1-chunk-1'], pagination: {} }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', materialId: 'm1', materialType: 'notes', classIds: [] } })),
        missingIds: [],
    }));
    const ok = await verifyReindex({
        materialId: 'm1', subjectId: 's1', expectedChunkCount: 2,
        expectedClassIds: [], expectedMaterialType: 'notes', processed: { classIds: [] },
        retries: 1, retryDelayMs: 0,
    });
    assert.strictEqual(ok, true);

    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', materialId: 'm1', materialType: 'notes', classIds: ['c1'] } })),
        missingIds: [],
    }));
    const fail = await verifyReindex({
        materialId: 'm1', subjectId: 's1', expectedChunkCount: 1,
        expectedClassIds: [], expectedMaterialType: 'notes', processed: { classIds: [] },
        retries: 1, retryDelayMs: 0,
    });
    assert.strictEqual(fail, false, 'ambos vacios exigen vector vacio');
});

test('verifyReindex uses processed blob classIds when authoritative lacks them', async () => {
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({ vectorIds: ['m1-chunk-0'], pagination: {} }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', materialId: 'm1', materialType: 'notes', classIds: ['c1', 'c2'] } })),
        missingIds: [],
    }));
    const ok = await verifyReindex({
        materialId: 'm1', subjectId: 's1', expectedChunkCount: 1,
        expectedClassIds: [], expectedMaterialType: 'notes', processed: { classIds: ['c1', 'c2'] },
        retries: 1, retryDelayMs: 0,
    });
    assert.strictEqual(ok, true);
});

test('verifyReindex batches fetches for >1000 chunks', async () => {
    const chunkCount = 1200;
    const fetchedBatches = [];
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({
        vectorIds: Array.from({ length: chunkCount }, (_, i) => `m1-chunk-${i}`),
        pagination: {},
    }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => {
        fetchedBatches.push(ids.length);
        return {
            vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', materialId: 'm1', materialType: 'notes', classIds: ['c1'] } })),
            missingIds: [],
        };
    });

    const ok = await verifyReindex({
        materialId: 'm1', subjectId: 's1', expectedChunkCount: chunkCount,
        expectedClassIds: ['c1'], expectedMaterialType: 'notes', processed: {},
        retries: 1, retryDelayMs: 0,
    });
    assert.strictEqual(ok, true);
    assert.strictEqual(fetchedBatches.length, 3);
    assert.ok(fetchedBatches.every((n) => n <= 500), 'cada fetch <= 500 ids');
    assert.strictEqual(fetchedBatches.reduce((a, b) => a + b, 0), 1200);
});

test('verifyReindex fails when a vector remains quarantined', async () => {
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({ vectorIds: ['m1-chunk-0'], pagination: {} }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', materialId: 'm1', materialType: 'notes', classIds: ['c1'], quarantined: true } })),
        missingIds: [],
    }));
    const ok = await verifyReindex({
        materialId: 'm1', subjectId: 's1', expectedChunkCount: 1,
        expectedClassIds: ['c1'], expectedMaterialType: 'notes', processed: {},
        retries: 1, retryDelayMs: 0,
    });
    assert.strictEqual(ok, false);
});

test('verifyReindex detects orphaned chunks when the material was shortened (patch #8)', async () => {
    // Material 10 chunks → 3 nuevos; los huerfanos 3..9 siguen en el indice.
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({
        vectorIds: ['m1-chunk-0', 'm1-chunk-1', 'm1-chunk-2', 'm1-chunk-9'],
        pagination: {},
    }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', materialId: 'm1', materialType: 'notes', classIds: ['c1'] } })),
        missingIds: [],
    }));
    const ok = await verifyReindex({
        materialId: 'm1', subjectId: 's1', expectedChunkCount: 3,
        expectedClassIds: ['c1'], expectedMaterialType: 'notes', processed: {},
        retries: 1, retryDelayMs: 0,
    });
    assert.strictEqual(ok, false, 'los huerfanos (conteo 4 != 3) deben fallar la verificacion');
});

test('verifyReindex compares classIds as order-insensitive sets and validates singular classId (patch #9)', async () => {
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({ vectorIds: ['m1-chunk-0'], pagination: {} }));
    // Vector classIds en orden distinto al esperado pero mismo conjunto → OK
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', materialId: 'm1', materialType: 'notes', classIds: ['c2', 'c1'] } })),
        missingIds: [],
    }));
    const ok = await verifyReindex({
        materialId: 'm1', subjectId: 's1', expectedChunkCount: 1,
        expectedClassIds: ['c1', 'c2'], expectedMaterialType: 'notes', processed: {},
        retries: 1, retryDelayMs: 0,
    });
    assert.strictEqual(ok, true, 'classIds iguales como conjunto (orden distinto) deben pasar');

    // classId singular que NO pertenece al conjunto classIds → FAIL
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', materialId: 'm1', materialType: 'notes', classIds: ['c1'], classId: 'x99' } })),
        missingIds: [],
    }));
    const fail = await verifyReindex({
        materialId: 'm1', subjectId: 's1', expectedChunkCount: 1,
        expectedClassIds: ['c1'], expectedMaterialType: 'notes', processed: {},
        retries: 1, retryDelayMs: 0,
    });
    assert.strictEqual(fail, false, 'classId singular ajeno al conjunto debe fallar');
});

test('verifyReindex uses listVectorIds prefix count paginated (patch #8 multi-page)', async () => {
    let page = 0;
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => {
        page += 1;
        if (page === 1) return { vectorIds: ['m1-chunk-0'], pagination: { next: 'tok' } };
        return { vectorIds: ['m1-chunk-1'], pagination: {} };
    });
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', materialId: 'm1', materialType: 'notes', classIds: ['c1'] } })),
        missingIds: [],
    }));
    const ok = await verifyReindex({
        materialId: 'm1', subjectId: 's1', expectedChunkCount: 2,
        expectedClassIds: ['c1'], expectedMaterialType: 'notes', processed: {},
        retries: 1, retryDelayMs: 0,
    });
    assert.strictEqual(ok, true);
    assert.strictEqual(page, 2, 'el conteo por prefijo debe paginar');
});

// ── Combos ───────────────────────────────────────────────────────────────────

test('runCli --reindex-material combined with --resume warns resume is not applicable (Loopback 5)', async () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };

    try {
        vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({ vectorIds: [], pagination: {} }));
        stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', materialId: 'mat-1', classIds: ['c1'], type: 'notes' }));
        storageMocks.loadJson.mock.mockImplementation(async () => ({ extractedText: 'x', classIds: ['c1'] }));
        parserMocks.chunkText.mock.mockImplementation(() => ['c0']);
        const code = await runCli(['--reindex-material', 's1:mat-1', '--resume', '--dry-run'], {});
        assert.strictEqual(code, 0);
        assert.ok(
            warnings.some((w) => w.includes('--resume no aplica en modo reindex')),
            `debe advertir que resume no aplica en reindex. Warnings: ${warnings.join(' | ')}`,
        );
    } finally {
        console.warn = originalWarn;
    }
});

// ── Review patches: 1, 2, 3, 5, 7, 12, 13 ────────────────────────────────────

test('quarantineMode resume does not inherit incompleteBatchSeen; a now-complete re-scan converges to exit 0 (patch #1/#18)', async () => {
    const dir = tmpDir('quar-resume-incomplete-');
    const cp = path.join(dir, 'cp.json');

    const checkpoint = {
        version: 1,
        completedBatches: 1,
        totalIds: 1001,
        updatedAt: new Date().toISOString(),
        counts: { scanned: 500, clean: 500, quarantined: 0, unresolvable: 0, failed: 2 },
        extra: {
            kind: 'quarantine',
            quarantineCandidates: [],
            cleanCandidates: idList(500).map((id) => ({ id, metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'm1' } })),
            failedVectors: [{ id: 'id500', metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'm1' } }, { id: 'id501', metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'm1' } }],
            incompleteBatchSeen: true, // el run anterior termino con un batch incompleto
        },
    };
    fs.writeFileSync(cp, JSON.stringify(checkpoint, null, 2));

    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => idList(1001));
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 1001 }));
    // El refetch ahora resuelve TODO (incluidos los 2 failedVectors y el batch re-escanado)
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'm1' } })),
        missingIds: [],
    }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'm1', subjectId: 's1', classIds: ['c1'] }));
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async () => {});
    storageMocks.saveJson.mock.mockImplementation(async () => {});
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    const code = await quarantineMode({ checkpointFile: cp, resume: true, isDryRun: false });

    assert.strictEqual(code, 0, 'resume converge a exit 0 cuando el batch incompleto ahora se completa');
    assert.strictEqual(fs.existsSync(cp), false, 'checkpoint eliminado al converger');

    const telem = telemetryMocks.trackVectorQuarantineRun.mock.calls.at(-1).arguments[0];
    assert.strictEqual(telem.success, true);
    assert.strictEqual(telem.failed, 0);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('quarantineMode resume does not double-process ids restored from the checkpoint (patch #2/#19)', async () => {
    const dir = tmpDir('quar-resume-dedup-');
    const cp = path.join(dir, 'cp.json');

    // checkpoint con completedBatches=1 pero candidatos que CAEN dentro del
    // batch 1 (id500..id999) que el resume va a re-escanear.
    const checkpoint = {
        version: 1,
        completedBatches: 1,
        totalIds: 1001,
        updatedAt: new Date().toISOString(),
        counts: { scanned: 2, clean: 1, quarantined: 1, unresolvable: 0, failed: 0 },
        extra: {
            kind: 'quarantine',
            quarantineCandidates: [{ id: 'id520', metadata: { subjectId: 's-wrong', classIds: ['x99'], materialId: 'm1', chunkIndex: 0 } }],
            cleanCandidates: [{ id: 'id501', metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'm1', chunkIndex: 0 } }],
            failedVectors: [],
            incompleteBatchSeen: false,
        },
    };
    fs.writeFileSync(cp, JSON.stringify(checkpoint, null, 2));

    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => idList(1001));
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 1001 }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({
            id,
            values: [0.5],
            metadata: id === 'id520'
                ? { subjectId: 's-wrong', classIds: ['x99'], materialId: 'm1', chunkIndex: 0 }
                : { subjectId: 's1', classIds: ['c1'], materialId: 'm1', chunkIndex: 0 },
        })),
        missingIds: [],
    }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'm1', subjectId: 's1', classIds: ['c1'] }));

    const upserted = [];
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async (vectors) => { upserted.push(...vectors); });
    storageMocks.saveJson.mock.mockImplementation(async () => {});
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    const code = await quarantineMode({ checkpointFile: cp, resume: true, isDryRun: false });
    assert.strictEqual(code, 0);

    const all = upserted.flat();
    const countById = new Map();
    for (const v of all) {
        countById.set(v.id, (countById.get(v.id) || 0) + 1);
    }
    assert.strictEqual(countById.get('id520'), 1, 'id520 debe upsertearse exactamente una vez');
    assert.strictEqual(countById.get('id501'), 1, 'id501 debe upsertearse exactamente una vez');
    // Los ids del batch 1 (500..999) menos los 2 restaurados + id1000
    assert.strictEqual(all.length, 500 + 2 - 2 + 1);

    const telem = telemetryMocks.trackVectorQuarantineRun.mock.calls.at(-1).arguments[0];
    assert.strictEqual(telem.clean, 500); // id501 + (500-2) del batch1 + id1000
    assert.strictEqual(telem.quarantined, 1); // id520
    assert.strictEqual(telem.failed, 0);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('quarantineMode aborts exit 2 when resuming a checkpoint without the quarantine kind marker (patch #7)', async () => {
    const dir = tmpDir('quar-kind-');
    const cp = path.join(dir, 'cp.json');

    // Checkpoint del runner de migracion classId (sin extra.kind)
    fs.writeFileSync(cp, JSON.stringify({
        version: 1,
        completedBatches: 2,
        totalIds: 1000,
        counts: { scanned: 1000, skipped: 100, updated: 900, failed: 0 },
    }, null, 2));

    vectorStoreMocks.listAllVectorIds.mock.resetCalls();
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    const code = await quarantineMode({ checkpointFile: cp, resume: true, isDryRun: false });
    assert.strictEqual(code, 2);
    assert.strictEqual(vectorStoreMocks.listAllVectorIds.mock.callCount(), 0, 'no se escanea con un checkpoint ajeno');

    fs.rmSync(dir, { recursive: true, force: true });
});

test('quarantineMode truncation guard skips when getIndexStats totalVectorCount is null/undefined (patch #13)', async () => {
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['v1', 'v2']);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: undefined, namespaces: {} }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id, i) => ({ id, values: [0.5], metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'm1', chunkIndex: i } })),
        missingIds: [],
    }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'm1', subjectId: 's1', classIds: ['c1'] }));

    const dir = tmpDir('quar-nullstats-');
    const cp = path.join(dir, 'cp.json');
    const code = await quarantineMode({ checkpointFile: cp, resume: false, isDryRun: false });
    assert.strictEqual(code, 0, 'totalVectorCount null no debe abortar por truncamiento');

    fs.rmSync(dir, { recursive: true, force: true });
});

test('quarantineMode truncation guard is namespace-aware (patch #3)', async () => {
    const prev = process.env.PINECONE_NAMESPACE;
    process.env.PINECONE_NAMESPACE = 'ns-pilot';

    try {
        vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['v1', 'v2']);
        // Indice total 50 (otros namespaces), pero el namespace escaneado tiene 2.
        vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({
            totalVectorCount: 50,
            namespaces: { 'ns-pilot': { vectorCount: 2 }, 'other-ns': { vectorCount: 48 } },
        }));
        vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
            vectors: ids.map((id, i) => ({ id, values: [0.5], metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'm1', chunkIndex: i } })),
            missingIds: [],
        }));
        stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'm1', subjectId: 's1', classIds: ['c1'] }));

        const dir = tmpDir('quar-ns-');
        const cp = path.join(dir, 'cp.json');
        const code = await quarantineMode({ checkpointFile: cp, resume: false, isDryRun: false });
        assert.strictEqual(code, 0, 'con namespace configurado se compara contra el conteo del namespace, no el total del indice');
        fs.rmSync(dir, { recursive: true, force: true });
    } finally {
        if (prev !== undefined) process.env.PINECONE_NAMESPACE = prev;
        else delete process.env.PINECONE_NAMESPACE;
    }
});

test('quarantineMode treats a candidate with EMPTY values returned by ensureVectorValues as failed (patch #5)', async () => {
    vectorStoreMocks.listAllVectorIds.mock.mockImplementation(async () => ['v1', 'v2']);
    vectorStoreMocks.getIndexStats.mock.mockImplementation(async () => ({ totalVectorCount: 2 }));
    let fetchCall = 0;
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => {
        fetchCall += 1;
        if (fetchCall === 1) {
            // v1 sin values en el scan → ensureVectorValues re-fetchea
            return {
                vectors: ids.map((id) => ({ id, values: id === 'v1' ? [] : [0.5], metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'm1' } })),
                missingIds: [],
            };
        }
        // ensureVectorValues devuelve la entrada CON values vacios (en vez de omitirla)
        return { vectors: ids.map((id) => ({ id, values: [], metadata: { subjectId: 's1', classIds: ['c1'], materialId: 'm1' } })), missingIds: [] };
    });
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'm1', subjectId: 's1', classIds: ['c1'] }));

    const upserted = [];
    vectorStoreMocks.upsertChunks.mock.mockImplementation(async (vectors) => { upserted.push(...vectors); });
    storageMocks.saveJson.mock.mockImplementation(async () => {});
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    const dir = tmpDir('quar-emptyvals-');
    const cp = path.join(dir, 'cp.json');
    const code = await quarantineMode({ checkpointFile: cp, resume: false, isDryRun: false });

    assert.strictEqual(code, 1, 'values vacios → failed → exit 1');
    const all = upserted.flat();
    assert.ok(!all.some((v) => v.id === 'v1'), 'vector con values vacios NUNCA se upsertea');
    assert.strictEqual(all.length, 1);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('reindexMaterialMode aborts exit 2 on embeddings/chunks count mismatch before delete (patch #12)', async () => {
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({ vectorIds: ['mat-1-chunk-0'], pagination: {} }));
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [0.5], metadata: { materialId: 'mat-1', subjectId: 's1' } })),
        missingIds: [],
    }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', materialId: 'mat-1', classIds: ['c1'], type: 'notes' }));
    storageMocks.loadJson.mock.mockImplementation(async () => ({ extractedText: 'contenido', classIds: ['c1'] }));
    parserMocks.chunkText.mock.mockImplementation(() => ['c0', 'c1', 'c2']);
    // genera SOLO 2 embeddings para 3 chunks
    aiMocks.generateEmbeddingsBatch.mock.mockImplementation(async () => ({ embeddings: [[0.1], [0.2]], usage: {} }));
    vectorStoreMocks.deleteVectorsByMaterialId.mock.resetCalls();

    await assert.rejects(
        () => reindexMaterialMode({ subjectId: 's1', materialId: 'mat-1', isDryRun: false }),
        (err) => err instanceof CliExitError && err.exitCode === 2 && err.category === 'EMBEDDING_COUNT_MISMATCH',
    );
    assert.strictEqual(vectorStoreMocks.deleteVectorsByMaterialId.mock.callCount(), 0, 'mismatch de embeddings aborta antes de borrar');
});

test('reindexMaterialMode dry-run does not perform the ensureVectorValues refetch (patch #11)', async () => {
    // Existe un vector SIN values: si ensureVectorValues corriera, habria un refetch.
    vectorStoreMocks.listVectorIds.mock.mockImplementation(async () => ({ vectorIds: ['mat-1-chunk-0'], pagination: {} }));
    vectorStoreMocks.fetchVectorsByIds.mock.resetCalls();
    vectorStoreMocks.fetchVectorsByIds.mock.mockImplementation(async (ids) => ({
        vectors: ids.map((id) => ({ id, values: [], metadata: { materialId: 'mat-1', subjectId: 's1' } })),
        missingIds: [],
    }));
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({ partitionKey: 's1', rowKey: 'mat-1', subjectId: 's1', materialId: 'mat-1', classIds: ['c1'], type: 'notes' }));
    storageMocks.loadJson.mock.mockImplementation(async () => ({ extractedText: 'x', classIds: ['c1'] }));
    parserMocks.chunkText.mock.mockImplementation(() => ['c0']);
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();

    const code = await reindexMaterialMode({ subjectId: 's1', materialId: 'mat-1', isDryRun: true });
    assert.strictEqual(code, 0);
    assert.strictEqual(vectorStoreMocks.fetchVectorsByIds.mock.callCount(), 1, 'dry-run: solo el fetch de captura de chunks existentes, sin refetch de values');
    assert.strictEqual(telemetryMocks.trackVectorQuarantineRun.mock.callCount(), 0, 'dry-run sin telemetria');
});
