import { test } from 'node:test';
import assert from 'node:assert';
import {
    tokenize,
    filterMatchesByTranscriptFocus,
    getMaterialWeight,
    getPriorityWeight,
    resolveMaterialPriority,
    rankMatches,
    buildHybridContext,
    diversifyBySourceFile,
    resolveSourceMix,
    resolveSelectedClassCount,
    resolveFilterType,
    MAX_RAG_CHUNKS,
    MAX_CHUNKS_PER_SOURCE,
} from './rag-ranking.js';

test('tokenize', async (t) => {
    await t.test('returns empty array for empty input', () => {
        assert.deepStrictEqual(tokenize(), []);
        assert.deepStrictEqual(tokenize(''), []);
    });

    await t.test('filters short tokens (< 4 chars)', () => {
        const result = tokenize('a an the for foo bar test');
        assert.deepStrictEqual(result, ['test']);
    });

    await t.test('strips non-alphanumeric characters', () => {
        const result = tokenize('arquitectura-hexagonal! patrones...');
        assert.deepStrictEqual(result, ['arquitectura', 'hexagonal', 'patrones']);
    });

    await t.test('lowercases all tokens', () => {
        const result = tokenize('Arquitectura Hexagonal');
        assert.deepStrictEqual(result, ['arquitectura', 'hexagonal']);
    });
});

test('filterMatchesByTranscriptFocus', async (t) => {
    const matches = [
        { metadata: { text: 'arquitectura hexagonal' } },
        { metadata: { text: 'base de datos relacional' } },
        { metadata: { text: 'patrones de diseno hexagonal' } },
    ];

    await t.test('returns all matches when no transcriptFocus', () => {
        assert.strictEqual(filterMatchesByTranscriptFocus(matches, null), matches);
        assert.strictEqual(filterMatchesByTranscriptFocus(matches, {}), matches);
        assert.strictEqual(filterMatchesByTranscriptFocus(matches, { label: '' }), matches);
    });

    await t.test('narrows results matching keywords', () => {
        const result = filterMatchesByTranscriptFocus(matches, { label: 'Arquitectura Hexagonal' });
        assert.strictEqual(result.length, 2);
        assert.ok(result[0].metadata.text.includes('hexagonal'));
        assert.ok(result[1].metadata.text.includes('hexagonal'));
    });

    await t.test('returns all when no match found (fallback)', () => {
        const result = filterMatchesByTranscriptFocus(matches, { label: 'machine learning' });
        assert.strictEqual(result, matches);
    });

    await t.test('returns null/undefined matches as-is (null guard)', () => {
        assert.strictEqual(filterMatchesByTranscriptFocus(null, { label: 'test' }), null);
        assert.strictEqual(filterMatchesByTranscriptFocus(undefined, { label: 'test' }), undefined);
    });

    await t.test('handles empty matches array', () => {
        assert.deepStrictEqual(filterMatchesByTranscriptFocus([], { label: 'test' }), []);
    });

    await t.test('handles matches with no text metadata', () => {
        const noTextMatches = [{ metadata: {} }];
        const result = filterMatchesByTranscriptFocus(noTextMatches, { label: 'test' });
        assert.strictEqual(result, noTextMatches);
    });
});

