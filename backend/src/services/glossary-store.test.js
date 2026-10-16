import { test, mock } from 'node:test';
import assert from 'node:assert';

const storageMocks = {
    saveJson: mock.fn(async () => true),
    loadJson: mock.fn(async () => null),
};

mock.module('../services/storage.js', { namedExports: storageMocks });

const { getGlossary, updateGlossary, findGlossaryTerm, invalidateGlossaryCache, findGlossaryConflicts, GlossaryValidationError } = await import('./glossary-store.js');

const sampleGlossary = {
    subjectId: 'arq-software-2026',
    terms: [
        { term: 'DDD', aliases: ['domain-driven design', 'ddd'], definition: 'Diseño dirigido por el dominio.' },
        { term: 'Hexagonal', aliases: ['puertos y adaptadores'], definition: 'Arquitectura por puertos y adaptadores.' },
        { term: 'CQRS', aliases: [], definition: 'Separación de comandos y consultas.' },
    ],
};

function setupGlossary(data) {
    storageMocks.loadJson.mock.mockImplementation(async () => data);
    invalidateGlossaryCache('arq-software-2026');
}

test('updateGlossary persists the definition field alongside term and aliases', async () => {
    storageMocks.saveJson.mock.resetCalls();
    const data = await updateGlossary('sub-1', [
        { term: 'DDD', aliases: ['domain'], definition: 'Definición DDD' },
        { term: 'ERP', aliases: [], definition: '  ' },
    ]);
    const saved = storageMocks.saveJson.mock.calls.at(-1).arguments[2];
    assert.strictEqual(saved.terms[0].definition, 'Definición DDD');
    assert.strictEqual(saved.terms[1].definition, '', 'empty definition is trimmed to empty string');
});

test('findGlossaryTerm matches exact term case-insensitively', async () => {
    setupGlossary(sampleGlossary);
    const found = await findGlossaryTerm('arq-software-2026', 'DDD');
    assert.ok(found);
    assert.strictEqual(found.term, 'DDD');
    assert.strictEqual(found.definition, 'Diseño dirigido por el dominio.');
});

test('findGlossaryTerm matches by alias', async () => {
    setupGlossary(sampleGlossary);
    const found = await findGlossaryTerm('arq-software-2026', 'puertos y adaptadores');
    assert.ok(found);
    assert.strictEqual(found.term, 'Hexagonal');
});

test('findGlossaryTerm is case and accent insensitive', async () => {
    setupGlossary(sampleGlossary);
    const found = await findGlossaryTerm('arq-software-2026', 'hexagonal');
    assert.ok(found);
    assert.strictEqual(found.term, 'Hexagonal');
});

test('findGlossaryTerm returns null for unknown term', async () => {
    setupGlossary(sampleGlossary);
    const found = await findGlossaryTerm('arq-software-2026', 'ERP');
    assert.strictEqual(found, null);
});

test('findGlossaryTerm returns null when glossary has no terms or does not exist', async () => {
    setupGlossary({ subjectId: 'sub-x', terms: [] });
    const empty = await findGlossaryTerm('sub-x', 'DDD');
    assert.strictEqual(empty, null);

    storageMocks.loadJson.mock.mockImplementation(async () => null);
    invalidateGlossaryCache('sub-missing');
    const missing = await findGlossaryTerm('sub-missing', 'DDD');
    assert.strictEqual(missing, null);
});

// ── UJ-16 pasos 4 y 8 (issue #373) ───────────────────────────────────────────

test('findGlossaryConflicts detecta la forma preferida duplicada y el alias que ya es forma preferida', () => {
    const conflicts = findGlossaryConflicts([
        { term: 'probando', aliases: ['asd', 'ad'], definition: '' },
        { term: 'asd', aliases: ['asd'], definition: 'Definición 2' },
    ]);
    const types = conflicts.map((c) => c.type).sort();
    assert.deepStrictEqual(types, ['alias_is_preferred_form', 'shared_alias']);
});

test('findGlossaryConflicts no marca un vocabulario sin choques', () => {
    const conflicts = findGlossaryConflicts([
        { term: 'DDD', aliases: ['domain-driven design', 'ddd'], definition: 'x' },
        { term: 'CQRS', aliases: [], definition: 'y' },
    ]);
    assert.deepStrictEqual(conflicts, []);
});

test('updateGlossary rechaza el vocabulario con choques antes de ponerlo en vigencia', async () => {
    storageMocks.saveJson.mock.resetCalls();
    await assert.rejects(
        () => updateGlossary('sub-1', [
            { term: 'probando', aliases: ['asd'], definition: '' },
            { term: 'asd', aliases: [], definition: '' },
        ], 'prof-002'),
        (err) => {
            assert.ok(err instanceof GlossaryValidationError);
            assert.strictEqual(err.status, 400);
            assert.ok(err.conflicts.length > 0);
            return true;
        },
    );
    assert.strictEqual(storageMocks.saveJson.mock.callCount(), 0, 'no se escribe nada con choques');
});

test('updateGlossary rechaza una fila con contenido pero sin forma preferida en vez de descartarla', async () => {
    storageMocks.saveJson.mock.resetCalls();
    await assert.rejects(
        () => updateGlossary('sub-1', [
            { term: 'DDD', aliases: [], definition: 'ok' },
            { term: '', aliases: [], definition: 'definición huérfana' },
        ], 'prof-002'),
        (err) => {
            assert.ok(err instanceof GlossaryValidationError);
            assert.match(err.message, /sin forma preferida/);
            return true;
        },
    );
    assert.strictEqual(storageMocks.saveJson.mock.callCount(), 0);
});

test('updateGlossary guarda quién fijó el vocabulario y devuelve la versión vigente', async () => {
    storageMocks.saveJson.mock.resetCalls();
    const data = await updateGlossary('sub-1', [
        { term: 'DDD', aliases: ['domain'], definition: 'Definición DDD' },
    ], 'prof-002');
    assert.strictEqual(data.updatedBy, 'prof-002');
    assert.ok(data.updatedAt);
    const saved = storageMocks.saveJson.mock.calls.at(-1).arguments[2];
    assert.strictEqual(saved.updatedBy, 'prof-002');
});

