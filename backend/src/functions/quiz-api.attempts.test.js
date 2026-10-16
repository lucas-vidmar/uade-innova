import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert';

// UJ-31: repetir la práctica tiene que dar preguntas que la persona no vio, dejar
// constancia de cada intento y permitir compararlos. Antes el cuestionario se
// generaba sin saber nada de los intentos previos y cada cierre reemplazaba el
// anterior, así que la única forma de "comparar" era el recuerdo del puntaje.

let currentUid = 'alu-001';
const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => null),
    getAuthenticatedUser: mock.fn(() => ({ userId: currentUid, sanitizedId: currentUid })),
};

const resultStore = new Map();
const attemptStore = []; // { subjectId, userId, classId, attemptNumber, answers, ... }

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active' })),
    getConsentStatus: mock.fn(async () => true),
    listMaterialsByClass: mock.fn(async () => []),
    upsertQuizResult: mock.fn(async (result) => {
        resultStore.set(`${result.subjectId}:${result.userId}__${result.classId}`, { ...result, updatedAt: new Date().toISOString() });
        return resultStore.get(`${result.subjectId}:${result.userId}__${result.classId}`);
    }),
    getQuizResult: mock.fn(async (subjectId, userId, classId) => resultStore.get(`${subjectId}:${userId}__${classId}`) || null),
    appendQuizAttempt: mock.fn(async (attempt) => { attemptStore.push(attempt); return attempt; }),
    listQuizAttempts: mock.fn(async (subjectId, userId, classId) => attemptStore
        .filter((a) => a.subjectId === subjectId && a.userId === userId && a.classId === classId)
        .sort((a, b) => a.attemptNumber - b.attemptNumber)),
};

const promptsVistos = [];
const aiMocks = {
    chatCompletion: mock.fn(async (messages) => {
        promptsVistos.push(messages[messages.length - 1].content);
        const n = promptsVistos.length;
        return { content: JSON.stringify([
            { question: `Pregunta ${n}-A`, options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'e', topic: 'Tema A' },
            { question: `Pregunta ${n}-B`, options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'e', topic: 'Tema B' },
        ]) };
    }),
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

const req = (body = null, query = {}) => ({
    method: body ? 'POST' : 'GET',
    query: { get: (k) => query[k] ?? null },
    headers: { get: () => null },
    json: async () => body,
});
const ctx = { log: () => {}, error: () => {}, warn: () => {} };
const parse = (res) => JSON.parse(res.body);

beforeEach(() => {
    currentUid = 'alu-001';
    resultStore.clear();
    attemptStore.length = 0;
    promptsVistos.length = 0;
});

async function emitir() {
    const res = await handlers['generate-quiz'](req({ subjectId: 'arq-software-2026', classId: 'class-01', questionCount: 5 }), ctx);
    return parse(res);
}
async function cerrar(questions, correctas = []) {
    const res = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026',
        classId: 'class-01',
        quizId: 'quiz-1',
        score: 100,
        totalQuestions: questions.length,
        correctCount: questions.length,
        passed: true,
        weakTopics: [],
        answers: questions.map((q, i) => ({
            questionId: q.id, question: q.question, options: q.options,
            correctIndex: q.correctIndex, selectedIndex: correctas.includes(i) ? q.correctIndex : (q.correctIndex + 1) % 4,
            isCorrect: correctas.includes(i), explanation: q.explanation, topic: q.topic,
        })),
    }), ctx);
    return parse(res);
}

test('la primera práctica no lleva exclusiones y se anuncia como intento 1', async () => {
    const quiz = await emitir();

    assert.strictEqual(quiz.attemptNumber, 1);
    assert.strictEqual(quiz.excludedQuestionCount, 0);
    assert.ok(!/NO repitas/.test(promptsVistos[0]), 'sin intentos previos no hay nada que excluir');
});

test('el segundo conjunto excluye las preguntas ya vistas y mantiene la cobertura', async () => {
    const primero = await emitir();
    await cerrar(primero.questions, [0]);

    const segundo = await emitir();

    assert.strictEqual(segundo.attemptNumber, 2);
    assert.strictEqual(segundo.excludedQuestionCount, 2);
    const prompt = promptsVistos[1];
    assert.match(prompt, /NO repitas ninguna de estas preguntas/);
    for (const q of primero.questions) {
        assert.ok(prompt.includes(q.question), `el prompt tiene que excluir «${q.question}»`);
    }
    assert.match(prompt, /Cubrí los mismos temas de la clase/, 'tiene que pedir la misma cobertura');
});

test('cada cierre queda como intento propio, sin pisar el anterior', async () => {
    const primero = await emitir();
    await cerrar(primero.questions, [0]);
    const segundo = await emitir();
    await cerrar(segundo.questions, [0, 1]);

    assert.strictEqual(attemptStore.length, 2);
    assert.strictEqual(attemptStore[0].attemptNumber, 1);
    assert.strictEqual(attemptStore[1].attemptNumber, 2);
    assert.strictEqual(attemptStore[1].correctCount, 2);
    assert.notDeepStrictEqual(
        attemptStore[0].answers.map((a) => a.question),
        attemptStore[1].answers.map((a) => a.question),
        'los dos intentos conservan sus propias preguntas',
    );
});

test('el resultado vigente sigue contando los intentos aunque falte el historial', async () => {
    // Datos anteriores al cambio: hay QuizResults con attemptCount pero sin filas de intento.
    resultStore.set('arq-software-2026:alu-001__class-01', { subjectId: 'arq-software-2026', userId: 'alu-001', classId: 'class-01', attemptCount: 9, score: 0 });
    const quiz = await emitir();
    const saved = await cerrar(quiz.questions, []);

    assert.strictEqual(saved.attemptCount, 10);
    assert.strictEqual(attemptStore[0].attemptNumber, 10);
});

test('get-quiz-attempts devuelve el historial resumido por tema', async () => {
    const primero = await emitir();
    await cerrar(primero.questions, [0]);
    const segundo = await emitir();
    await cerrar(segundo.questions, [0, 1]);

    const res = await handlers['get-quiz-attempts'](req(null, { subjectId: 'arq-software-2026', classId: 'class-01' }), ctx);
    const body = parse(res);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.attempts.length, 2);
    assert.deepStrictEqual(body.attempts.map((a) => a.attemptNumber), [1, 2]);
    assert.strictEqual(body.attempts[0].topics['Tema A'].asked, 1);
    assert.strictEqual(body.attempts[0].topics['Tema A'].correct, 1);
    assert.strictEqual(body.attempts[0].topics['Tema B'].correct, 0, 'el primer intento falló el tema B');
    assert.strictEqual(body.attempts[1].topics['Tema B'].correct, 1, 'el segundo lo acertó: la comparación tiene base');
});

test('get-quiz-attempts no mezcla el historial de otra persona', async () => {
    const primero = await emitir();
    await cerrar(primero.questions, [0]);
    currentUid = 'alu-005';

    const res = await handlers['get-quiz-attempts'](req(null, { subjectId: 'arq-software-2026', classId: 'class-01' }), ctx);

    assert.deepStrictEqual(parse(res).attempts, []);
});
