import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert';

// #445 (UJ-32): la práctica en grupo. Lo que estos tests fijan:
//
//   - el grupo se deriva de lo que la materia ya declara (matrículas activas),
//     nunca de integrantes inventados por el panel;
//   - la práctica compartida se emite UNA sola vez: la primera persona la genera
//     y las demás abren el mismo conjunto, con el mismo alcance;
//   - el conjunto no se adapta a quien la abre (sin exclusiones de intentos
//     previos de una persona): tiene que servirle a todo el grupo;
//   - cada persona responde por separado, y la comparación no se abre antes de
//     responder la propia;
//   - la comparación dice en qué preguntas coincidieron y en cuáles no, sin
//     exponer a quién eligió qué, y produce los temas que el grupo no pudo
//     acordar para llevarlos a quien enseña.

let currentUid = 'alu-001';

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => null),
    getAuthenticatedUser: mock.fn(() => ({ userId: currentUid, sanitizedId: currentUid })),
};

const SUBJECT = 'arq-software-2026';
const CLASSES = [
    { id: 'class-01', title: 'Clase 1 — Introducción', publicationState: 'publicado', topics: ['Modelado de procesos', 'Virtualización'] },
    { id: 'class-02', title: 'Clase 2 — Requisitos', publicationState: 'publicado', topics: ['Requisitos formales'] },
];
const MATERIALS = {
    'class-01': [{ materialId: 'm-01', type: 'transcript', filename: 'clase1.vtt' }],
    'class-02': [{ materialId: 'm-02', type: 'notes', filename: 'clase2.md' }],
};

// El grupo: tres estudiantes activas, una estudiante inactiva y una docente.
const ENROLLMENTS = [
    { userId: 'alu-001', role: 'student', status: 'active' },
    { userId: 'alu-003', role: 'student', status: 'active' },
    { userId: 'alu-005', role: 'student', status: 'active' },
    { userId: 'alu-002', role: 'student', status: 'inactive' },
    { userId: 'prof-001', role: 'teacher', status: 'active' },
];

const groupQuizStore = new Map();
const groupResponseStore = new Map();
const groupRecordStore = new Map();
// Intentos individuales previos: sirven para probar que el conjunto compartido
// no hereda las exclusiones de una sola persona.
const individualAttempts = [];

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active' })),
    getConsentStatus: mock.fn(async () => true),
    listClassesBySubject: mock.fn(async () => CLASSES),
    listMaterialsByClass: mock.fn(async (subjectId, classId) => MATERIALS[classId] || []),
    saveQuiz: mock.fn(async (quiz) => quiz),
    getQuiz: mock.fn(async () => null),
    upsertQuizResult: mock.fn(async (result) => result),
    getQuizResult: mock.fn(async () => null),
    appendQuizAttempt: mock.fn(async (attempt) => attempt),
    listQuizAttempts: mock.fn(async (subjectId, userId, classId) => individualAttempts
        .filter((a) => a.userId === userId && a.classId === classId)),
    upsertQuizWeakTopics: mock.fn(async (record) => record),
    getQuizWeakTopics: mock.fn(async () => null),
    getEnrollmentsBySubject: mock.fn(async () => ENROLLMENTS),
    saveGroupQuiz: mock.fn(async (quiz) => {
        const saved = { ...quiz, questionCount: quiz.questions.length };
        groupQuizStore.set(`${quiz.subjectId}:${quiz.groupQuizId}`, saved);
        return saved;
    }),
    getGroupQuiz: mock.fn(async (subjectId, groupQuizId) => groupQuizStore.get(`${subjectId}:${groupQuizId}`) || null),
    findOpenGroupQuiz: mock.fn(async (subjectId, scope, classId) => {
        const open = Array.from(groupQuizStore.values())
            .filter((q) => q.subjectId === subjectId && q.scope === scope && q.classId === classId)
            .filter((q) => !q.expiresAt || Date.parse(q.expiresAt) > Date.now());
        return open[open.length - 1] || null;
    }),
    upsertGroupQuizResponse: mock.fn(async (response) => {
        groupResponseStore.set(`${response.groupQuizId}:${response.userId}`, response);
        return response;
    }),
    getGroupQuizResponse: mock.fn(async (groupQuizId, userId) => groupResponseStore.get(`${groupQuizId}:${userId}`) || null),
    listGroupQuizResponses: mock.fn(async (groupQuizId) => Array.from(groupResponseStore.values())
        .filter((r) => r.groupQuizId === groupQuizId)),
    upsertGroupQuizRecord: mock.fn(async (record) => {
        groupRecordStore.set(record.groupQuizId, record);
        return record;
    }),
    getGroupQuizRecord: mock.fn(async (groupQuizId) => groupRecordStore.get(groupQuizId) || null),
};

