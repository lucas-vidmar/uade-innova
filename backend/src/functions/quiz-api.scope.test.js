import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert';

// UJ-30, pasos 1 y 2 (issue #446): la práctica es de la UNIDAD, el sistema
// anuncia qué temas abarca antes de empezar y deja acotarla a los temas que más
// preocupan. Lo que estos tests fijan:
//
//   - `GET /api/quiz-scope` anuncia los temas de las clases publicadas sin gastar
//     una generación;
//   - `POST /api/generate-quiz` con `scope: 'unit'` reúne el material de todas
//     las clases publicadas (o del subconjunto elegido) en un solo cuestionario;
//   - acotar nunca deja el cuestionario vacío: un alcance vacío, ajeno o sin
//     material se rechaza con un error explícito;
//   - el intento de la unidad se guarda aparte del de cada clase, así que la
//     práctica por clase sigue funcionando igual que antes.

let currentUid = 'alu-003';

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => null),
    getAuthenticatedUser: mock.fn(() => ({ userId: currentUid, sanitizedId: currentUid })),
};

// La unidad `arq-software-2026` con seis clases: cuatro publicadas (una sin temas
// declarados y otra sin material procesado) y dos que no se publicaron.
const CLASSES = [
    { id: 'class-01', title: 'Clase 1 — Introducción', date: '2026-03-05', publicationState: 'publicado', topics: ['Arquitectura', 'Capas'] },
    { id: 'class-02', title: 'Clase 2 — Diseño guiado por el dominio', date: '2026-03-12', publicationState: 'publicado', topics: ['DDD'] },
    { id: 'class-03', title: 'Clase 3 — Eventos', date: '2026-03-19', publicationState: 'publicado', topics: [] },
    { id: 'class-04', title: 'Clase 4 — Sin material', date: '2026-03-26', publicationState: 'publicado', topics: ['Tema sin material'] },
    { id: 'class-05', title: 'Clase 5 — Borrador', date: '2026-04-02', publicationState: 'borrador', topics: ['Tema no publicado'] },
    { id: 'class-06', title: 'Clase 6 — Pendiente de aval', date: '2026-04-09', publicationState: 'pendiente_de_aval', topics: ['Otro tema no publicado'] },
];

const MATERIALS_BY_CLASS = {
    'class-01': [{ materialId: 'm-01', type: 'transcript', filename: 'clase1.vtt' }],
    'class-02': [{ materialId: 'm-02', type: 'presentation', filename: 'ddd.pdf' }],
    'class-03': [{ materialId: 'm-03', type: 'notes', filename: 'eventos.md' }],
    'class-04': [],
};

const quizStore = new Map();
const resultStore = new Map();
const attemptStore = [];
const weakTopicStore = new Map();

let classesOverride = null;
let summaryByClassAvailable = true;

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active' })),
    getConsentStatus: mock.fn(async () => true),
    listClassesBySubject: mock.fn(async () => classesOverride || CLASSES),
    listMaterialsByClass: mock.fn(async (subjectId, classId) => MATERIALS_BY_CLASS[classId] || []),
    saveQuiz: mock.fn(async (quiz) => {
        quizStore.set(`${quiz.subjectId}:${quiz.quizId}`, quiz);
        return quiz;
    }),
    getQuiz: mock.fn(async (subjectId, quizId) => quizStore.get(`${subjectId}:${quizId}`) || null),
    upsertQuizResult: mock.fn(async (result) => {
        resultStore.set(`${result.subjectId}:${result.userId}__${result.classId}`, result);
        return result;
    }),
    getQuizResult: mock.fn(async (subjectId, userId, classId) => resultStore.get(`${subjectId}:${userId}__${classId}`) || null),
    appendQuizAttempt: mock.fn(async (attempt) => { attemptStore.push(attempt); return attempt; }),
    listQuizAttempts: mock.fn(async (subjectId, userId, classId) => attemptStore
        .filter((a) => a.subjectId === subjectId && a.userId === userId && a.classId === classId)
        .sort((a, b) => a.attemptNumber - b.attemptNumber)),
    upsertQuizWeakTopics: mock.fn(async (record) => {
        const saved = { ...record, updatedAt: new Date().toISOString() };
        weakTopicStore.set(`${record.subjectId}:${record.userId}__${record.classId}`, saved);
        return saved;
    }),
    getQuizWeakTopics: mock.fn(async (subjectId, userId, classId) => weakTopicStore.get(`${subjectId}:${userId}__${classId}`) || null),
    // #445 (UJ-32): la práctica compartida del grupo tiene sus propias tablas y
    // no participa de estos casos; se declaran para que el módulo enlace igual.
    getEnrollmentsBySubject: mock.fn(async () => []),
    saveGroupQuiz: mock.fn(async (quiz) => quiz),
    getGroupQuiz: mock.fn(async () => null),
    findOpenGroupQuiz: mock.fn(async () => null),
    upsertGroupQuizResponse: mock.fn(async (response) => response),
    getGroupQuizResponse: mock.fn(async () => null),
    listGroupQuizResponses: mock.fn(async () => []),
    upsertGroupQuizRecord: mock.fn(async (record) => record),
    getGroupQuizRecord: mock.fn(async () => null),
};

