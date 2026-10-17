/**
 * quiz-api.js — Autoevaluación
 * POST /api/generate-quiz : genera 5-10 preguntas MCQ desde resumen + materiales de la clase
 * POST /api/quiz-result   : persiste el resultado de un intento por alumno/clase
 * GET  /api/quiz-result   : devuelve el último resultado del alumno para una clase
 */
import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { v4 as uuidv4 } from 'uuid';
import { chatCompletion, getChatModelName, getModelDisplayName, resolveModelForTask } from '../services/ai.js';
import { loadJson } from '../services/storage.js';
import { getActivePrompt } from '../services/prompts.js';
import {
    getEnrollment, getConsentStatus, listMaterialsByClass,
    upsertQuizResult, getQuizResult, saveQuiz, getQuiz, appendQuizAttempt, listQuizAttempts
} from '../services/state-store.js';
import { parseClientPrincipal, validateFrontDoorId, getAuthenticatedUser } from '../services/auth-utils.js';
import { normalizeCategorizedError, ErrorCategory } from '../services/error-categories.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { withRateLimit } from '../middleware/with-rate-limit.js';
import { createStructuredLogger } from '../services/structured-logger.js';
import { CONFIG } from '../services/config.js';

const CONTAINER_SUMMARIES = 'class-summaries';
const CONTAINER_PROCESSED = 'processed';
const DEFAULT_QUESTION_COUNT = 5;
const MIN_QUESTION_COUNT = 5;
const MAX_QUESTION_COUNT = 10;
const PASS_THRESHOLD = 60;
// El cuestionario emitido se conserva para poder corregir el intento en el
// servidor. Pasada la ventana, el intento se rechaza con QUIZ_EXPIRED y la
// persona genera uno nuevo.
const QUIZ_TTL_MS = 24 * 60 * 60 * 1000;

function jsonResponse(status, payload) {
    return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    };
}

/**
 * El navegador nunca recibe `correctIndex` ni `explanation`: con ellas el
 * puntaje se calcula (y se puede forjar) del lado del cliente.
 */
function toClientQuestions(questions) {
    return questions.map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options,
        topic: q.topic,
    }));
}

/**
 * Corrige un intento contra el cuestionario guardado en el servidor.
 * Sólo se aceptan `questionId` + `selectedIndex` del cliente: el puntaje, los
 * aciertos y los temas flojos los deriva el servidor.
 */
function gradeAttempt(quiz, submittedAnswers) {
    const byId = new Map();
    for (const a of Array.isArray(submittedAnswers) ? submittedAnswers : []) {
        if (a && typeof a.questionId === 'string') byId.set(a.questionId, a);
    }
    const weakTopicSet = new Set();
    let correctCount = 0;
    const answers = quiz.questions.map((q) => {
        const submitted = byId.get(q.id);
        const raw = submitted?.selectedIndex;
        const selectedIndex = Number.isInteger(raw) && raw >= 0 && raw < q.options.length ? raw : null;
        const isCorrect = selectedIndex !== null && selectedIndex === q.correctIndex;
        if (isCorrect) correctCount += 1;
        else if (q.topic) weakTopicSet.add(q.topic);
        return {
            questionId: q.id,
            question: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
            selectedIndex,
            isCorrect,
            explanation: q.explanation || '',
            topic: q.topic || '',
        };
    });
    const totalQuestions = quiz.questions.length;
    const score = totalQuestions ? Math.round((correctCount / totalQuestions) * 100) : 0;
    return {
        answers,
        correctCount,
        totalQuestions,
        score,
        passed: score >= PASS_THRESHOLD,
        weakTopics: Array.from(weakTopicSet),
    };
}

function normalizeQuestionCount(raw) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)) return DEFAULT_QUESTION_COUNT;
    return Math.max(MIN_QUESTION_COUNT, Math.min(MAX_QUESTION_COUNT, parsed));
}

function sanitizeText(text, maxLen) {
    return String(text || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').trim().substring(0, maxLen);
}

function extractQuizJson(content) {
    if (!content) return null;
    let text = String(content).trim();
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) text = fenceMatch[1].trim();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
        return JSON.parse(text.substring(start, end + 1));
    } catch {
        return null;
    }
}

