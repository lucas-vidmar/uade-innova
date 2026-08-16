import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
    DEFAULT_CHECKPOINT_FILE,
    CHECKPOINT_VERSION,
    parseReindexArgs,
    checkpointPath,
    loadCheckpoint,
    writeCheckpoint,
    removeCheckpoint,
    getStartIndex,
    buildResumePlan,
    warnIfIndexChanged,
} from '../../scripts/reindex-checkpoint.js';

const BATCH_SIZE = 500;

test('parseReindexArgs defaults to dry-run off, no resume, default checkpoint file', () => {
    const args = parseReindexArgs([], {});
    assert.strictEqual(args.isDryRun, false);
    assert.strictEqual(args.resume, false);
    assert.strictEqual(args.showHelp, false);
    assert.strictEqual(args.checkpointFile, DEFAULT_CHECKPOINT_FILE);
});

test('parseReindexArgs detects --dry-run, --resume, --checkpoint and --help', () => {
    const args = parseReindexArgs(['--dry-run', '--resume', '--checkpoint', './my-cp.json', '--help'], {});
    assert.strictEqual(args.isDryRun, true);
    assert.strictEqual(args.resume, true);
    assert.strictEqual(args.showHelp, true);
    assert.strictEqual(args.checkpointFile, './my-cp.json');
});

test('parseReindexArgs detects DRY_RUN env var', () => {
    assert.strictEqual(parseReindexArgs([], { DRY_RUN: 'true' }).isDryRun, true);
    assert.strictEqual(parseReindexArgs([], { DRY_RUN: 'false' }).isDryRun, false);
});

test('parseReindexArgs falls back to default checkpoint when --checkpoint has no value or next token is a flag', () => {
    const noValue = parseReindexArgs(['--resume', '--checkpoint'], {});
    assert.strictEqual(noValue.checkpointFile, DEFAULT_CHECKPOINT_FILE);

    const nextIsFlag = parseReindexArgs(['--checkpoint', '--resume'], {});
    assert.strictEqual(nextIsFlag.checkpointFile, DEFAULT_CHECKPOINT_FILE);
    assert.strictEqual(nextIsFlag.resume, true);
});

test('writeCheckpoint and loadCheckpoint round-trip completedBatches and counts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-cp-'));
    const file = path.join(dir, 'cp.json');

    writeCheckpoint(file, {
        completedBatches: 3,
        totalIds: 1500,
        counts: { scanned: 1500, skipped: 100, updated: 200, failed: 10 },
        correctedVectors: [{ id: 'v1', values: [0.1, 0.2], metadata: { classId: 'c1' } }],
        needsResolutionMeta: [{ materialId: 'm1', subjectId: 's1', _vectorId: 'v2', _values: [0.3] }],
    });

    const loaded = loadCheckpoint(file);
    assert.ok(loaded);
    assert.strictEqual(loaded.version, 1);
    assert.strictEqual(loaded.completedBatches, 3);
    assert.strictEqual(loaded.totalIds, 1500);
    assert.deepStrictEqual(loaded.counts, { scanned: 1500, skipped: 100, updated: 200, failed: 10 });
    assert.ok(loaded.updatedAt);

    // correctedVectors se persisten sin values para mantener liviano el archivo
    assert.deepStrictEqual(loaded.correctedVectors, [{ id: 'v1', metadata: { classId: 'c1' } }]);
    assert.ok(!('values' in loaded.correctedVectors[0]));

    // needsResolutionMeta se persiste sin _values (pass 2 re-fetches valores frescos)
    assert.strictEqual(loaded.needsResolutionMeta.length, 1);
    assert.strictEqual(loaded.needsResolutionMeta[0]._vectorId, 'v2');
    assert.ok(!('_values' in loaded.needsResolutionMeta[0]));

    removeCheckpoint(file);
    fs.rmdirSync(dir);
});

test('writeCheckpoint stores caller extra under a reserved namespace without clobbering core fields (Loopback 2)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-cp-extra-'));
    const file = path.join(dir, 'cp.json');

    writeCheckpoint(file, {
        completedBatches: 2,
        totalIds: 1000,
        counts: { scanned: 1000, clean: 900, quarantined: 90, unresolvable: 5, failed: 5 },
        // El estado del caller intenta "colisionar" con campos core
        extra: {
            counts: { hacked: true },
            completedBatches: 999,
            version: 'overwrite',
            failedVectors: [{ id: 'v1', metadata: { subjectId: 's1' } }],
            quarantineCandidates: [{ id: 'q1', metadata: { subjectId: 's1' } }],
            incompleteBatchSeen: true,
        },
    });

    const loaded = loadCheckpoint(file);
    assert.ok(loaded);

    // Core fields NO fueron clobbereados por extra
    assert.strictEqual(loaded.version, 1);
    assert.strictEqual(loaded.completedBatches, 2);
    assert.strictEqual(loaded.totalIds, 1000);
    assert.deepStrictEqual(loaded.counts, { scanned: 1000, clean: 900, quarantined: 90, unresolvable: 5, failed: 5 });

    // El estado del caller sobrevive bajo el namespace `extra`
    assert.ok(loaded.extra, 'extra namespace debe existir');
    assert.strictEqual(loaded.extra.counts.hacked, true);
    assert.strictEqual(loaded.extra.completedBatches, 999);
    assert.strictEqual(loaded.extra.version, 'overwrite');
    assert.deepStrictEqual(loaded.extra.failedVectors, [{ id: 'v1', metadata: { subjectId: 's1' } }]);
    assert.strictEqual(loaded.extra.incompleteBatchSeen, true);

    removeCheckpoint(file);
    fs.rmdirSync(dir);
});