const prompts = [];
const aiMocks = {
    chatCompletion: mock.fn(async (messages) => {
        prompts.push({ system: messages[0].content, user: messages[1].content });
        return {
            content: JSON.stringify([
                { question: 'P1', options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'e1', topic: 'Modelado de procesos', source: 'Transcripción del encuentro — clase1.vtt' },
                { question: 'P2', options: ['a', 'b', 'c', 'd'], correctIndex: 2, explanation: 'e2', topic: 'Requisitos formales', source: 'Notas — clase2.md' },
            ]),
        };
    }),
    getChatModelName: mock.fn(() => 'modelo'),
    getModelDisplayName: mock.fn(() => 'Modelo de prueba'),
    resolveModelForTask: mock.fn(async () => 'modelo'),
};

mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/ai.js', { namedExports: aiMocks });
mock.module('../services/prompts.js', { namedExports: { getActivePrompt: mock.fn(async () => null) } });
mock.module('../services/storage.js', {
    namedExports: { loadJson: mock.fn(async (container, key) => ({ summary: { content: `resumen de ${key}` } })) },
});
mock.module('../services/structured-logger.js', {
    namedExports: { createStructuredLogger: () => ({ log: () => {}, info: () => {}, error: () => {}, warn: () => {} }) },
});
mock.module('../middleware/with-auth.js', { namedExports: { withAuth: (h) => async (r, c) => h(r, c) } });
mock.module('../middleware/with-correlation.js', { namedExports: { withCorrelation: (h) => h } });
mock.module('../middleware/with-rate-limit.js', { namedExports: { withRateLimit: (h) => h } });

const handlers = {};
mock.module('@azure/functions', {
    namedExports: { app: { http: (name, options) => { handlers[name] = options.handler; } } },
});

await import('./quiz-api.js');

function req({ body = null, query = {} } = {}) {
    return {
        method: body ? 'POST' : 'GET',
        query: { get: (key) => (key in query ? query[key] : null) },
        headers: { get: () => null },
        json: async () => body,
    };
}
const ctx = { log: () => {}, error: () => {}, warn: () => {} };
const parse = (res) => JSON.parse(res.body);

beforeEach(() => {
    currentUid = 'alu-001';
    groupQuizStore.clear();
    groupResponseStore.clear();
    groupRecordStore.clear();
    individualAttempts.length = 0;
    prompts.length = 0;
    aiMocks.chatCompletion.mock.resetCalls();
    stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => ENROLLMENTS);
});

async function abrirPracticaDelGrupo({ scope = 'class', classId = 'class-01', classIds } = {}) {
    const res = await handlers['create-group-quiz'](req({
        body: { subjectId: SUBJECT, scope, classId, classIds, subjectName: 'Arquitectura de Software' },
    }), ctx);
    return { status: res.status, body: parse(res) };
}

async function responder(groupQuizId, answers, uid) {
    currentUid = uid;
    const res = await handlers['save-group-quiz-response'](req({
        body: { subjectId: SUBJECT, groupQuizId, answers },
    }), ctx);
    return { status: res.status, body: parse(res) };
}

test('el grupo se deriva de las matrículas activas: no hay integrantes inventados', async () => {
    const res = await handlers['get-group-quiz'](req({
        query: { subjectId: SUBJECT, classId: 'class-01' },
    }), ctx);
    const body = parse(res);

    // alu-002 está inactiva y prof-001 no es estudiante: quedan tres.
    assert.strictEqual(body.group.memberCount, 3);
    assert.match(body.group.derivedFrom, /matrículas activas/);
    assert.strictEqual(body.practice, null);
});