test('getMaterialWeight', async (t) => {
    await t.test('returns default weight for known types', () => {
        assert.strictEqual(getMaterialWeight('notes', null), 1.35);
        assert.strictEqual(getMaterialWeight('bibliography', null), 1.1);
        assert.strictEqual(getMaterialWeight('transcript', null), 1.0);
        assert.strictEqual(getMaterialWeight('presentation', null), 0.95);
    });

    await t.test('returns 1 for unknown type', () => {
        assert.strictEqual(getMaterialWeight('unknown', null), 1);
    });

    await t.test('uses custom weights when provided', () => {
        const custom = { notes: 2.0, transcript: 0.5 };
        assert.strictEqual(getMaterialWeight('notes', custom), 2.0);
        assert.strictEqual(getMaterialWeight('transcript', custom), 0.5);
        assert.strictEqual(getMaterialWeight('bibliography', custom), 1);
    });

    await t.test('honors an explicit 0 weight (excluir) instead of falling back to 1', () => {
        assert.strictEqual(getMaterialWeight('transcript', { transcript: 0 }), 0);
        assert.strictEqual(getMaterialWeight('notes', { notes: 0, transcript: 2 }), 0);
        assert.strictEqual(getMaterialWeight('presentation', { presentation: 0 }), 0);
    });

    await t.test('keeps 1 when the type is absent, null or empty in the custom weights', () => {
        assert.strictEqual(getMaterialWeight('bibliography', { notes: 2, transcript: 0.5 }), 1);
        assert.strictEqual(getMaterialWeight('notes', { notes: null }), 1);
        assert.strictEqual(getMaterialWeight('notes', { notes: '' }), 1);
        assert.strictEqual(getMaterialWeight('notes', { notes: 'no-es-un-numero' }), 1);
    });
});

test('getPriorityWeight', async (t) => {
    await t.test('returns correct weights for known priorities', () => {
        assert.strictEqual(getPriorityWeight('primary'), 1);
        assert.strictEqual(getPriorityWeight('secondary'), 0.9);
    });

    await t.test('returns 1 for unknown priority', () => {
        assert.strictEqual(getPriorityWeight('unknown'), 1);
        assert.strictEqual(getPriorityWeight(undefined), 1);
        assert.strictEqual(getPriorityWeight(null), 1);
    });
});

test('resolveMaterialPriority', async (t) => {
    await t.test('returns primary for notes type', () => {
        const result = resolveMaterialPriority({ materialType: 'notes' });
        assert.strictEqual(result, 'primary');
    });

    await t.test('returns secondary for bibliography type', () => {
        const result = resolveMaterialPriority({ materialType: 'bibliography' });
        assert.strictEqual(result, 'secondary');
    });

    await t.test('uses override from priorityMap by materialId', () => {
        const result = resolveMaterialPriority(
            { materialType: 'notes', materialId: 'mat-1' },
            { 'mat-1': 'secondary' }
        );
        assert.strictEqual(result, 'secondary');
    });

    await t.test('uses override from metadata.materialPriority', () => {
        const result = resolveMaterialPriority(
            { materialType: 'bibliography', materialPriority: 'primary' }
        );
        assert.strictEqual(result, 'primary');
    });

    await t.test('handles null metadata gracefully', () => {
        const result = resolveMaterialPriority(null);
        assert.strictEqual(result, 'primary');
    });

    await t.test('handles undefined metadata', () => {
        const result = resolveMaterialPriority();
        assert.strictEqual(result, 'primary');
    });
});

test('rankMatches', async (t) => {
    const baseMatches = [
        { score: 0.9, metadata: { materialType: 'notes', sourceFilename: 'a.pdf' } },
        { score: 0.8, metadata: { materialType: 'transcript', sourceFilename: 'b.pdf' } },
        { score: 0.7, metadata: { materialType: 'bibliography', sourceFilename: 'c.pdf' } },
    ];

    await t.test('sorts by weighted score descending', () => {
        const result = rankMatches(baseMatches);
        assert.ok(result[0].weightedScore >= result[1].weightedScore);
        assert.ok(result[1].weightedScore >= result[2].weightedScore);
    });

    await t.test('notes rank higher than transcript at same base score', () => {
        const sameScore = [
            { score: 0.8, metadata: { materialType: 'transcript', sourceFilename: 'a.pdf' } },
            { score: 0.8, metadata: { materialType: 'notes', sourceFilename: 'b.pdf' } },
        ];
        const result = rankMatches(sameScore);
        assert.strictEqual(result[0].metadata.materialType, 'notes');
    });

    await t.test('handles empty matches', () => {
        assert.deepStrictEqual(rankMatches([]), []);
    });

    await t.test('handles matches with no score', () => {
        const noScore = [{ metadata: { materialType: 'notes', sourceFilename: 'a.pdf' } }];
        const result = rankMatches(noScore);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].weightedScore, 0);
    });

    await t.test('uses priorityMap to adjust ranking', () => {
        const matches = [
            { score: 0.9, metadata: { materialType: 'notes', sourceFilename: 'a.pdf', materialId: 'mat-1' } },
            { score: 0.85, metadata: { materialType: 'notes', sourceFilename: 'b.pdf', materialId: 'mat-2' } },
        ];
        const priorityMap = { 'mat-1': 'secondary' };
        const result = rankMatches(matches, priorityMap);
        assert.strictEqual(result[0].metadata.materialId, 'mat-2', 'default-priority notes (1.0) outranks demoted notes (0.9)');
    });
});

