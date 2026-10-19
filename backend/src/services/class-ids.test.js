import { test } from 'node:test';
import assert from 'node:assert';

import { normalizeClassIds } from './class-ids.js';

// #578: el pipeline guardaba `classIds` anidados como texto porque un campo
// multipart enviado como arreglo JSON (`["class-01"]`) se separaba por comas y
// quedaba como un único string con corchetes. Cualquier comparación contra una
// clase real fallaba después.

test('normalizeClassIds deja plano un arreglo de ids', () => {
    assert.deepStrictEqual(normalizeClassIds(['class-01', 'class-02']), ['class-01', 'class-02']);
});

test('normalizeClassIds aplana un id que quedó envuelto en texto JSON (#578)', () => {
    assert.deepStrictEqual(normalizeClassIds(['["class-01"]']), ['class-01']);
});

test('normalizeClassIds aplana anidamiento repetido', () => {
    assert.deepStrictEqual(normalizeClassIds(['"[\\"class-01\\"]"']), ['class-01']);
    assert.deepStrictEqual(normalizeClassIds('["[\\"class-01\\"]"]'), ['class-01']);
    assert.deepStrictEqual(normalizeClassIds([['class-01'], ['class-02']]), ['class-01', 'class-02']);
});

test('normalizeClassIds acepta strings JSON, listas por comas y valores sueltos', () => {
    assert.deepStrictEqual(normalizeClassIds('["class-01","class-02"]'), ['class-01', 'class-02']);
    assert.deepStrictEqual(normalizeClassIds('class-01, class-02'), ['class-01', 'class-02']);
    assert.deepStrictEqual(normalizeClassIds('class-01'), ['class-01']);
    assert.deepStrictEqual(normalizeClassIds(' "class-01" '), ['class-01']);
});

test('normalizeClassIds combina arreglo con valores anidados y preserva el orden', () => {
    assert.deepStrictEqual(
        normalizeClassIds(['class-02', ['["class-01"]', 'class-03']]),
        ['class-02', 'class-01', 'class-03']
    );
});

test('normalizeClassIds deduplica sin reordenar', () => {
    assert.deepStrictEqual(normalizeClassIds(['class-02', '["class-01"]', 'class-02']), ['class-02', 'class-01']);
});

test('normalizeClassIds descarta vacíos, nulos y valores no-id', () => {
    assert.deepStrictEqual(normalizeClassIds(undefined), []);
    assert.deepStrictEqual(normalizeClassIds(null), []);
    assert.deepStrictEqual(normalizeClassIds(''), []);
    assert.deepStrictEqual(normalizeClassIds('   '), []);
    assert.deepStrictEqual(normalizeClassIds([null, '', '  ', 'class-01']), ['class-01']);
    assert.deepStrictEqual(normalizeClassIds([{ id: 'class-01' }]), []);
    assert.deepStrictEqual(normalizeClassIds('{"a":1}'), []);
});