test('quien no tiene matrícula activa no entra a la práctica del grupo', async () => {
    currentUid = 'alu-002';
    const res = await handlers['get-group-quiz'](req({
        query: { subjectId: SUBJECT, classId: 'class-01' },
    }), ctx);
    const body = parse(res);

    assert.strictEqual(res.status, 403);
    assert.strictEqual(body.error.code, 'GROUP_NOT_ENROLLED');
});

test('sin matrículas estudiantiles activas el grupo no existe y se dice', async () => {
    stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => [
        { userId: 'alu-001', role: 'student', status: 'inactive' },
    ]);
    const res = await abrirPracticaDelGrupo();

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error.code, 'GROUP_NOT_ENROLLED');
    assert.strictEqual(aiMocks.chatCompletion.mock.callCount(), 0, 'sin grupo no se gasta una generación');
});

test('la práctica se emite una sola vez: las demás abren el mismo conjunto', async () => {
    const primera = await abrirPracticaDelGrupo();
    assert.strictEqual(primera.status, 200);
    assert.strictEqual(primera.body.reused, false);

    const segunda = await abrirPracticaDelGrupo();
    assert.strictEqual(segunda.status, 200);
    assert.strictEqual(segunda.body.reused, true);
    assert.strictEqual(segunda.body.groupQuizId, primera.body.groupQuizId);
    assert.deepStrictEqual(
        segunda.body.questions.map((q) => q.id),
        primera.body.questions.map((q) => q.id),
        'las dos personas responden exactamente el mismo conjunto',
    );
    assert.strictEqual(aiMocks.chatCompletion.mock.callCount(), 1, 'reabrir la práctica no vuelve a llamar al modelo');
});

test('el conjunto compartido no se adapta a quien la abre', async () => {
    // alu-001 ya hizo dos prácticas individuales de esa clase: si el pedido del
    // grupo heredara sus exclusiones, el conjunto no serviría para las demás.
    individualAttempts.push({
        subjectId: SUBJECT,
        userId: 'alu-001',
        classId: 'class-01',
        attemptNumber: 1,
        answers: [{ question: 'Pregunta ya vista por alu-001', topic: 'Modelado de procesos', isCorrect: true }],
    });

    await abrirPracticaDelGrupo();
    const pedido = prompts[0]?.user || '';
    assert.ok(!/NO repitas/.test(pedido), 'el pedido del grupo no excluye las preguntas de una sola persona');
    assert.ok(!/alu-001/.test(pedido), 'el pedido no menciona a quien la abre');
});

test('las preguntas no viajan al cliente con la respuesta correcta', async () => {
    const { body } = await abrirPracticaDelGrupo();
    for (const question of body.questions) {
        assert.ok(!('correctIndex' in question));
        assert.ok(!('explanation' in question));
    }
});

test('la comparación no se abre antes de responder la propia', async () => {
    const { body } = await abrirPracticaDelGrupo();
    const res = await handlers['get-group-quiz-comparison'](req({
        query: { subjectId: SUBJECT, groupQuizId: body.groupQuizId },
    }), ctx);
    const payload = parse(res);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(payload.error.code, 'GROUP_QUIZ_NOT_ANSWERED');
});