function normalizeQuestions(rawList) {
    const list = Array.isArray(rawList) ? rawList : [];
    const questions = [];
    for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const question = sanitizeText(raw.question, 400);
        const options = Array.isArray(raw.options)
            ? raw.options.map((o) => sanitizeText(o, 300)).filter(Boolean)
            : [];
        if (!question || options.length < 2) continue;
        let correctIndex = Number.isInteger(raw.correctIndex) ? raw.correctIndex : options.indexOf(raw.correctAnswer);
        if (correctIndex < 0 || correctIndex >= options.length) correctIndex = 0;
        questions.push({
            id: uuidv4(),
            question,
            options,
            correctIndex,
            explanation: sanitizeText(raw.explanation, 500),
            topic: sanitizeText(raw.topic || raw.topicLabel, 200),
        });
    }
    return questions;
}

async function loadClassContext(subjectId, classId, context) {
    const parts = [];

    const summaryData = await loadJson(CONTAINER_SUMMARIES, `${classId}.json`).catch(() => null);
    const summaryText = typeof summaryData === 'string'
        ? summaryData
        : (summaryData?.summary?.content || summaryData?.summary || '');
    if (summaryText) {
        parts.push(`[RESUMEN DE LA CLASE]\n${sanitizeText(summaryText, 8000)}`);
    }

    const materials = await listMaterialsByClass(subjectId, classId);
    const textMaterials = materials.filter((m) => ['transcript', 'presentation', 'notes', 'bibliography'].includes(m.type));
    let loadedTexts = 0;
    for (const mat of textMaterials) {
        const processed = await loadJson(CONTAINER_PROCESSED, `${mat.materialId}.json`).catch(() => null);
        const t = processed?.extractedText || processed?.text || '';
        if (t) {
            parts.push(`[${mat.type.toUpperCase()} — ${mat.filename}]\n${sanitizeText(t, 4000)}`);
            loadedTexts++;
        }
    }
    context.log(`[Quiz] Context loaded: summary=${summaryText ? 'yes' : 'no'}, materials=${loadedTexts}/${textMaterials.length}`);
    return parts.join('\n\n');
}

const MAX_EXCLUDED_QUESTIONS = 60;

/**
 * Reúne las preguntas ya vistas por esa persona en esa clase para pedirle al
 * modelo que no las repita (UJ-31, paso 2) y resume el resultado por tema para
 * que el frontend pueda comparar intentos (paso 7).
 */
function previousQuestionsOf(attempts) {
    const seen = new Set();
    for (const attempt of attempts) {
        for (const answer of attempt.answers || []) {
            const text = sanitizeText(answer?.question, 400);
            if (text) seen.add(text);
            if (seen.size >= MAX_EXCLUDED_QUESTIONS) return Array.from(seen);
        }
    }
    return Array.from(seen);
}

function topicsSummaryOf(attempt) {
    const topics = {};
    for (const answer of attempt.answers || []) {
        const topic = sanitizeText(answer?.topic || '', 200) || 'Sin tema';
        if (!topics[topic]) topics[topic] = { asked: 0, correct: 0 };
        topics[topic].asked += 1;
        if (answer?.isCorrect === true) topics[topic].correct += 1;
    }
    return topics;
}

const MAX_STABLE_TOPICS = 30;

/**
 * Etiquetas de tema ya usadas en los intentos previos de esa persona en esa clase.
 * La comparación tema por tema (UJ-31, paso 7) sólo se apoya en la misma vara si
 * el conjunto nuevo declara los mismos temas que el anterior; por eso se le pasan
 * al modelo para que las reutilice tal cual en vez de inventar etiquetas nuevas.
 */
function previousTopicsOf(attempts) {
    const seen = [];
    for (const attempt of attempts) {
        for (const topic of Object.keys(topicsSummaryOf(attempt))) {
            if (topic && topic !== 'Sin tema' && !seen.includes(topic)) seen.push(topic);
            if (seen.length >= MAX_STABLE_TOPICS) return seen;
        }
    }
    return seen;
}

