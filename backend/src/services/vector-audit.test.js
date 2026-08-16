import { test } from 'node:test';
import assert from 'node:assert';
import {
    resolveAuthoritativeRecord,
    detectVectorConflict,
    buildQuarantineMetadata,
    isQuarantined,
    normalizeClassIds,
} from './vector-audit.js';

// ── resolveAuthoritativeRecord ────────────────────────────────────────────────

test('resolveAuthoritativeRecord derives subjectId from partitionKey (ground truth)', () => {
    const record = resolveAuthoritativeRecord({ subjectId: 'vector-wrong' }, {
        partitionKey: 'arq-software-2026',
        rowKey: 'mat-1',
        classIds: ['class-01'],
    });
    assert.strictEqual(record.subjectId, 'arq-software-2026');
    assert.deepStrictEqual(record.classIds, ['class-01']);
});

test('resolveAuthoritativeRecord falls back to materialState.subjectId', () => {
    const record = resolveAuthoritativeRecord({}, { subjectId: 's-other', classIds: ['c1'] });
    assert.strictEqual(record.subjectId, 's-other');
});

test('resolveAuthoritativeRecord returns null subjectId when material row lacks partitionKey and subjectId', () => {
    const record = resolveAuthoritativeRecord({}, { rowKey: 'mat-1', classIds: ['c1'] });
    assert.strictEqual(record.subjectId, null);
    assert.deepStrictEqual(record.classIds, ['c1']);
});

test('resolveAuthoritativeRecord returns null record for missing materialState', () => {
    const record = resolveAuthoritativeRecord({ subjectId: 's1' }, null);
    assert.strictEqual(record.subjectId, null);
    assert.deepStrictEqual(record.classIds, []);
});

test('resolveAuthoritativeRecord comma-splits a non-array JSON string classIds (Loopback 2)', () => {
    const record = resolveAuthoritativeRecord({}, {
        partitionKey: 's1',
        classIds: '"class-01"',
    });
    assert.deepStrictEqual(record.classIds, ['class-01']);
});

test('resolveAuthoritativeRecord comma-splits a plain string classIds', () => {
    const record = resolveAuthoritativeRecord({}, {
        partitionKey: 's1',
        classIds: 'class-01, class-02',
    });
    assert.deepStrictEqual(record.classIds, ['class-01', 'class-02']);
});

test('normalizeClassIds handles arrays, JSON arrays, and strings', () => {
    assert.deepStrictEqual(normalizeClassIds(['a', 'b']), ['a', 'b']);
    assert.deepStrictEqual(normalizeClassIds('["a","b"]'), ['a', 'b']);
    assert.deepStrictEqual(normalizeClassIds('a,b'), ['a', 'b']);
    assert.deepStrictEqual(normalizeClassIds(undefined), []);
    assert.deepStrictEqual(normalizeClassIds(null), []);
    assert.deepStrictEqual(normalizeClassIds(''), []);
});

// ── detectVectorConflict ──────────────────────────────────────────────────────

test('detectVectorConflict no conflict when vector matches authoritative record', () => {
    const result = detectVectorConflict(
        { subjectId: 's1', classIds: ['c1', 'c2'] },
        { partitionKey: 's1', classIds: ['c1', 'c2'] },
    );
    assert.strictEqual(result.conflict, false);
    assert.deepStrictEqual(result.reasons, []);
    assert.strictEqual(result.expectedSubjectId, 's1');
    assert.deepStrictEqual(result.expectedClassIds, ['c1', 'c2']);
});

test('detectVectorConflict flags subjectId-mismatch', () => {
    const result = detectVectorConflict(
        { subjectId: 's-wrong', classIds: ['c1'] },
        { partitionKey: 's1', classIds: ['c1'] },
    );
    assert.strictEqual(result.conflict, true);
    assert.ok(result.reasons.includes('subjectId-mismatch'));
    assert.strictEqual(result.expectedSubjectId, 's1');
});

test('detectVectorConflict flags classId-mismatch when ANY classId is not authoritative', () => {
    const result = detectVectorConflict(
        { subjectId: 's1', classIds: ['c1', 'class-99'] },
        { partitionKey: 's1', classIds: ['c1'] },
    );
    assert.strictEqual(result.conflict, true);
    assert.ok(result.reasons.includes('classId-mismatch'));
    assert.deepStrictEqual(result.expectedClassIds, ['c1']);
});

test('detectVectorConflict flags both subjectId and classId mismatch (dual)', () => {
    const result = detectVectorConflict(
        { subjectId: 's-wrong', classIds: ['c1', 'x99'] },
        { partitionKey: 's1', classIds: ['c1', 'c2'] },
    );
    assert.strictEqual(result.conflict, true);
    assert.ok(result.reasons.includes('subjectId-mismatch'));
    assert.ok(result.reasons.includes('classId-mismatch'));
});

test('detectVectorConflict uses classId singular fallback', () => {
    const result = detectVectorConflict(
        { subjectId: 's1', classId: 'x99' },
        { partitionKey: 's1', classIds: ['c1'] },
    );
    assert.strictEqual(result.conflict, true);
    assert.ok(result.reasons.includes('classId-mismatch'));
});

test('detectVectorConflict flags no-authoritative-material for missing record', () => {
    const result = detectVectorConflict({ subjectId: 's1', classIds: ['c1'] }, null);
    assert.strictEqual(result.conflict, true);
    assert.deepStrictEqual(result.reasons, ['no-authoritative-material']);
    assert.strictEqual(result.expectedSubjectId, null);
    assert.deepStrictEqual(result.expectedClassIds, []);
});