test('la comparación dice en qué coincidieron y en qué no, sin nombrar a nadie', async () => {
    const { body: practica } = await abrirPracticaDelGrupo();
    const [q1, q2] = practica.questions;

    await responder(practica.groupQuizId, [
        { questionId: q1.id, selectedIndex: 1 },
        { questionId: q2.id, selectedIndex: 2 },
    ], 'alu-001');
    await responder(practica.groupQuizId, [
        { questionId: q1.id, selectedIndex: 0 },
        { questionId: q2.id, selectedIndex: 2 },
    ], 'alu-005');

    currentUid = 'alu-005';
    const res = await handlers['get-group-quiz-comparison'](req({
        query: { subjectId: SUBJECT, groupQuizId: practica.groupQuizId },
    }), ctx);
    const cuerpo = parse(res);
    const comparacion = cuerpo;

    assert.strictEqual(res.status, 200);
    assert.strictEqual(comparacion.commonResult.answeredCount, 2);
    assert.strictEqual(comparacion.commonResult.agreedCount, 1);
    assert.strictEqual(comparacion.commonResult.disagreedCount, 1);

    const porPregunta = new Map(comparacion.questions.map((q) => [q.questionId, q]));
    assert.strictEqual(porPregunta.get(q1.id).agreed, false);
    assert.deepStrictEqual(porPregunta.get(q1.id).distribution, [1, 1, 0, 0]);
    assert.strictEqual(porPregunta.get(q1.id).myAnswerIndex, 0);
    assert.strictEqual(porPregunta.get(q2.id).agreed, true);
    assert.strictEqual(porPregunta.get(q2.id).commonAnswerIndex, 2);

    // Los temas que el grupo no pudo acordar salen de las preguntas en desacuerdo.
    assert.deepStrictEqual(comparacion.consultTopics, [{ topic: 'Modelado de procesos', questionCount: 1 }]);
    // La comparación es agregada: no expone quién eligió qué.
    assert.ok(!/alu-001|alu-005/.test(res.body), 'la comparación no nombra a las personas');
});

test('con una sola respuesta todavía no hay coincidencias que mostrar', async () => {
    const { body: practica } = await abrirPracticaDelGrupo();
    const [q1] = practica.questions;
    await responder(practica.groupQuizId, [{ questionId: q1.id, selectedIndex: 1 }], 'alu-001');

    const res = await handlers['get-group-quiz-comparison'](req({
        query: { subjectId: SUBJECT, groupQuizId: practica.groupQuizId },
    }), ctx);
    const cuerpo = parse(res);

    assert.strictEqual(cuerpo.commonResult.answeredCount, 1);
    assert.strictEqual(cuerpo.commonResult.comparedCount, 0);
    assert.strictEqual(cuerpo.commonResult.pendingCount, 2, 'faltan dos personas del grupo');
    assert.strictEqual(cuerpo.questions[0].agreed, false);
    assert.deepStrictEqual(cuerpo.consultTopics, []);
});

test('cada persona responde una sola vez: la segunda respuesta no reescribe la comparación', async () => {
    const { body: practica } = await abrirPracticaDelGrupo();
    const [q1, q2] = practica.questions;
    const primera = await responder(practica.groupQuizId, [
        { questionId: q1.id, selectedIndex: 0 },
        { questionId: q2.id, selectedIndex: 0 },
    ], 'alu-001');
    assert.strictEqual(primera.status, 200);

    const segunda = await responder(practica.groupQuizId, [
        { questionId: q1.id, selectedIndex: 1 },
        { questionId: q2.id, selectedIndex: 2 },
    ], 'alu-001');
    assert.strictEqual(segunda.status, 409);
    assert.strictEqual(segunda.body.error.code, 'GROUP_QUIZ_ALREADY_ANSWERED');
});

test('el servidor corrige: el puntaje que manda el cliente no cuenta', async () => {
    const { body: practica } = await abrirPracticaDelGrupo();
    const [q1, q2] = practica.questions;
    currentUid = 'alu-001';
    const res = await handlers['save-group-quiz-response'](req({
        body: {
            subjectId: SUBJECT,
            groupQuizId: practica.groupQuizId,
            score: 100,
            correctCount: 2,
            answers: [
                { questionId: q1.id, selectedIndex: 0 },
                { questionId: q2.id, selectedIndex: 0 },
            ],
        },
    }), ctx);
    const cuerpo = parse(res);

    assert.strictEqual(cuerpo.score, 0);
    assert.strictEqual(cuerpo.correctCount, 0);
});