async function buildQuizPrompt(subjectName, className, contextText, questionCount, previousQuestions = [], previousTopics = []) {
    const promptConfig = await getActivePrompt('quiz').catch(() => null);
    const systemContent = promptConfig?.systemPrompt || `Sos un docente experto en crear cuestionarios de autoevaluación para estudiantes universitarios.
Generás exactamente ${questionCount} preguntas de opción múltiple (4 opciones cada una) sobre el material de clase provisto.
Cada pregunta debe verificar comprensión real del contenido, no datos triviales.

Requerimientos del JSON de salida:
- Devolvé EXCLUSIVAMENTE un array JSON válido, sin texto adicional, sin marcas de código.
- Cada elemento tiene la forma:
  { "question": "texto de la pregunta", "options": ["opción A", "opción B", "opción C", "opción D"], "correctIndex": <índice de la opción correcta (0-3)>, "explanation": "explicación breve de por qué es correcta", "topic": "tema o concepto que evalúa" }
- Deben ser ${questionCount} preguntas exactas.
- Sin preguntas repetidas ni demasiado parecidas entre sí.`;
    let userContent = (promptConfig?.userPromptTemplate || 'Generá ${questionCount} preguntas de autoevaluación sobre la siguiente clase.\n\nMateria: ${subjectName}\nClase: ${className}\n\nCONTEXTO:\n${contextText}')
        .replace('${questionCount}', String(questionCount))
        .replace('${subjectName}', subjectName || '')
        .replace('${className}', className || '')
        .replace('${contextText}', contextText);
    // UJ-31: la persona ya hizo la práctica y vuelve a ponerse a prueba. El nuevo
    // conjunto tiene que cubrir la misma clase pero sin repetir lo ya visto.
    if (previousQuestions.length) {
        userContent += `\n\nLa persona ya respondió una práctica de esta clase. NO repitas ninguna de estas preguntas, ni las reformules para evaluar el mismo punto:\n`
            + previousQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
            + `\nCubrí los mismos temas de la clase, pero con preguntas nuevas sobre otros puntos del material, de dificultad equivalente.`;
    }
    // UJ-31, paso 7: la comparación tema por tema sólo se apoya en la misma vara si
    // el conjunto nuevo declara los mismos temas que el anterior. Sin esta consigna
    // el modelo inventa etiquetas nuevas en cada intento y todos los veredictos
    // quedan en «tema nuevo» / «no se evaluó».
    if (previousTopics.length) {
        userContent += `\n\nPara que el resultado se pueda comparar tema por tema con la práctica anterior, cada pregunta debe declarar su campo "topic" usando EXACTAMENTE una de estas etiquetas, tal cual está escrita (sin variantes, sin sinónimos y sin crear etiquetas nuevas):\n`
            + previousTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')
            + `\nRepartí las ${questionCount} preguntas entre esos temas, priorizando los que mejor representan el material de la clase.`;
    }
    return { systemContent, userContent };
}