test('buildHybridContext', async (t) => {
    const makeMatch = (type, file, idx) => ({
        id: `${file}-${idx}`,
        score: 0.8,
        metadata: { materialType: type, sourceFilename: file, chunkIndex: idx },
    });

    await t.test('returns all when fewer matches than maxChunks', () => {
        const matches = [makeMatch('notes', 'a.pdf', 0)];
        const result = buildHybridContext(matches, 4);
        assert.strictEqual(result.length, 1);
    });

    await t.test('returns all when exactly maxChunks matches', () => {
        const matches = Array.from({ length: 4 }, (_, i) => makeMatch('transcript', `f${i}.pdf`, 0));
        const result = buildHybridContext(matches, 4);
        assert.strictEqual(result.length, 4);
    });

    await t.test('prioritizes notes type first', () => {
        const matches = [
            makeMatch('transcript', 'a.pdf', 0),
            makeMatch('notes', 'b.pdf', 0),
            makeMatch('transcript', 'c.pdf', 1),
            makeMatch('bibliography', 'd.pdf', 0),
            makeMatch('transcript', 'e.pdf', 2),
        ];
        const result = buildHybridContext(matches, 4);
        assert.strictEqual(result.length, 4);
        assert.strictEqual(result[0].metadata.materialType, 'notes');
        assert.strictEqual(result[1].metadata.materialType, 'bibliography');
    });

    await t.test('includes bibliography after notes', () => {
        const matches = [
            makeMatch('transcript', 'a.pdf', 0),
            makeMatch('notes', 'b.pdf', 0),
            makeMatch('bibliography', 'c.pdf', 0),
            makeMatch('transcript', 'd.pdf', 1),
        ];
        const result = buildHybridContext(matches, 3);
        assert.strictEqual(result.length, 3);
        assert.strictEqual(result[0].metadata.materialType, 'notes');
        assert.strictEqual(result[1].metadata.materialType, 'bibliography');
    });

    await t.test('uses priorityMap for weighting', () => {
        const matches = [
            { id: 'm1', score: 0.9, metadata: { materialType: 'notes', sourceFilename: 'a.pdf', materialId: 'mat-1' } },
            { id: 'm2', score: 0.85, metadata: { materialType: 'bibliography', sourceFilename: 'b.pdf', materialId: 'mat-2' } },
        ];
        const priorityMap = { 'mat-1': 'secondary' };
        const result = buildHybridContext(matches, 4, priorityMap);
        assert.strictEqual(result.length, 2);
    });

    await t.test('excludes matches whose material type has weight 0 (excluir)', () => {
        const matches = [
            makeMatch('notes', 'a.pdf', 0),
            makeMatch('transcript', 'b.pdf', 0),
            makeMatch('bibliography', 'c.pdf', 0),
        ];
        const weights = { notes: 1, transcript: 0, bibliography: 1, presentation: 1 };
        const result = buildHybridContext(matches, 4, {}, weights);
        assert.deepStrictEqual(result.map((m) => m.metadata.materialType), ['notes', 'bibliography']);
    });

    await t.test('drops a zero-weight notes even though notes is picked first by type', () => {
        const matches = [
            makeMatch('notes', 'a.pdf', 0),
            makeMatch('transcript', 'b.pdf', 0),
            makeMatch('transcript', 'c.pdf', 1),
            makeMatch('bibliography', 'd.pdf', 0),
            makeMatch('transcript', 'e.pdf', 2),
        ];
        const weights = { notes: 0, transcript: 1, bibliography: 1, presentation: 1 };
        const result = buildHybridContext(matches, 4, {}, weights);
        assert.strictEqual(result.length, 4);
        assert.ok(result.every((m) => m.metadata.materialType !== 'notes'));
    });

    await t.test('returns an empty context when every type is excluded', () => {
        const matches = [makeMatch('notes', 'a.pdf', 0), makeMatch('transcript', 'b.pdf', 0)];
        const weights = { notes: 0, transcript: 0, bibliography: 0, presentation: 0 };
        assert.deepStrictEqual(buildHybridContext(matches, 4, {}, weights), []);
    });
});