test('detectVectorConflict flags metadata-incomplete when vector has NO subjectId/classIds (Loopback 5)', () => {
    const result = detectVectorConflict(
        { chunkIndex: 0 },
        { partitionKey: 's1', classIds: ['c1'] },
    );
    assert.strictEqual(result.conflict, true);
    assert.ok(result.reasons.includes('metadata-incomplete'));
});

test('detectVectorConflict flags metadata-incomplete when vector has subjectId but NO classIds while authoritative HAS classIds (pass-6)', () => {
    const result = detectVectorConflict(
        { subjectId: 's1', chunkIndex: 0 },
        { partitionKey: 's1', classIds: ['c1'] },
    );
    assert.strictEqual(result.conflict, true);
    assert.ok(result.reasons.includes('metadata-incomplete'), 'vector pierde el scope por clase');
});

test('detectVectorConflict flags metadata-incomplete (not subjectId-mismatch) when material row is unresolvable', () => {
    const result = detectVectorConflict(
        { subjectId: 's1', classIds: ['c1'] },
        { rowKey: 'mat-1', classIds: ['c1'] }, // sin partitionKey ni subjectId
    );
    assert.strictEqual(result.conflict, true);
    assert.deepStrictEqual(result.reasons, ['metadata-incomplete']);
    assert.strictEqual(result.expectedSubjectId, null);
});

test('detectVectorConflict handles null/absent vector metadata without throwing', () => {
    assert.strictEqual(detectVectorConflict(null, { partitionKey: 's1', classIds: ['c1'] }).conflict, true);
    assert.strictEqual(detectVectorConflict({}, { partitionKey: 's1', classIds: ['c1'] }).conflict, true);
    assert.strictEqual(detectVectorConflict(undefined, undefined).conflict, true);
});

// ── buildQuarantineMetadata ───────────────────────────────────────────────────

test('buildQuarantineMetadata produces the full quarantine flag shape', () => {
    const meta = { subjectId: 's-wrong', classIds: ['x99'], materialId: 'mat-1', chunkIndex: 2 };
    const result = buildQuarantineMetadata(meta, {
        reasons: ['subjectId-mismatch', 'classId-mismatch'],
        expectedSubjectId: 's1',
        expectedClassIds: ['c1'],
    });

    assert.strictEqual(result.quarantined, true);
    assert.strictEqual(result.quarantineReason, 'subjectId-mismatch,classId-mismatch');
    assert.ok(result.quarantinedAt);
    assert.strictEqual(result.conflictSubjectId, 's-wrong');
    assert.strictEqual(result.conflictClassId, 'x99');
    assert.strictEqual(result.expectedSubjectId, 's1');
    assert.deepStrictEqual(result.expectedClassIds, ['c1']);
    // Preserva los campos originales
    assert.strictEqual(result.materialId, 'mat-1');
    assert.strictEqual(result.chunkIndex, 2);
});

test('buildQuarantineMetadata for unresolvable vectors never uses the vector own subjectId', () => {
    const meta = { subjectId: 's-wrong', materialId: 'mat-1' };
    const result = buildQuarantineMetadata(meta, {
        reasons: ['no-authoritative-material'],
        expectedSubjectId: null,
        expectedClassIds: [],
    });
    assert.strictEqual(result.expectedSubjectId, null);
    assert.deepStrictEqual(result.expectedClassIds, []);
    assert.strictEqual(result.conflictSubjectId, 's-wrong'); // el viejo valor queda como conflicto observado
});

test('buildQuarantineMetadata defaults when conflictResult is empty', () => {
    const result = buildQuarantineMetadata({ subjectId: 's1', classId: 'c1' }, {});
    assert.strictEqual(result.quarantined, true);
    assert.strictEqual(result.quarantineReason, 'quarantined');
    assert.strictEqual(result.expectedSubjectId, null);
    assert.deepStrictEqual(result.expectedClassIds, []);
});

// ── isQuarantined ─────────────────────────────────────────────────────────────

test('isQuarantined strict boolean true', () => {
    assert.strictEqual(isQuarantined({ quarantined: true }), true);
    assert.strictEqual(isQuarantined({ quarantined: false }), false);
});

test('isQuarantined numeric and numeric-string forms', () => {
    assert.strictEqual(isQuarantined({ quarantined: 1 }), true);
    assert.strictEqual(isQuarantined({ quarantined: 0 }), false);
    assert.strictEqual(isQuarantined({ quarantined: '1' }), true);
});

test('isQuarantined lenient string forms (trim + lowercase consistent)', () => {
    assert.strictEqual(isQuarantined({ quarantined: 'true' }), true);
    assert.strictEqual(isQuarantined({ quarantined: ' TRUE ' }), true);
    assert.strictEqual(isQuarantined({ quarantined: 'yes' }), true);
    assert.strictEqual(isQuarantined({ quarantined: ' YES ' }), true);
    assert.strictEqual(isQuarantined({ quarantined: 'on' }), true);
    assert.strictEqual(isQuarantined({ quarantined: ' ON ' }), true);
    assert.strictEqual(isQuarantined({ quarantined: ' 1 ' }), true);
    assert.strictEqual(isQuarantined({ quarantined: 'no' }), false);
    assert.strictEqual(isQuarantined({ quarantined: 'off' }), false);
    assert.strictEqual(isQuarantined({ quarantined: '0' }), false);
});

test('isQuarantined guards null/absent metadata', () => {
    assert.strictEqual(isQuarantined(null), false);
    assert.strictEqual(isQuarantined({}), false);
    assert.strictEqual(isQuarantined(undefined), false);
    assert.strictEqual(isQuarantined('nope'), false);
});