app.http('generate-quiz', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'generate-quiz',
    handler: withCorrelation(withAuth(withRateLimit(async (request, context) => {
        const log = createStructuredLogger('generate-quiz', context);
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
        const { userId, sanitizedId } = getAuthenticatedUser(request);
        log.info('generate-quiz triggered', { correlationId: context.correlationId, userId });

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse(400, { error: 'Body JSON inválido' });
        }

        const { subjectId, classId, questionCount, subjectName } = body || {};
        if (!subjectId || !classId) {
            return jsonResponse(400, { error: 'Faltan campos requeridos: subjectId, classId' });
        }
        const count = normalizeQuestionCount(questionCount);

        const principal = parseClientPrincipal(request);
        const isTeacherOrDirector = principal?.userRoles?.some((r) => ['Docente', 'Director'].includes(r));

        const enrollment = await getEnrollment(subjectId, userId).catch(() => null);
        if (!isTeacherOrDirector && principal) {
            if (!enrollment || enrollment.status !== 'active') {
                return jsonResponse(403, { error: 'ENROLLMENT_REQUIRED', message: 'No estás matriculado en esta materia.' });
            }
            const consentAccepted = await getConsentStatus(userId).catch(() => false);
            if (!consentAccepted) {
                return jsonResponse(403, {
                    success: false,
                    error: { code: 'CONSENT_REQUIRED', message: 'Debés aceptar los términos de uso antes de generar un cuestionario.', errorCategory: 'AUTH' },
                });
            }
        }

        const startTime = Date.now();
        try {
            const contextText = await loadClassContext(subjectId, classId, context);
            if (!contextText) {
                return jsonResponse(400, { error: 'No hay resumen ni materiales procesados disponibles para esta clase.' });
            }

            // Intentos previos de esta persona en esta clase: el nuevo conjunto no
            // repite lo ya visto (UJ-31) y la pantalla puede anunciar el número.
            const previousAttempts = await listQuizAttempts(subjectId, userId, classId).catch(() => []);
            const previousQuestions = previousQuestionsOf(previousAttempts);
            const previousTopics = previousTopicsOf(previousAttempts);
            const attemptNumber = previousAttempts.length + 1;

            const className = body.className || classId;
            const { systemContent, userContent } = await buildQuizPrompt(subjectName, className, contextText, count, previousQuestions, previousTopics);

            const quizModel = await resolveModelForTask('quiz');
            const result = await chatCompletion(
                [
                    { role: 'system', content: systemContent },
                    { role: 'user', content: userContent },
                ],
                false,
                {
                    model: quizModel,
                    temperature: CONFIG.ai.temperature.quiz,
                    max_tokens: CONFIG.ai.maxTokens.quiz,
                    headers: context?.dependencyHeaders,
                }
            );

            const rawQuestions = extractQuizJson(result?.content);
            const questions = normalizeQuestions(rawQuestions);
            if (questions.length === 0) {
                log.warn('Quiz generation returned unparseable output', { length: result?.content?.length, subjectId, classId });
                return jsonResponse(502, { error: 'No se pudo generar un cuestionario válido. Intentá de nuevo.' });
            }

            const payload = {
                quizId: uuidv4(),
                subjectId,
                classId,
                questionCount: questions.length,
                questions,
                model: getModelDisplayName(quizModel),
                generatedAt: new Date().toISOString(),
                durationMs: Date.now() - startTime,
                attemptNumber,
                excludedQuestionCount: previousQuestions.length,
            };
            // El cuestionario con sus respuestas correctas queda sólo en el
            // servidor: el intento se corrige contra este registro.
            await saveQuiz({
                subjectId,
                quizId: payload.quizId,
                userId,
                classId,
                questions,
                createdAt: payload.generatedAt,
                expiresAt: new Date(Date.now() + QUIZ_TTL_MS).toISOString(),
            });
            log.info('Quiz generated', { quizId: payload.quizId, questions: questions.length, durationMs: payload.durationMs });
            return jsonResponse(200, { ...payload, questions: toClientQuestions(questions) });
        } catch (err) {
            const categorized = normalizeCategorizedError(err, ErrorCategory.LLM);
            context.error('[Quiz] Error generating quiz:', categorized);
            return jsonResponse(categorized.status, {
                error: `Error generando cuestionario: ${categorized.message}`,
                errorCategory: categorized.errorCategory,
            });
        }
    }, 'chat'))),
});

