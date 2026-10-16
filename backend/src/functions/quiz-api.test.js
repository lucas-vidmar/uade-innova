import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert';

// La corrección del intento no puede vivir en el navegador: si el cliente
// calcula el puntaje, cualquiera lo puede forjar (verificado contra el piloto,
// 16/10/2026: POST con score=100 sobre un intento con 0 aciertos quedó guardado).
// Estos tests fijan el contrato: el servidor emite el cuestionario, lo guarda
// con sus respuestas correctas, y corrige con lo que el cliente eligió.

let currentUid = 'alu-001';
const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => null),
    getAuthenticatedUser: mock.fn(() => ({ userId: currentUid, sanitizedId: currentUid })),
};

const quizStore = new Map();
const resultStore = new Map();

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active' })),
    getConsentStatus: mock.fn(async () => true),
    listMaterialsByClass: mock.fn(async () => []),
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
};

const aiMocks = {
    chatCompletion: mock.fn(async () => ({ content: JSON.stringify([
        { question: 'P1', options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'e1', topic: 'Tema A' },
        { question: 'P2', options: ['a', 'b', 'c', 'd'], correctIndex: 2, explanation: 'e2', topic: 'Tema B' },
    ]) })),
    getChatModelName: mock.fn(() => 'modelo'),
    getModelDisplayName: mock.fn(() => 'Modelo de prueba'),
    resolveModelForTask: mock.fn(async () => 'modelo'),
};

mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/ai.js', { namedExports: aiMocks });
mock.module('../services/prompts.js', { namedExports: { getActivePrompt: mock.fn(async () => null) } });
mock.module('../services/storage.js', { namedExports: { loadJson: mock.fn(async () => ({ summary: { content: 'resumen de la clase' } })) } });
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

function req(body = null) {
    return {
        method: 'POST',
        query: { get: () => null },
        headers: { get: () => null },
        json: async () => body,
    };
}
const ctx = { log: () => {}, error: () => {}, warn: () => {} };
const parse = (res) => JSON.parse(res.body);

beforeEach(() => {
    currentUid = 'alu-001';
    quizStore.clear();
    resultStore.clear();
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active' }));
    stateStoreMocks.getConsentStatus.mock.mockImplementation(async () => true);
});

async function emitirQuiz(questionCount = 5) {
    const res = await handlers['generate-quiz'](req({ subjectId: 'arq-software-2026', classId: 'class-01', questionCount }), ctx);
    return parse(res);
}

test('generate-quiz no devuelve correctIndex ni explanation al navegador', async () => {
    const body = await emitirQuiz();

    assert.strictEqual(body.questions.length, 2);
    for (const q of body.questions) {
        assert.ok(!('correctIndex' in q), 'correctIndex no debe viajar al cliente');
        assert.ok(!('explanation' in q), 'explanation revela la respuesta correcta');
    }
    assert.deepStrictEqual(Object.keys(body.questions[0]).sort(), ['id', 'options', 'question', 'topic']);
});

test('generate-quiz guarda el cuestionario con sus respuestas correctas', async () => {
    const body = await emitirQuiz();
    const guardado = quizStore.get(`arq-software-2026:${body.quizId}`);

    assert.ok(guardado, 'el cuestionario debe quedar en el servidor');
    assert.strictEqual(guardado.userId, 'alu-001');
    assert.strictEqual(guardado.classId, 'class-01');
    assert.strictEqual(guardado.questions[0].correctIndex, 1);
    assert.strictEqual(guardado.questions[1].correctIndex, 2);
    assert.ok(Date.parse(guardado.expiresAt) > Date.now());
});

