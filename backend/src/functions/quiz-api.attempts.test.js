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

const quizStore = new Map();
const resultStore = new Map();
const attemptStore = []; // { subjectId, userId, classId, attemptNumber, answers, ... }

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active' })),
    // UJ-30: el alcance de unidad resuelve las clases publicadas desde acá.
    listClassesBySubject: mock.fn(async () => []),
    getConsentStatus: mock.fn(async () => true),
    listMaterialsByClass: mock.fn(async () => []),
    // El cuestionario emitido se guarda para corregir en el servidor: el cierre
    // ya no confía en el puntaje del cliente, lo deriva contra este registro.
    saveQuiz: mock.fn(async (quiz) => {
        quizStore.set(`${quiz.subjectId}:${quiz.quizId}`, quiz);
        return quiz;
    }),
    getQuiz: mock.fn(async (subjectId, quizId) => quizStore.get(`${subjectId}:${quizId}`) || null),
    upsertQuizResult: mock.fn(async (result) => {
        resultStore.set(`${result.subjectId}:${result.userId}__${result.classId}`, { ...result, updatedAt: new Date().toISOString() });
        return resultStore.get(`${result.subjectId}:${result.userId}__${result.classId}`);
    }),
    getQuizResult: mock.fn(async (subjectId, userId, classId) => resultStore.get(`${subjectId}:${userId}__${classId}`) || null),
    appendQuizAttempt: mock.fn(async (attempt) => { attemptStore.push(attempt); return attempt; }),
    listQuizAttempts: mock.fn(async (subjectId, userId, classId) => attemptStore
        .filter((a) => a.subjectId === subjectId && a.userId === userId && a.classId === classId)
        .sort((a, b) => a.attemptNumber - b.attemptNumber)),
    // UJ-30: quiz-api también marca temas flojos; el historial no los usa pero
    // el módulo los importa, así que la simulación tiene que ofrecerlos.
    upsertQuizWeakTopics: mock.fn(async (record) => ({ ...record, updatedAt: new Date().toISOString() })),
    getQuizWeakTopics: mock.fn(async () => null),
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
    quizStore.clear();
    resultStore.clear();
    attemptStore.length = 0;
    promptsVistos.length = 0;
});

async function emitir() {
    const res = await handlers['generate-quiz'](req({ subjectId: 'arq-software-2026', classId: 'class-01', questionCount: 5 }), ctx);
    return parse(res);
}
// El mock del modelo fija `correctIndex` por sufijo de la pregunta (…-A → 1,
// …-B → 0) y el servidor no lo manda al cliente: el test lo replica desde acá
// para poder elegir a propósito una opción correcta o una incorrecta.
function indiceCorrecto(question) {
    return question.endsWith('-A') ? 1 : 0;
}
// Cierra el intento del cuestionario que devolvió `generate-quiz`: el servidor
// exige que ese quizId exista, sea de esa persona y de esa clase, y corrige él
// mismo. El cliente sólo manda qué opción eligió — nunca el puntaje.
async function cerrar(quiz, correctas = []) {
    const res = await handlers['save-quiz-result'](req({
        subjectId: 'arq-software-2026',
        classId: 'class-01',
        quizId: quiz.quizId,
        answers: quiz.questions.map((q, i) => {
            const correcto = indiceCorrecto(q.question);
            return {
                questionId: q.id,
                selectedIndex: correctas.includes(i) ? correcto : (correcto + 1) % 4,
            };
        }),
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
    await cerrar(primero, [0]);

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
    await cerrar(primero, [0]);
    const segundo = await emitir();
    await cerrar(segundo, [0, 1]);

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
    const saved = await cerrar(quiz, []);

    assert.strictEqual(saved.attemptCount, 10);
    assert.strictEqual(attemptStore[0].attemptNumber, 10);
});

test('get-quiz-attempts devuelve el historial resumido por tema', async () => {
    const primero = await emitir();
    await cerrar(primero, [0]);
    const segundo = await emitir();
    await cerrar(segundo, [0, 1]);

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
    await cerrar(primero, [0]);
    currentUid = 'alu-005';

    const res = await handlers['get-quiz-attempts'](req(null, { subjectId: 'arq-software-2026', classId: 'class-01' }), ctx);

    assert.deepStrictEqual(parse(res).attempts, []);
});

test('el segundo conjunto reutiliza las etiquetas de tema del primero (misma vara)', async () => {
    const primero = await emitir();
    await cerrar(primero, [0]);

    await emitir();

    const prompt = promptsVistos[1];
    assert.match(prompt, /cada pregunta debe declarar su campo "topic"/, 'tiene que exigir etiquetas de tema estables');
    assert.ok(prompt.includes('Tema A'), 'el prompt tiene que listar las etiquetas del intento previo');
    assert.ok(prompt.includes('Tema B'), 'el prompt tiene que listar las etiquetas del intento previo');
    assert.match(prompt, /sin crear etiquetas nuevas/, 'tiene que prohibir etiquetas nuevas');
});

test('la primera práctica no impone etiquetas de tema', async () => {
    await emitir();

    assert.ok(!/cada pregunta debe declarar su campo "topic"/.test(promptsVistos[0]), 'sin intento previo no hay vara que sostener');
});