// El modelo contesta citando el bloque de la clase 2: el intento de unidad tiene
// que poder volver al encuentro de ese tema, no al de la unidad entera.
const promotedPrompts = [];
const aiMocks = {
    chatCompletion: mock.fn(async (messages) => {
        promotedPrompts.push({ system: messages[0].content, user: messages[1].content });
        return {
            content: JSON.stringify([
                { question: 'P1 sobre DDD', options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'e1', topic: 'DDD', source: 'Resumen — Clase 2 — Diseño guiado por el dominio' },
                { question: 'P2 sobre eventos', options: ['a', 'b', 'c', 'd'], correctIndex: 2, explanation: 'e2', topic: 'Eventos', source: 'Resumen — Clase 3 — Eventos' },
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
    namedExports: {
        loadJson: mock.fn(async (container, path) => {
            if (container === 'class-summaries') {
                if (!summaryByClassAvailable) return null;
                return { summary: { content: `resumen de ${path}` } };
            }
            if (container === 'processed') return { extractedText: `texto de ${path}` };
            return null;
        }),
    },
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

function req(body = null, query = {}) {
    return {
        method: body ? 'POST' : 'GET',
        query: { get: (k) => (k in query ? query[k] : null) },
        headers: { get: () => null },
        json: async () => body,
    };
}
const ctx = { log: () => {}, error: () => {}, warn: () => {} };
const parse = (res) => JSON.parse(res.body);

beforeEach(() => {
    currentUid = 'alu-003';
    classesOverride = null;
    summaryByClassAvailable = true;
    quizStore.clear();
    resultStore.clear();
    attemptStore.length = 0;
    weakTopicStore.clear();
    promotedPrompts.length = 0;
    aiMocks.chatCompletion.mock.resetCalls();
});

async function generarUnidad(body = {}) {
    const res = await handlers['generate-quiz'](req({ subjectId: 'arq-software-2026', scope: 'unit', questionCount: 5, ...body }), ctx);
    return { res, body: parse(res) };
}

test('quiz-scope anuncia los temas de las clases publicadas sin gastar una generación', async () => {
    const res = await handlers['get-quiz-scope'](req(null, { subjectId: 'arq-software-2026' }), ctx);
    const scope = parse(res);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(scope.scope.kind, 'unit');
    assert.strictEqual(scope.scope.classCount, 4, 'sólo cuentan las clases publicadas');
    assert.deepStrictEqual(scope.scope.classIds, ['class-01', 'class-02', 'class-03', 'class-04']);
    assert.strictEqual(scope.scope.topicCount, 5, 'Arquitectura, Capas, DDD, el título de la clase 3 y el tema de la clase 4');
    assert.match(scope.headline, /5 temas de 4 clases publicadas/);
    assert.deepStrictEqual(scope.topics.map((t) => t.topic), ['Arquitectura', 'Capas', 'DDD', 'Clase 3 — Eventos', 'Tema sin material']);
    // La clase sin temas declarados declara su título como tema, sin inventar otros.
    const clase3 = scope.topics.find((t) => t.classId === 'class-03');
    assert.strictEqual(clase3.declared, false);
    // Anunciar el alcance no es generar: no se llamó al modelo.
    assert.strictEqual(aiMocks.chatCompletion.mock.callCount(), 0);
});

test('quiz-scope no anuncia temas de clases que no se publicaron', async () => {
    const res = await handlers['get-quiz-scope'](req(null, { subjectId: 'arq-software-2026' }), ctx);
    const scope = parse(res);

    assert.ok(!scope.scope.classIds.includes('class-05'));
    assert.ok(!scope.scope.classIds.includes('class-06'));
    assert.ok(!scope.topics.some((t) => t.topic === 'Tema no publicado'));
});

test('quiz-scope muestra los temas que la persona ya marcó como flojos en cada clase', async () => {
    weakTopicStore.set('arq-software-2026:alu-003__class-02', { topics: ['DDD'] });

    const res = await handlers['get-quiz-scope'](req(null, { subjectId: 'arq-software-2026' }), ctx);
    const scope = parse(res);
    const ddd = scope.topics.find((t) => t.topic === 'DDD');

    assert.strictEqual(ddd.markedWeak, true, 'el anuncio tiene que poder señalar lo que ya le preocupa');
    assert.deepStrictEqual(scope.classes.find((c) => c.classId === 'class-02').markedTopics, ['DDD']);
});

test('generate-quiz con alcance de unidad reúne los temas de todas las clases publicadas', async () => {
    const { res, body } = await generarUnidad();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.scope, 'unit');
    assert.deepStrictEqual(body.classIds, ['class-01', 'class-02', 'class-03', 'class-04']);
    assert.strictEqual(body.classId, null, 'la práctica de la unidad no es de una clase');
    assert.strictEqual(body.questions.length, 2);

    const { system, user } = promotedPrompts[0];
    assert.match(system, /cubren la UNIDAD completa/);
    assert.match(user, /Unidad: arq-software-2026/);
    for (const titulo of ['Clase 1 — Introducción', 'Clase 2 — Diseño guiado por el dominio', 'Clase 3 — Eventos']) {
        assert.ok(user.includes(titulo), `el pedido tiene que nombrar el tema de ${titulo}`);
    }
    assert.ok(!user.includes('Clase 5 — Borrador'), 'una clase sin publicar no entra al cuestionario');
    // El contexto se arma con el resumen y el material de cada clase, rotulado por clase.
    assert.ok(user.includes('[Resumen — Clase 2 — Diseño guiado por el dominio]'));
    assert.ok(user.includes('Clase 3 — Eventos · Notas — eventos.md'));
});

test('el acotamiento usa sólo las clases elegidas y prioriza los temas que preocupan', async () => {
    const { res, body } = await generarUnidad({ classIds: ['class-02'], topics: ['DDD'] });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(body.classIds, ['class-02']);
    assert.deepStrictEqual(body.topics, ['DDD']);

    const { user } = promotedPrompts[0];
    assert.ok(user.includes('Clase 2 — Diseño guiado por el dominio'));
    assert.ok(!user.includes('Clase 1 — Introducción'), 'lo que se destildó no puede entrar al contexto');
    assert.match(user, /temas de estas 1 clases/);
    assert.match(user, /concentrar la práctica en estos temas/);
    assert.match(user, /\n1\. DDD\n/);
});

test('acotar a un alcance vacío se rechaza en vez de devolver un cuestionario vacío', async () => {
    const vacio = await handlers['generate-quiz'](req({ subjectId: 'arq-software-2026', scope: 'unit', classIds: [] }), ctx);
    assert.strictEqual(vacio.status, 400);
    assert.strictEqual(parse(vacio).error.code, 'QUIZ_SCOPE_EMPTY');
    assert.strictEqual(aiMocks.chatCompletion.mock.callCount(), 0);

    const ajeno = await handlers['generate-quiz'](req({ subjectId: 'arq-software-2026', scope: 'unit', classIds: ['class-99'] }), ctx);
    assert.strictEqual(ajeno.status, 400);
    assert.strictEqual(parse(ajeno).error.code, 'QUIZ_SCOPE_INVALID');
    assert.match(parse(ajeno).error.message, /class-99/);

    const sinPublicar = await handlers['generate-quiz'](req({ subjectId: 'arq-software-2026', scope: 'unit', classIds: ['class-05'] }), ctx);
    assert.strictEqual(sinPublicar.status, 400, 'una clase en borrador no se puede practicar');
    assert.strictEqual(parse(sinPublicar).error.code, 'QUIZ_SCOPE_INVALID');
    assert.strictEqual(aiMocks.chatCompletion.mock.callCount(), 0);
});

test('si la unidad no tiene clases publicadas, no hay práctica que generar', async () => {
    classesOverride = CLASSES.filter((c) => c.publicationState !== 'publicado');

    const { res, body } = await generarUnidad();

    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.error.code, 'QUIZ_SCOPE_EMPTY');
    assert.strictEqual(aiMocks.chatCompletion.mock.callCount(), 0);
});

test('si los temas elegidos no tienen resumen ni material, se avisa en vez de generar a ciegas', async () => {
    summaryByClassAvailable = false;

    const { res, body } = await generarUnidad({ classIds: ['class-04'] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(body.error.code, 'QUIZ_SCOPE_EMPTY');
    assert.match(body.error.message, /no tienen resumen ni materiales/);
    assert.strictEqual(aiMocks.chatCompletion.mock.callCount(), 0);
});

test('el intento de la unidad se guarda aparte del de cada clase', async () => {
    const { body: quiz } = await generarUnidad();

    const cierre = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026',
        scope: 'unit',
        quizId: quiz.quizId,
        answers: quiz.questions.map((q) => ({ questionId: q.id, selectedIndex: 1 })),
    }), ctx);
    const resultado = parse(cierre);

    assert.strictEqual(cierre.status, 200);
    assert.strictEqual(resultado.classId, '__unit__');
    assert.strictEqual(resultado.attemptCount, 1);
    assert.ok(resultStore.has('arq-software-2026:alu-003____unit__'));
    // El resultado de la clase 1 no se toca: la práctica por clase conserva su historial.
    const porClase = await handlers['get-quiz-result'](req(null, { subjectId: 'arq-software-2026', classId: 'class-01' }), ctx);
    assert.strictEqual(parse(porClase).result, null);
});

test('el cuestionario de la unidad no se puede cerrar como si fuera de una clase', async () => {
    const { body: quiz } = await generarUnidad();

    const res = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026',
        classId: 'class-01',
        quizId: quiz.quizId,
        answers: [{ questionId: quiz.questions[0].id, selectedIndex: 1 }],
    }), ctx);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(parse(res).error.code, 'QUIZ_CLASS_MISMATCH');
});