test('quiz-result ignora el puntaje que manda el cliente y corrige contra el cuestionario emitido', async () => {
    const { quizId, questions } = await emitirQuiz();

    // Intento forjado: declara 100% y "passed" con las dos respuestas mal.
    const res = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026',
        classId: 'class-01',
        quizId,
        score: 100,
        correctCount: 2,
        totalQuestions: 2,
        passed: true,
        weakTopics: [],
        answers: questions.map((q) => ({ questionId: q.id, selectedIndex: 0, isCorrect: true, correctIndex: 1 })),
    }), ctx);

    const body = parse(res);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.score, 0, 'el puntaje lo deriva el servidor');
    assert.strictEqual(body.correctCount, 0);
    assert.strictEqual(body.passed, false);
    assert.deepStrictEqual(body.weakTopics, ['Tema A', 'Tema B']);
    assert.strictEqual(body.answers[0].isCorrect, false);
    assert.strictEqual(body.answers[0].correctIndex, 1);
});

test('quiz-result corrige bien un intento con aciertos parciales', async () => {
    const { quizId, questions } = await emitirQuiz();

    const res = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026',
        classId: 'class-01',
        quizId,
        answers: [
            { questionId: questions[0].id, selectedIndex: 1 },
            { questionId: questions[1].id, selectedIndex: 0 },
        ],
    }), ctx);

    const body = parse(res);
    assert.strictEqual(body.correctCount, 1);
    assert.strictEqual(body.score, 50);
    assert.deepStrictEqual(body.weakTopics, ['Tema B']);
    assert.strictEqual(body.answers[0].isCorrect, true);
    assert.strictEqual(body.answers[1].isCorrect, false);
    assert.strictEqual(body.answers[1].explanation, 'e2', 'la explicación se entrega al corregir, no antes');
});

test('quiz-result rechaza un quizId desconocido (QUIZ_NOT_FOUND)', async () => {
    const res = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026', classId: 'class-01', quizId: 'inexistente', answers: [],
    }), ctx);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(parse(res).error.code, 'QUIZ_NOT_FOUND');
});

test('quiz-result rechaza el cuestionario de otra persona', async () => {
    const { quizId, questions } = await emitirQuiz();
    currentUid = 'alu-005';

    const res = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026', classId: 'class-01', quizId,
        answers: [{ questionId: questions[0].id, selectedIndex: 1 }],
    }), ctx);

    assert.strictEqual(res.status, 403);
    assert.strictEqual(parse(res).error.code, 'QUIZ_NOT_OWNED');
});

test('quiz-result rechaza un cuestionario de otra clase', async () => {
    const { quizId, questions } = await emitirQuiz();

    const res = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026', classId: 'class-02', quizId,
        answers: [{ questionId: questions[0].id, selectedIndex: 1 }],
    }), ctx);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(parse(res).error.code, 'QUIZ_CLASS_MISMATCH');
});

test('quiz-result rechaza un cuestionario vencido (QUIZ_EXPIRED)', async () => {
    const { quizId, questions } = await emitirQuiz();
    const guardado = quizStore.get(`arq-software-2026:${quizId}`);
    guardado.expiresAt = new Date(Date.now() - 1000).toISOString();

    const res = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026', classId: 'class-01', quizId,
        answers: [{ questionId: questions[0].id, selectedIndex: 1 }],
    }), ctx);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(parse(res).error.code, 'QUIZ_EXPIRED');
});

test('quiz-result exige quizId y answers', async () => {
    const res = await handlers['save-quiz-result'](req({ subjectId: 'arq-software-2026', classId: 'class-01', score: 90 }), ctx);

    assert.strictEqual(res.status, 400);
    assert.match(parse(res).error, /quizId/);
});

test('quiz-result cuenta el intento sobre el resultado previo', async () => {
    const primero = await emitirQuiz();
    await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026', classId: 'class-01', quizId: primero.quizId,
        answers: [{ questionId: primero.questions[0].id, selectedIndex: 1 }],
    }), ctx);
    const segundo = await emitirQuiz();
    const res = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026', classId: 'class-01', quizId: segundo.quizId,
        answers: [{ questionId: segundo.questions[0].id, selectedIndex: 0 }],
    }), ctx);

    assert.strictEqual(parse(res).attemptCount, 2);
});