test('el grupo asienta un resultado común y los temas que no pudo acordar', async () => {
    const { body: practica } = await abrirPracticaDelGrupo();
    const [q1, q2] = practica.questions;
    await responder(practica.groupQuizId, [
        { questionId: q1.id, selectedIndex: 1 },
        { questionId: q2.id, selectedIndex: 2 },
    ], 'alu-001');
    await responder(practica.groupQuizId, [
        { questionId: q1.id, selectedIndex: 0 },
        { questionId: q2.id, selectedIndex: 2 },
    ], 'alu-003');

    currentUid = 'alu-003';
    const res = await handlers['save-group-quiz-record'](req({
        body: { subjectId: SUBJECT, groupQuizId: practica.groupQuizId },
    }), ctx);
    const { record } = parse(res);

    assert.strictEqual(record.revision, 1);
    assert.strictEqual(record.respondedCount, 2);
    assert.strictEqual(record.memberCount, 3);
    assert.strictEqual(record.agreed.length, 1);
    assert.strictEqual(record.disagreed.length, 1);
    assert.deepStrictEqual(record.consultTopics, [{ topic: 'Modelado de procesos', questionCount: 1 }]);

    // El acta queda a la vista de todo el grupo en el estado de la práctica.
    const estado = parse(await handlers['get-group-quiz'](req({
        query: { subjectId: SUBJECT, classId: 'class-01' },
    }), ctx));
    assert.strictEqual(estado.record.revision, 1);
    assert.deepStrictEqual(estado.record.consultTopics, [{ topic: 'Modelado de procesos', questionCount: 1 }]);

    // Reasentar con una tercera respuesta no borra el acta: la revisa con lo que
    // hay. Con dos de tres eligiendo lo mismo, la pregunta sigue en desacuerdo:
    // «coincidieron» exige unanimidad entre quienes respondieron.
    await responder(practica.groupQuizId, [
        { questionId: q1.id, selectedIndex: 1 },
        { questionId: q2.id, selectedIndex: 2 },
    ], 'alu-005');
    const segundaActa = parse(await handlers['save-group-quiz-record'](req({
        body: { subjectId: SUBJECT, groupQuizId: practica.groupQuizId },
    }), ctx));
    assert.strictEqual(segundaActa.record.revision, 2);
    assert.strictEqual(segundaActa.record.respondedCount, 3);
    assert.deepStrictEqual(segundaActa.record.consultTopics, [{ topic: 'Modelado de procesos', questionCount: 1 }]);
    assert.deepStrictEqual(
        segundaActa.record.disagreed[0].distribution,
        [1, 2, 0, 0],
        'el acta asentada guarda el reparto con el que se decidió',
    );
});

test('no se puede asentar el acta sin haber respondido la práctica', async () => {
    const { body: practica } = await abrirPracticaDelGrupo();
    const res = await handlers['save-group-quiz-record'](req({
        body: { subjectId: SUBJECT, groupQuizId: practica.groupQuizId },
    }), ctx);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(parse(res).error.code, 'GROUP_QUIZ_NOT_ANSWERED');
});

test('coincidir en una respuesta equivocada es un tema para consultar, no un acuerdo', async () => {
    const { body: practica } = await abrirPracticaDelGrupo();
    const [q1, q2] = practica.questions;
    // Las dos eligen 0 en la primera pregunta, cuya correcta es 1.
    await responder(practica.groupQuizId, [
        { questionId: q1.id, selectedIndex: 0 },
        { questionId: q2.id, selectedIndex: 2 },
    ], 'alu-001');
    await responder(practica.groupQuizId, [
        { questionId: q1.id, selectedIndex: 0 },
        { questionId: q2.id, selectedIndex: 2 },
    ], 'alu-005');

    const comparacion = parse(await handlers['get-group-quiz-comparison'](req({
        query: { subjectId: SUBJECT, groupQuizId: practica.groupQuizId },
    }), ctx));

    assert.strictEqual(comparacion.commonResult.agreedCount, 2);
    assert.strictEqual(comparacion.commonResult.consensusWrongCount, 1);
    assert.deepStrictEqual(comparacion.coincidieronEnIncorrecta.map((q) => q.topic), ['Modelado de procesos']);
});

test('la práctica de la unidad también se comparte, con su alcance', async () => {
    const { body } = await abrirPracticaDelGrupo({ scope: 'unit', classId: undefined });
    assert.strictEqual(body.scope, 'unit');
    assert.strictEqual(body.classId, null);
    assert.deepStrictEqual(body.classIds.sort(), ['class-01', 'class-02']);
    assert.match(prompts[0].user, /unidad/i);
});