test('el historial de la unidad se lee aparte del de las clases', async () => {
    const { body: quiz } = await generarUnidad();
    await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026', scope: 'unit', quizId: quiz.quizId,
        answers: quiz.questions.map((q) => ({ questionId: q.id, selectedIndex: 1 })),
    }), ctx);

    const unidad = await handlers['get-quiz-attempts'](req(null, { subjectId: 'arq-software-2026', scope: 'unit' }), ctx);
    const clase = await handlers['get-quiz-attempts'](req(null, { subjectId: 'arq-software-2026', classId: 'class-01' }), ctx);

    assert.strictEqual(parse(unidad).attempts.length, 1);
    assert.strictEqual(parse(clase).attempts.length, 0);
});

test('el repaso de un fallo de la unidad apunta a la clase del material que lo respalda', async () => {
    const { body: quiz } = await generarUnidad();

    const res = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026', scope: 'unit', quizId: quiz.quizId,
        answers: quiz.questions.map((q) => ({ questionId: q.id, selectedIndex: 0 })),
    }), ctx);
    const answers = parse(res).answers;

    assert.strictEqual(answers[0].classId, 'class-02');
    assert.strictEqual(answers[0].source, 'Resumen — Clase 2 — Diseño guiado por el dominio');
    assert.strictEqual(answers[1].classId, 'class-03');
});

test('la práctica por clase sigue pidiendo classId y no se comporta como la de la unidad', async () => {
    const sinClase = await handlers['generate-quiz'](req({ subjectId: 'arq-software-2026', questionCount: 5 }), ctx);
    assert.strictEqual(sinClase.status, 400);
    assert.match(parse(sinClase).error, /subjectId, classId/);

    const porClase = await handlers['generate-quiz'](req({ subjectId: 'arq-software-2026', classId: 'class-01', questionCount: 5 }), ctx);
    const body = parse(porClase);

    assert.strictEqual(porClase.status, 200);
    assert.strictEqual(body.scope, 'class');
    assert.strictEqual(body.classId, 'class-01');
    assert.deepStrictEqual(body.classIds, ['class-01']);
    assert.match(promotedPrompts[0].user, /sobre la siguiente clase/);
    assert.match(promotedPrompts[0].user, /Clase: class-01/);
    assert.ok(!promotedPrompts[0].user.includes('cubren la UNIDAD'));
});
