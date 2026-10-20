import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// #420 / UJ-42: la analítica docente tiene que agrupar por el TEMA que declara
// la unidad (`classes[].topics`), declarar el ORIGEN de cada pregunta
// (consulta sin material / valoración baja / reporte abierto) y no perder lo
// que no cae en ningún tema: eso va al grupo explícito «sin tema».

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    readDevIdentityHeader: mock.fn(() => null),
    parseClientPrincipal: mock.fn(() => ({ userId: 'prof-002', userRoles: ['authenticated', 'Docente'] })),
};

const CAPA = 'que responsabilidades tiene la capa de aplicacion en una arquitectura por capas?';

const LOGS = {
    'prof-002/arq-software-2026/a.json': {
        id: 'msg-a', question: '¿Qué es la arquitectura hexagonal?', classIds: ['class-03'], sources: [{ id: 'm1' }],
    },
    'prof-002/arq-software-2026/b.json': {
        id: 'msg-b', question: '¿Qué es la arquitectura hexagonal?', classIds: ['class-03'], sources: [],
    },
    'prof-002/arq-software-2026/c.json': {
        id: 'msg-c', question: CAPA, classIds: ['class-02'], sources: [], feedback: 'negative',
    },
    'prof-002/arq-software-2026/d.json': {
        id: 'msg-d', question: `QAW-UJ38: ${CAPA}`, classIds: ['class-02'], sources: [{ id: 'm2' }], feedback: 'negative',
    },
    'prof-002/arq-software-2026/e.json': {
        id: 'msg-e',
        question: `QAW-20261016 UJ27 alu004 P1: segun el material, ${CAPA}`,
        classIds: ['class-02', 'class-04'],
        sources: [{ id: 'm3' }],
        reportedIssue: { reportedAt: '2026-10-16T18:00:00.000Z' },
    },
    'prof-002/arq-software-2026/f.json': {
        id: 'msg-f', question: '¿En que unidad del programa se ven los atributos de calidad?', classIds: ['class-01'], sources: [{ id: 'm4' }],
    },
    'prof-002/arq-software-2026/g.json': {
        id: 'msg-g', question: '¿Qué es el acoplamiento entre módulos?', classIds: ['class-01'], sources: [],
    },
};

const CLASSES = [
    { id: 'class-01', title: 'Clase 1 — Introducción', topics: ['Definición de arquitectura', 'Atributos de calidad'] },
    { id: 'class-02', title: 'Clase 2 — Estilos', topics: ['Arquitectura en capas'] },
    { id: 'class-03', title: 'Clase 3 — Hexagonal y DDD', topics: ['Puertos y adaptadores'] },
    { id: 'class-04', title: 'Clase 4 — SAGA y CQRS', topics: ['Consistencia eventual', 'CQRS'] },
];

const storageMocks = {
    listBlobs: mock.fn(async () => Object.keys(LOGS)),
    loadJson: mock.fn(async (container, name) => LOGS[name] || null),
};

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'teacher' })),
    listClassesBySubject: mock.fn(async () => CLASSES),
    // Un reporte abierto del alumno sobre la respuesta de `msg-g`, que la
    // consulta del chat-log todavía no refleja.
    listPendingCorrections: mock.fn(async () => [
        { correctionId: 'c-1', messageId: 'msg-g', question: '¿Qué es el acoplamiento entre módulos?', status: 'pending' },
    ]),
};

const safetyRateMocks = {
    computeSafetyRate: mock.fn(async () => ({ safetyRatePercent: 100, totalRequests: 0, blockedBySafety: 0, errorCategorizedFailures: 0 })),
};

mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/safety-rate.js', { namedExports: safetyRateMocks });
mock.module('../middleware/with-auth.js', {
    namedExports: { withAuth: (handler) => async (request, context) => handler(request, context) },
});

const handlers = {};
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
            },
        },
    },
});

await import('./analytics.js');

const CONTEXT = { log: () => {}, error: () => {}, warn: () => {}, user: { id: 'prof-002', email: 'doc@uade.edu.ar', role: 'Docente' } };

async function callAnalytics(subjectId = 'arq-software-2026') {
    const response = await handlers['get-teacher-analytics'](
        { query: new URLSearchParams({ subjectId }) },
        CONTEXT,
    );
    assert.strictEqual(response.status, 200);
    return JSON.parse(response.body);
}

test('agrupa las variantes de la misma consulta en el tema declarado por la unidad (UJ-42)', async () => {
    const body = await callAnalytics();

    assert.ok(Array.isArray(body.topics), 'la respuesta expone topics (agrupación por tema)');
    const capas = body.topics.find((t) => t.tema === 'Arquitectura en capas');
    assert.ok(capas, 'el tema declarado existe como grupo propio');
    assert.strictEqual(capas.count, 3, 'las tres variantes del mismo tema son un solo grupo');
    assert.strictEqual(capas.questionVariants, 3, 'las tres variantes quedan listadas dentro del tema');
    assert.deepStrictEqual(capas.declaredIn, ['class-02'], 'el grupo dice qué encuentro declara el tema');

    // El texto literal ya no decide el agrupamiento: siguen siendo filas
    // distintas en `topQuestions`, pero apuntan al mismo tema.
    const filasCapa = body.topQuestions.filter((q) => q.tema === 'Arquitectura en capas');
    assert.ok(filasCapa.length >= 2, 'las variantes se reconocen como el mismo tema');
    assert.strictEqual(new Set(filasCapa.map((q) => q.temaKey)).size, 1);
});

