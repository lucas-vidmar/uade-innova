import { test, mock } from 'node:test';
import assert from 'node:assert';

const storageMocks = {
    saveJson: mock.fn(async () => true),
    loadJson: mock.fn(async () => null),
};

mock.module('../services/storage.js', { namedExports: storageMocks });

const { getGlossary, updateGlossary, findGlossaryTerm, invalidateGlossaryCache } = await import('./glossary-store.js');

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