test('writeCheckpoint omits extra when not provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-cp-noextra-'));
    const file = path.join(dir, 'cp.json');

    writeCheckpoint(file, { completedBatches: 1, totalIds: 500 });
    const loaded = loadCheckpoint(file);
    assert.ok(loaded);
    assert.strictEqual(loaded.extra, undefined);

    removeCheckpoint(file);
    fs.rmdirSync(dir);
});

test('loadCheckpoint returns null when file does not exist', () => {
    const loaded = loadCheckpoint(path.join(os.tmpdir(), 'does-not-exist-cp.json'));
    assert.strictEqual(loaded, null);
});

test('loadCheckpoint returns null for invalid JSON or invalid shape', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-cp-invalid-'));
    const badJson = path.join(dir, 'bad.json');
    const badShape = path.join(dir, 'shape.json');
    fs.writeFileSync(badJson, '{ not valid json');
    fs.writeFileSync(badShape, JSON.stringify({ version: 1, totalIds: 10 }));

    assert.strictEqual(loadCheckpoint(badJson), null);
    assert.strictEqual(loadCheckpoint(badShape), null);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('loadCheckpoint rejects checkpoints with a foreign version', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-cp-version-'));
    const foreign = path.join(dir, 'foreign.json');
    fs.writeFileSync(foreign, JSON.stringify({ version: 999, completedBatches: 2, totalIds: 1500 }));

    assert.strictEqual(loadCheckpoint(foreign), null);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('writeCheckpoint coerces completedBatches/totalIds to integers and rejects invalid values', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-cp-coerce-'));
    const file = path.join(dir, 'cp.json');

    writeCheckpoint(file, { completedBatches: '2', totalIds: '1500' });
    const loaded = loadCheckpoint(file);
    assert.strictEqual(loaded.completedBatches, 2);
    assert.strictEqual(loaded.totalIds, 1500);

    // Valores invalidos (NaN/undefined) no deben escribir un checkpoint corrupto.
    const invalidFile = path.join(dir, 'invalid.json');
    writeCheckpoint(invalidFile, { completedBatches: undefined, totalIds: 1500 });
    assert.strictEqual(fs.existsSync(invalidFile), false);

    writeCheckpoint(file, { completedBatches: 'not-a-number', totalIds: 1500 });
    assert.deepStrictEqual(loadCheckpoint(file), loaded);

    removeCheckpoint(file);
    fs.rmdirSync(dir);
});

test('warnIfIndexChanged warns only on material index drift and never blocks', () => {
    // Sin drift material → no advierte.
    assert.strictEqual(warnIfIndexChanged({ totalIds: 1000, version: CHECKPOINT_VERSION, completedBatches: 1 }, 1005), false);
    assert.strictEqual(warnIfIndexChanged(null, 1000), false);

    // Drift material (indice duplicado) → advierte (retorna true), pero no lanza.
    assert.strictEqual(warnIfIndexChanged({ totalIds: 1000, version: CHECKPOINT_VERSION, completedBatches: 1 }, 2500), true);
});

test('getStartIndex skips completed batches and clamps to totalIds', () => {
    assert.strictEqual(getStartIndex(null, 1500, BATCH_SIZE), 0);
    assert.strictEqual(getStartIndex({ completedBatches: 0 }, 1500, BATCH_SIZE), 0);
    assert.strictEqual(getStartIndex({ completedBatches: 2 }, 1500, BATCH_SIZE), 1000);
    // Clamp: mas batches completados que batches disponibles
    assert.strictEqual(getStartIndex({ completedBatches: 10 }, 1500, BATCH_SIZE), 1500);
});

test('buildResumePlan resumes from the first unprocessed batch (checkpoint restart)', () => {
    const plan = buildResumePlan({ completedBatches: 2 }, 1500, BATCH_SIZE);
    assert.strictEqual(plan.startIndex, 1000);
    assert.strictEqual(plan.completedBatches, 2);
    assert.strictEqual(plan.resumed, true);

    const fresh = buildResumePlan(null, 1500, BATCH_SIZE);
    assert.strictEqual(fresh.startIndex, 0);
    assert.strictEqual(fresh.resumed, false);
});

test('checkpointPath resolves relative names against CWD', () => {
    assert.ok(checkpointPath(DEFAULT_CHECKPOINT_FILE).startsWith('/'));
    assert.ok(path.isAbsolute(checkpointPath(DEFAULT_CHECKPOINT_FILE)));
});