test('declara el temario del que sale la agrupación (classes.topics)', async () => {
    const body = await callAnalytics();

    assert.strictEqual(body.temario.source, 'classes.topics');
    assert.strictEqual(body.temario.totalTemas, 6, 'los temas declarados por los 4 encuentros, sin duplicados');
    assert.strictEqual(body.temario.encuentros.length, 4);
    const clase2 = body.temario.encuentros.find((c) => c.classId === 'class-02');
    assert.deepStrictEqual(clase2.topics, ['Arquitectura en capas']);
});

test('declara el origen de cada pregunta: sin material, valoración baja y reporte abierto', async () => {
    const body = await callAnalytics();

    assert.deepStrictEqual(body.origenes.labels, {
        consultaSinMaterial: 'Consulta sin material',
        valoracionBaja: 'Valoración baja',
        reporteAbierto: 'Reporte abierto',
        sinSenal: 'Sin señal',
    });

    const capas = body.topics.find((t) => t.tema === 'Arquitectura en capas');
    assert.strictEqual(capas.origenes.consultaSinMaterial, 1, 'una de las variantes no tuvo material');
    assert.strictEqual(capas.origenes.valoracionBaja, 2, 'dos variantes tienen pulgar abajo');
    assert.strictEqual(capas.origenes.reporteAbierto, 1, 'una variante tiene reporte abierto en el log');

    const sinMaterial = capas.questions.find((q) => q.text === CAPA);
    assert.deepStrictEqual(sinMaterial.origenes, ['consultaSinMaterial', 'valoracionBaja'], 'cada pregunta declara su origen');

    // El reporte abierto también se lee de la bandeja: la corrección pendiente
    // sobre `msg-g` marca esa consulta aunque el log no lo traiga.
    const acoplamiento = body.sinTema.questions.find((q) => q.text === '¿Qué es el acoplamiento entre módulos?');
    assert.deepStrictEqual(acoplamiento.origenes, ['consultaSinMaterial', 'reporteAbierto']);

    assert.strictEqual(body.origenes.totales.consultaSinMaterial, 3);
    assert.strictEqual(body.origenes.totales.valoracionBaja, 2);
    assert.strictEqual(body.origenes.totales.reporteAbierto, 2);
    assert.strictEqual(body.origenes.totales.sinSenal, 2, 'las consultas sin señal también se cuentan, no se esconden');
});

test('lo que no cae en ningún tema va al grupo explícito «sin tema», no desaparece', async () => {
    const body = await callAnalytics();

    assert.ok(body.sinTema, 'existe el grupo explícito «sin tema»');
    assert.strictEqual(body.sinTema.key, 'sin-tema');
    assert.strictEqual(body.sinTema.count, 3, 'hexagonal ×2 + acoplamiento');
    const hexagonal = body.sinTema.questions.find((q) => q.text === '¿Qué es la arquitectura hexagonal?');
    assert.ok(hexagonal, 'la pregunta sin tema declarado queda listada');
    assert.strictEqual(hexagonal.count, 2);

    // Nada se pierde: temas + sin tema suman todas las consultas leídas.
    const totalTemas = body.topics.reduce((sum, t) => sum + t.count, 0);
    assert.strictEqual(totalTemas + body.sinTema.count, 7);
    assert.strictEqual(body.origenes.consultas, 7);
});

test('la lectura por encuentro trae temas y origen por encuentro (UJ-50)', async () => {
    const body = await callAnalytics();

    const clase2 = body.byClass.find((c) => c.classId === 'class-02');
    assert.strictEqual(clase2.questionCount, 3);
    const temaClase2 = clase2.topics.find((t) => t.tema === 'Arquitectura en capas');
    assert.ok(temaClase2, 'el encuentro declara sus temas');
    assert.strictEqual(temaClase2.count, 3);
    assert.strictEqual(temaClase2.origenes.valoracionBaja, 2);
    assert.strictEqual(clase2.origenes.consultaSinMaterial, 1);

    const clase1 = body.byClass.find((c) => c.classId === 'class-01');
    assert.ok(clase1.topics.some((t) => t.tema === 'Atributos de calidad'), 'el tema declarado aparece en su encuentro');
    assert.ok(clase1.topics.some((t) => t.tema === 'Sin tema'), 'lo suelto del encuentro también se declara');
});

test('sin temario declarado no inventa temas: todo queda en «sin tema»', async () => {
    stateStoreMocks.listClassesBySubject.mock.mockImplementation(async () => []);
    try {
        const body = await callAnalytics();
        assert.deepStrictEqual(body.topics, []);
        assert.strictEqual(body.sinTema.count, 7);
        assert.strictEqual(body.temario.totalTemas, 0);
    } finally {
        stateStoreMocks.listClassesBySubject.mock.mockImplementation(async () => CLASSES);
    }
});
