/**
 * quiz-api.js — Autoevaluación
 * POST /api/generate-quiz : genera 5-10 preguntas MCQ desde resumen + materiales de la clase
 * POST /api/quiz-result   : persiste el resultado de un intento por alumno/clase
 * GET  /api/quiz-result   : devuelve el último resultado del alumno para una clase
 */
import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { v4 as uuidv4 } from 'uuid';
import { chatCompletion, getChatModelName, resolveModelForTask } from '../services/ai.js';
import { loadJson } from '../services/storage.js';
import { getActivePrompt } from '../services/prompts.js';
import {
    getEnrollment, getConsentStatus, listMaterialsByClass,
    upsertQuizResult, getQuizResult
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

function jsonResponse(status, payload) {
    return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

async function buildQuizPrompt(subjectName, className, contextText, questionCount) {
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
    const userTemplate = promptConfig?.userPromptTemplate || 'Generá ${questionCount} preguntas de autoevaluación sobre la siguiente clase.\n\nMateria: ${subjectName}\nClase: ${className}\n\nCONTEXTO:\n${contextText}';
    const userContent = userTemplate
        .replace('${questionCount}', String(questionCount))
        .replace('${subjectName}', subjectName || '')
        .replace('${className}', className || '')
        .replace('${contextText}', contextText);
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

            const className = body.className || classId;
            const { systemContent, userContent } = await buildQuizPrompt(subjectName, className, contextText, count);

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
                model: quizModel,
                generatedAt: new Date().toISOString(),
                durationMs: Date.now() - startTime,
            };
            log.info('Quiz generated', { quizId: payload.quizId, questions: questions.length, durationMs: payload.durationMs });
            return jsonResponse(200, payload);
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

        const { subjectId, classId, quizId, score, totalQuestions, correctCount, passed, weakTopics, answers } = body || {};
        if (!subjectId || !classId || typeof score !== 'number') {
            return jsonResponse(400, { error: 'Faltan campos requeridos: subjectId, classId, score' });
        }

        const existing = await getQuizResult(subjectId, userId, classId).catch(() => null);
        const attemptCount = (existing?.attemptCount || 0) + 1;

        const saved = await upsertQuizResult({
            subjectId,
            userId,
            classId,
            quizId: quizId || '',
            score: Math.round(score),
            totalQuestions: Number(totalQuestions || 0),
            correctCount: Number(correctCount || 0),
            passed: passed === true || score >= PASS_THRESHOLD,
            weakTopics: Array.isArray(weakTopics) ? weakTopics.slice(0, 20) : [],
            answers: Array.isArray(answers) ? answers.slice(0, 50) : [],
            attemptCount,
        });

        log.info('Quiz result saved', { classId, score: saved.score, attemptCount: saved.attemptCount });
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