app.http('save-quiz-result', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'quiz-result',
    handler: withCorrelation(withAuth(withRateLimit(async (request, context) => {
        const log = createStructuredLogger('save-quiz-result', context);
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
        const { userId, sanitizedId } = getAuthenticatedUser(request);
        log.info('save-quiz-result triggered', { correlationId: context.correlationId, userId });

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse(400, { error: 'Body JSON inválido' });
        }

        const { subjectId, classId, quizId, answers } = body || {};
        if (!subjectId || !classId || !quizId || !Array.isArray(answers)) {
            return jsonResponse(400, { error: 'Faltan campos requeridos: subjectId, classId, quizId, answers' });
        }

        // La corrección vive en el servidor: el cliente sólo envía qué opción
        // eligió en cada pregunta. `score`, `correctCount` y `passed` que
        // llegaran en el cuerpo se ignoran a propósito.
        const quiz = await getQuiz(subjectId, quizId).catch(() => null);
        if (!quiz) {
            return jsonResponse(404, {
                error: { code: 'QUIZ_NOT_FOUND', message: 'No encontramos esa práctica. Generá una nueva.' },
                errorCategory: 'NOT_FOUND',
            });
        }
        if (quiz.userId !== userId) {
            return jsonResponse(403, {
                error: { code: 'QUIZ_NOT_OWNED', message: 'Esta práctica pertenece a otra persona.' },
                errorCategory: 'AUTH',
            });
        }
        if (quiz.classId !== classId) {
            return jsonResponse(409, {
                error: { code: 'QUIZ_CLASS_MISMATCH', message: 'La práctica corresponde a otra clase.' },
                errorCategory: 'CONFLICT',
            });
        }
        if (quiz.expiresAt && Date.parse(quiz.expiresAt) < Date.now()) {
            return jsonResponse(409, {
                error: { code: 'QUIZ_EXPIRED', message: 'La práctica venció. Generá una nueva para volver a intentarlo.' },
                errorCategory: 'CONFLICT',
            });
        }

        const graded = gradeAttempt(quiz, answers);

        const existing = await getQuizResult(subjectId, userId, classId).catch(() => null);
        const previousAttempts = await listQuizAttempts(subjectId, userId, classId).catch(() => []);
        const attemptCount = Math.max(existing?.attemptCount || 0, previousAttempts.length) + 1;

        const saved = await upsertQuizResult({
            subjectId,
            userId,
            classId,
            quizId,
            score: graded.score,
            totalQuestions: graded.totalQuestions,
            correctCount: graded.correctCount,
            passed: graded.passed,
            weakTopics: graded.weakTopics,
            answers: graded.answers,
            attemptCount,
        });

        // El resultado vigente se reemplaza, pero cada intento queda como registro
        // propio: sin eso no se puede comparar ni saber qué preguntas ya se vieron.
        await appendQuizAttempt({
            subjectId,
            userId,
            classId,
            quizId: quizId || '',
            attemptNumber: attemptCount,
            score: saved.score,
            totalQuestions: saved.totalQuestions,
            correctCount: saved.correctCount,
            passed: saved.passed,
            weakTopics: saved.weakTopics,
            answers: saved.answers,
            createdAt: saved.updatedAt,
        }).catch((err) => {
            log.warn('Quiz attempt history not persisted', { classId, attemptCount, message: err?.message });
        });

        log.info('Quiz result saved', { classId, quizId, score: saved.score, attemptCount: saved.attemptCount });
        return jsonResponse(200, saved);
    }, 'general'))),
});

app.http('get-quiz-result', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'quiz-result',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
        const { userId, sanitizedId } = getAuthenticatedUser(request);
        const subjectId = request.query.get('subjectId');
        const classId = request.query.get('classId');
        if (!subjectId || !classId) {
            return jsonResponse(400, { error: 'Parámetros requeridos: subjectId, classId' });
        }
        const result = await getQuizResult(subjectId, userId, classId).catch(() => null);
        return jsonResponse(200, { result });
    })),
});

app.http('get-quiz-attempts', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'quiz-attempts',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
        const { userId } = getAuthenticatedUser(request);
        const subjectId = request.query.get('subjectId');
        const classId = request.query.get('classId');
        if (!subjectId || !classId) {
            return jsonResponse(400, { error: 'Parámetros requeridos: subjectId, classId' });
        }
        // Historial de intentos de esa persona en esa clase, resumido por tema:
        // es lo que permite comparar en qué avanzó y en qué no (UJ-31, paso 7).
        const attempts = await listQuizAttempts(subjectId, userId, classId).catch(() => []);
        return jsonResponse(200, {
            attempts: attempts.map((a) => ({
                attemptNumber: a.attemptNumber,
                quizId: a.quizId,
                score: a.score,
                correctCount: a.correctCount,
                totalQuestions: a.totalQuestions,
                passed: a.passed,
                weakTopics: a.weakTopics,
                topics: topicsSummaryOf(a),
                createdAt: a.createdAt,
            })),
        });
    })),
});
