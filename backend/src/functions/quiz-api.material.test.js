import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert';

// UJ-30 (pasos 6, 7 y 8): el resultado de la práctica tiene que llevar al material
// que respalda cada fallo y permitir que la persona marque sus temas flojos.
// Antes el cuestionario no traía de dónde salió cada pregunta (cero enlaces en el
// resultado) y los temas flojos eran una deducción del servidor, no una marca de
// la persona, y se perdían al cerrar la pestaña.

let currentUid = 'alu-003';
const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => null),
    getAuthenticatedUser: mock.fn(() => ({ userId: currentUid, sanitizedId: currentUid })),
};

const quizStore = new Map();
const resultStore = new Map();
const attemptStore = [];
const weakTopicStore = new Map();

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active' })),
    getConsentStatus: mock.fn(async () => true),
    // La clase tiene un encuentro transcrito: es el material que respalda.
    listMaterialsByClass: mock.fn(async () => [
        { materialId: 'm-1', type: 'transcript', filename: 'clase1.vtt' },
    ]),
    saveQuiz: mock.fn(async (quiz) => { quizStore.set(`${quiz.subjectId}:${quiz.quizId}`, quiz); return quiz; }),
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
};

const promptsVistos = [];
const aiMocks = {
    chatCompletion: mock.fn(async (messages) => {
        promptsVistos.push({ system: messages[0].content, user: messages[messages.length - 1].content });
        return { content: JSON.stringify([
            { question: 'P1', options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'e1', topic: 'Tema A', source: 'Transcripción del encuentro — clase1.vtt' },
            { question: 'P2', options: ['a', 'b', 'c', 'd'], correctIndex: 2, explanation: 'e2', topic: 'Tema B', source: 'Resumen de la clase (síntesis)' },
            { question: 'P3', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'e3', topic: 'Tema C', source: 'Material inventado que no existe' },
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
mock.module('../services/storage.js', {
    namedExports: {
        loadJson: mock.fn(async (container) => {
            if (container === 'class-summaries') return { summary: { content: 'resumen de la clase' } };
            if (container === 'processed') return { extractedText: 'texto del encuentro transcrito' };
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
    quizStore.clear();
    resultStore.clear();
    attemptStore.length = 0;
    weakTopicStore.clear();
    promptsVistos.length = 0;
});

async function emitirQuiz() {
    const res = await handlers['generate-quiz'](req({ subjectId: 'arq-software-2026', classId: 'class-01', questionCount: 5 }), ctx);
    return parse(res);
}

test('generate-quiz pide al modelo citar el bloque de respaldo de cada pregunta', async () => {
    await emitirQuiz();

    const { system } = promptsVistos[0];
    assert.match(system, /"source"/, 'la consigna tiene que pedir el campo source');
    assert.match(system, /Transcripción del encuentro — clase1\.vtt/, 'tiene que listar el rótulo del encuentro');
    assert.match(system, /Resumen de la clase \(síntesis\)/, 'tiene que listar el rótulo de la síntesis');
});

test('el respaldo citado por el modelo queda guardado con la pregunta', async () => {
    const body = await emitirQuiz();
    const guardado = quizStore.get(`arq-software-2026:${body.quizId}`);

    assert.strictEqual(guardado.questions[0].source, 'Transcripción del encuentro — clase1.vtt');
    assert.strictEqual(guardado.questions[1].source, 'Resumen de la clase (síntesis)');
});

test('una cita inventada no se guarda como respaldo', async () => {
    const body = await emitirQuiz();
    const guardado = quizStore.get(`arq-software-2026:${body.quizId}`);

    assert.strictEqual(guardado.questions[2].source, '', 'un material que no existe no puede figurar como respaldo');
});

test('quiz-result entrega por fallo la parte del material que lo respalda', async () => {
    const { quizId, questions } = await emitirQuiz();

    const res = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026',
        classId: 'class-01',
        quizId,
        // Todo mal a propósito: los tres quedan como fallos.
        answers: questions.map((q) => ({ questionId: q.id, selectedIndex: null })),
    }), ctx);

    const body = parse(res);
    assert.strictEqual(body.answers[0].isCorrect, false);
    assert.strictEqual(body.answers[0].source, 'Transcripción del encuentro — clase1.vtt');
    assert.strictEqual(body.answers[1].source, 'Resumen de la clase (síntesis)');
    assert.strictEqual(body.answers[2].source, '');
});

test('save-quiz-weak-topics guarda la marca por persona y unidad', async () => {
    const res = await handlers['save-quiz-weak-topics'](req({
        subjectId: 'arq-software-2026', classId: 'class-01', topics: ['Tema A', 'Tema C'],
    }), ctx);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(parse(res).topics, ['Tema A', 'Tema C']);

    const get = await handlers['get-quiz-weak-topics'](req(null, { subjectId: 'arq-software-2026', classId: 'class-01' }), ctx);
    assert.deepStrictEqual(parse(get).topics, ['Tema A', 'Tema C']);
});

test('la marca de temas flojos no se filtra a otra persona', async () => {
    await handlers['save-quiz-weak-topics'](req({
        subjectId: 'arq-software-2026', classId: 'class-01', topics: ['Tema A'],
    }), ctx);

    currentUid = 'alu-004';
    const get = await handlers['get-quiz-weak-topics'](req(null, { subjectId: 'arq-software-2026', classId: 'class-01' }), ctx);
    assert.deepStrictEqual(parse(get).topics, []);
});

test('save-quiz-weak-topics normaliza: deduplica, descarta vacíos y exige campos', async () => {
    const res = await handlers['save-quiz-weak-topics'](req({
        subjectId: 'arq-software-2026', classId: 'class-01', topics: ['Tema A', 'Tema A', '   ', '', 'Tema B'],
    }), ctx);
    assert.deepStrictEqual(parse(res).topics, ['Tema A', 'Tema B']);

    const bad = await handlers['save-quiz-weak-topics'](req({ subjectId: 'arq-software-2026', classId: 'class-01' }), ctx);
    assert.strictEqual(bad.status, 400);
    assert.match(parse(bad).error, /topics/);
});

test('get-quiz-weak-topics exige subjectId y classId', async () => {
    const res = await handlers['get-quiz-weak-topics'](req(null, { subjectId: 'arq-software-2026' }), ctx);
    assert.strictEqual(res.status, 400);
    assert.match(parse(res).error, /classId/);
});
