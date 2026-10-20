import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    SIN_TEMA,
    ORIGENES,
    buildTemario,
    classifyByTopic,
    originsOfLog,
    significantTokens,
    normalizeText,
    tokensMatch,
} from './topic-classifier.js';

// Temario tal como lo declara la unidad `arq-software-2026` (classes[].topics).
const CLASSES = [
    { id: 'class-01', topics: ['Definición de arquitectura', 'Patrones arquitectónicos', 'Atributos de calidad'] },
    { id: 'class-02', topics: ['Arquitectura en capas', 'Cliente-Servidor', 'Microservicios', 'Event-Driven'] },
    { id: 'class-03', topics: ['Puertos y adaptadores', 'Domain-Driven Design', 'Bounded Contexts', 'Aggregates'] },
    { id: 'class-04', topics: ['SAGA pattern', 'CQRS', 'Event Sourcing', 'Consistencia eventual'] },
];

test('el temario sale de classes[].topics y de-duplica el mismo tema declarado en dos encuentros', () => {
    const temario = buildTemario([
        { id: 'class-01', topics: ['Atributos de calidad', 'Definición de arquitectura'] },
        { id: 'class-02', topics: ['atributos de calidad', 'Arquitectura en capas'] },
        { id: 'class-03', topics: [] },
        { id: 'class-04' },
    ]);

    assert.deepStrictEqual(temario.map((t) => t.tema), ['Atributos de calidad', 'Definición de arquitectura', 'Arquitectura en capas']);
    const compartido = temario.find((t) => t.tema === 'Atributos de calidad');
    assert.deepStrictEqual(compartido.declaredIn, ['class-01', 'class-02'], 'el tema compartido conserva los encuentros que lo declaran');
});

test('normalización y poda de plural no rompen la pregunta en tokens sueltos', () => {
    assert.strictEqual(normalizeText('¿Qué es la ARQUITECTURA Hexagonal?'), 'que es la arquitectura hexagonal');
    assert.deepStrictEqual(significantTokens('que responsabilidades tiene la capa de aplicacion'), ['responsabilidad', 'capa', 'aplicacion']);
    assert.ok(tokensMatch('capa', 'capas'));
    assert.ok(!tokensMatch('arquitectura', 'arquitectonico'), 'sin sinónimos: la derivación no se adivina');
    assert.ok(!tokensMatch('event', 'eventual'));
});

test('las tres variantes de la misma consulta caen en el mismo tema declarado (UJ-42)', () => {
    const temario = buildTemario(CLASSES);
    const variantes = [
        'que responsabilidades tiene la capa de aplicacion en una arquitectura por capas?',
        'QAW-UJ38: que responsabilidades tiene la capa de aplicacion en una arquitectura por capas?',
        'QAW-20261016 UJ27 alu004 P1: segun el material, que responsabilidades tiene la capa de aplicacion en una arquitectura por capas?',
        '¿Qué roles cumple la capa de aplicación en un diseño por capas?',
    ];

    for (const variante of variantes) {
        const tema = classifyByTopic(variante, temario);
        assert.ok(tema, `la variante debe caer en un tema: ${variante}`);
        assert.strictEqual(tema.tema, 'Arquitectura en capas', `variante mal clasificada: ${variante}`);
    }
});

test('una pregunta que no cae en ningún tema declarado devuelve null (grupo «sin tema»)', () => {
    const temario = buildTemario(CLASSES);
    for (const pregunta of [
        '¿Qué es el acoplamiento entre módulos?',
        'Describí los principios SOLID con un ejemplo aplicado.',
        '¿Qué es la arquitectura hexagonal?',
        'QAW-RV2CUJ28: ¿qué dice el material sobre el protocolo ARCH-QA-77 de descomposicion de monolitos?',
    ]) {
        assert.strictEqual(classifyByTopic(pregunta, temario), null, `no debe inventar tema para: ${pregunta}`);
    }
    assert.strictEqual(SIN_TEMA, 'sin-tema');
});

test('los temas declarados se reconocen por su vocabulario y por su sigla', () => {
    const temario = buildTemario(CLASSES);
    assert.strictEqual(classifyByTopic('¿En que unidad se ven los atributos de calidad?', temario)?.tema, 'Atributos de calidad');
    assert.strictEqual(classifyByTopic('¿Qué son los puertos y adaptadores?', temario)?.tema, 'Puertos y adaptadores');
    assert.strictEqual(classifyByTopic('¿Qué es DDD?', temario)?.tema, 'Domain-Driven Design');
    assert.strictEqual(classifyByTopic('¿De qué trata SAGA y CQRS?', temario)?.tema, 'CQRS');
    assert.strictEqual(classifyByTopic('¿Qué son los microservicios?', temario)?.tema, 'Microservicios');
});

test('el origen se declara sólo con evidencia en la interacción', () => {
    assert.deepStrictEqual(originsOfLog({ sources: [] }), [ORIGENES.SIN_MATERIAL]);
    assert.deepStrictEqual(originsOfLog({ sources: [{ id: 'm1' }] }), [], 'con material no declara «sin material»');
    assert.deepStrictEqual(originsOfLog({}), [], 'sin el campo sources no se afirma nada');
    assert.deepStrictEqual(originsOfLog({ feedback: 'negative' }), [ORIGENES.VALORACION_BAJA]);
    assert.deepStrictEqual(originsOfLog({ feedback: 'positive' }), []);
    assert.deepStrictEqual(originsOfLog({ reportedIssue: { reportedAt: '2026-10-16' } }), [ORIGENES.REPORTE_ABIERTO]);
    assert.deepStrictEqual(
        originsOfLog({ id: 'msg-1' }, { pendingMessageIds: new Set(['msg-1']) }),
        [ORIGENES.REPORTE_ABIERTO],
        'una corrección pendiente sobre el mensaje también es un reporte abierto',
    );
    assert.deepStrictEqual(
        originsOfLog({ sources: [], feedback: 'negative' }),
        [ORIGENES.SIN_MATERIAL, ORIGENES.VALORACION_BAJA],
        'una consulta puede tener más de un origen',
    );
});