test('diversifyBySourceFile', async (t) => {
    const makeMatch = (file, idx) => ({
        id: `${file}-${idx}`,
        score: 0.8,
        metadata: { sourceFilename: file, chunkIndex: idx, materialType: 'transcript' },
    });

    await t.test('returns as-is capped at maxChunks for single source', () => {
        const matches = [
            makeMatch('a.pdf', 0),
            makeMatch('a.pdf', 1),
            makeMatch('a.pdf', 2),
        ];
        const result = diversifyBySourceFile(matches, 4, 4);
        assert.strictEqual(result.length, 3);
    });

    await t.test('returns empty array for empty input', () => {
        assert.deepStrictEqual(diversifyBySourceFile([]), []);
        assert.deepStrictEqual(diversifyBySourceFile(null), []);
        assert.deepStrictEqual(diversifyBySourceFile(undefined), []);
    });

    await t.test('limits per source file to maxPerFile when multiple files', () => {
        const matches = [
            ...Array.from({ length: 4 }, (_, i) => makeMatch('a.pdf', i)),
            ...Array.from({ length: 4 }, (_, i) => makeMatch('b.pdf', i)),
        ];
        const result = diversifyBySourceFile(matches, 2, 4);
        assert.strictEqual(result.length, 4);
        assert.strictEqual(result.filter(m => m.metadata.sourceFilename === 'a.pdf').length, 2);
        assert.strictEqual(result.filter(m => m.metadata.sourceFilename === 'b.pdf').length, 2);
    });

    await t.test('round-robins when multiple sources and room remains', () => {
        const matches = [
            ...Array.from({ length: 4 }, (_, i) => makeMatch('a.pdf', i)),
            ...Array.from({ length: 2 }, (_, i) => makeMatch('b.pdf', i)),
        ];
        const result = diversifyBySourceFile(matches, 2, 4);
        assert.strictEqual(result.length, 4);
    });

    await t.test('handles all-same-file scenario', () => {
        const matches = Array.from({ length: 10 }, (_, i) => makeMatch('single.pdf', i));
        const result = diversifyBySourceFile(matches, 3, 5);
        assert.strictEqual(result.length, Math.min(5, 3), 'maxPerFile cap applies even with single source');
        const ids = result.map(m => m.id);
        assert.strictEqual(new Set(ids).size, result.length, 'all chunks are distinct');
    });

    await t.test('respects maxChunks global limit', () => {
        const matches = [
            ...Array.from({ length: 3 }, (_, i) => makeMatch('a.pdf', i)),
            ...Array.from({ length: 3 }, (_, i) => makeMatch('b.pdf', i)),
            ...Array.from({ length: 3 }, (_, i) => makeMatch('c.pdf', i)),
        ];
        const result = diversifyBySourceFile(matches, 2, 3);
        assert.strictEqual(result.length, 3);
    });
});

