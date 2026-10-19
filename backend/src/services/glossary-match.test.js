import { test } from 'node:test';
import assert from 'node:assert';

const { normalizeGlossaryKey, resolveGlossaryTerm } = await import('./glossary-match.js');

// Glosario con la forma que disparó #571: una entrada vieja que contiene el
// prefijo del término consultado y la entrada real, con guiones.
const glossaryTerms = [
    { term: 'probando', aliases: [], definition: 'Sin definición.' },
    { term: 'QAW-20261018090040', aliases: [], definition: 'Termino de prueba QA swarm viejo.' },
    { term: 'QAW-2610182111', aliases: ['qaw-ciclo-glosario'], definition: 'Termino de prueba QA swarm del ciclo.' },
    { term: 'Arquitectura Hexagonal', aliases: ['hexagonal', 'puertos y adaptadores'], definition: 'Puertos y adaptadores.' },
    { term: 'SAGA-CQRS', aliases: [], definition: 'Saga orquestada sobre CQRS.' },
    { term: 'v2.1', aliases: [], definition: 'Versión 2.1 del contrato.' },
];

test('#571: el término con guiones resuelve a su propia entrada, no a la que comparte el prefijo', () => {
    const found = resolveGlossaryTerm(glossaryTerms, 'QAW-2610182111');
    assert.ok(found);
    assert.strictEqual(found.term, 'QAW-2610182111');
    assert.strictEqual(found.definition, 'Termino de prueba QA swarm del ciclo.');
});

test('#571: el alias con guiones también resuelve a su término', () => {
    const found = resolveGlossaryTerm(glossaryTerms, 'qaw-ciclo-glosario');
    assert.ok(found);
    assert.strictEqual(found.term, 'QAW-2610182111');
});

test('#571: separadores distintos son términos distintos (v2.1 no colapsa en v2)', () => {
    assert.strictEqual(resolveGlossaryTerm([...glossaryTerms, { term: 'v2', aliases: [] }], 'v2.1').term, 'v2.1');
});

test('la forma más larga gana: la pregunta con artículo y cola resuelve al término compuesto', () => {
    const found = resolveGlossaryTerm(glossaryTerms, 'la arquitectura hexagonal en el TP');
    assert.ok(found);
    assert.strictEqual(found.term, 'Arquitectura Hexagonal');
});

test('el alias corto sigue resolviendo a su término cuando es exacto', () => {
    assert.strictEqual(resolveGlossaryTerm(glossaryTerms, 'hexagonal').term, 'Arquitectura Hexagonal');
    assert.strictEqual(resolveGlossaryTerm(glossaryTerms, 'puertos y adaptadores').term, 'Arquitectura Hexagonal');
});

test('normalización: mayúsculas y acentos no cambian el resultado', () => {
    const terms = [{ term: 'Diseño Dirigido por el Dominio', aliases: ['ddd'], definition: 'x' }];
    assert.strictEqual(resolveGlossaryTerm(terms, 'diseno dirigido por el dominio').term, 'Diseño Dirigido por el Dominio');
    assert.strictEqual(resolveGlossaryTerm(terms, 'DISEÑO DIRIGIDO POR EL DOMINIO').term, 'Diseño Dirigido por el Dominio');
});

test('lookup parcial del docente sigue funcionando por prefijo de palabra entera', () => {
    assert.strictEqual(resolveGlossaryTerm(glossaryTerms, 'arquitectura').term, 'Arquitectura Hexagonal');
    assert.strictEqual(resolveGlossaryTerm(glossaryTerms, 'puertos y').term, 'Arquitectura Hexagonal');
});

test('un fragmento a mitad de palabra no matchea (evita el comodín que devolvía otro término)', () => {
    assert.strictEqual(resolveGlossaryTerm(glossaryTerms, 'rquitectura hex'), null);
});

test('una consulta ambigua no adivina: dos términos que la contienen devuelven null', () => {
    const terms = [
        { term: 'QAW-20261018090040', aliases: [] },
        { term: 'QAW-2610182111', aliases: [] },
    ];
    assert.strictEqual(resolveGlossaryTerm(terms, 'QAW'), null);
});

test('sin coincidencia devuelve null (el fast-path cae al pipeline RAG)', () => {
    assert.strictEqual(resolveGlossaryTerm(glossaryTerms, 'ERP'), null);
    assert.strictEqual(resolveGlossaryTerm(glossaryTerms, ''), null);
    assert.strictEqual(resolveGlossaryTerm([], 'DDD'), null);
    assert.strictEqual(resolveGlossaryTerm(null, 'DDD'), null);
});

test('normalizeGlossaryKey conserva los separadores y colapsa espacios', () => {
    assert.strictEqual(normalizeGlossaryKey('  QAW-2610182111  '), 'qaw-2610182111');
    assert.strictEqual(normalizeGlossaryKey('Arquitectura   Hexagonal'), 'arquitectura hexagonal');
    assert.strictEqual(normalizeGlossaryKey('Diseño'), 'diseno');
});