test('resolveSourceMix', async (t) => {
    await t.test('returns none for empty sources', () => {
        assert.strictEqual(resolveSourceMix(), 'none');
        assert.strictEqual(resolveSourceMix([]), 'none');
    });

    await t.test('returns unknown when no materialType', () => {
        assert.strictEqual(resolveSourceMix([{}]), 'unknown');
    });

    await t.test('classifies single types', () => {
        assert.strictEqual(resolveSourceMix([{ materialType: 'notes' }]), 'notes-only');
        assert.strictEqual(resolveSourceMix([{ materialType: 'bibliography' }]), 'bibliography-only');
        assert.strictEqual(resolveSourceMix([{ materialType: 'transcript' }]), 'transcript-only');
        assert.strictEqual(resolveSourceMix([{ materialType: 'presentation' }]), 'presentation-only');
    });

    await t.test('classifies notes+bibliography mix', () => {
        const sources = [
            { materialType: 'notes' },
            { materialType: 'bibliography' },
        ];
        assert.strictEqual(resolveSourceMix(sources), 'notes+bibliography');
    });

    await t.test('classifies mixed-other for unknown types', () => {
        const sources = [
            { materialType: 'notes' },
            { materialType: 'other-type' },
        ];
        assert.strictEqual(resolveSourceMix(sources), 'mixed-other');
    });

    await t.test('filters out falsy materialTypes', () => {
        const sources = [
            { materialType: 'notes' },
            { materialType: null },
            { materialType: undefined },
        ];
        assert.strictEqual(resolveSourceMix(sources), 'notes-only');
    });
});

test('resolveSelectedClassCount', async (t) => {
    await t.test('returns 0 for no classIds', () => {
        assert.strictEqual(resolveSelectedClassCount(), 0);
        assert.strictEqual(resolveSelectedClassCount(null), 0);
        assert.strictEqual(resolveSelectedClassCount([]), 0);
    });

    await t.test('returns 0 when "all" is included', () => {
        assert.strictEqual(resolveSelectedClassCount(['all']), 0);
    });

    await t.test('counts unique classIds', () => {
        assert.strictEqual(resolveSelectedClassCount(['class-1']), 1);
        assert.strictEqual(resolveSelectedClassCount(['class-1', 'class-2']), 2);
    });

    await t.test('deduplicates classIds', () => {
        assert.strictEqual(resolveSelectedClassCount(['class-1', 'class-1']), 1);
    });
});

test('resolveFilterType', async (t) => {
    await t.test('returns subject-only for no classIds', () => {
        assert.strictEqual(resolveFilterType(), 'subject-only');
        assert.strictEqual(resolveFilterType(null), 'subject-only');
        assert.strictEqual(resolveFilterType([]), 'subject-only');
    });

    await t.test('returns subject-only when "all"', () => {
        assert.strictEqual(resolveFilterType(['all']), 'subject-only');
    });

    await t.test('returns exact-classId for single class', () => {
        assert.strictEqual(resolveFilterType(['class-1']), 'exact-classId');
    });

    await t.test('returns multi-classIds for multiple classes', () => {
        assert.strictEqual(resolveFilterType(['class-1', 'class-2']), 'multi-classIds');
    });

    await t.test('deduplicates classIds', () => {
        assert.strictEqual(resolveFilterType(['class-1', 'class-1']), 'exact-classId');
    });
});

test('module exports constants', async (t) => {
    await t.test('MAX_RAG_CHUNKS is 4', () => {
        assert.strictEqual(MAX_RAG_CHUNKS, 4);
    });

    await t.test('MAX_CHUNKS_PER_SOURCE is 2', () => {
        assert.strictEqual(MAX_CHUNKS_PER_SOURCE, 2);
    });
});
