/**
 * quiz-api.js — Autoevaluación
 * GET  /api/quiz-scope    : anuncia el alcance (temas y materiales) de la práctica de la unidad
 * POST /api/generate-quiz : genera 5-10 preguntas MCQ desde resumen + materiales de la clase
 *                           o de la unidad (alcance completo o subconjunto de sus clases)
 * POST /api/quiz-result   : persiste el resultado de un intento por alumno/clase
 * GET  /api/quiz-result   : devuelve el último resultado del alumno para una clase
 *
 * UJ-30 (pasos 1 y 2): la práctica es de la UNIDAD. El pedido lleva un alcance
 * (`scope: 'class'` —lo de siempre— o `scope: 'unit'`), el sistema anuncia los
 * temas que abarca antes de empezar y permite acotarlos a un subconjunto de las
 * clases publicadas. La práctica por clase sigue funcionando igual.
 */
import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { v4 as uuidv4 } from 'uuid';
import { chatCompletion, getChatModelName, getModelDisplayName, resolveModelForTask } from '../services/ai.js';
import { loadJson } from '../services/storage.js';
import { getActivePrompt } from '../services/prompts.js';
import {
    getEnrollment, getConsentStatus, listMaterialsByClass, listClassesBySubject,
    upsertQuizResult, getQuizResult, saveQuiz, getQuiz, appendQuizAttempt, listQuizAttempts,
    upsertQuizWeakTopics, getQuizWeakTopics,
    // #445 (UJ-32): práctica compartida del grupo. La individual no toca ninguna
    // de estas funciones; son tablas y operaciones propias.
    getEnrollmentsBySubject, saveGroupQuiz, getGroupQuiz, findOpenGroupQuiz,
    upsertGroupQuizResponse, getGroupQuizResponse, listGroupQuizResponses,
    upsertGroupQuizRecord, getGroupQuizRecord
} from '../services/state-store.js';
import { isPublished, resolveClassPublicationState } from '../services/publication-state.js';
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
// UJ-30 (pasos 1 y 2): el alcance del cuestionario. `class` es la práctica de
// siempre (una clase); `unit` reúne los temas de todas las clases publicadas de
// la unidad o el subconjunto que la persona elija antes de empezar.
const SCOPE_CLASS = 'class';
const SCOPE_UNIT = 'unit';
// Clave de persistencia del intento de unidad: no es una clase, así que el
// resultado y el historial de la práctica de la unidad no se mezclan con los de
// ninguna clase (que siguen guardándose con su propio classId).
const UNIT_SCOPE_KEY = '__unit__';
const MAX_UNIT_CLASSES = 20;
const MAX_REQUESTED_TOPICS = 20;
// Presupuesto de contexto de la unidad. Sin tope, seis clases con resumen y
// materiales desbordan la ventana del modelo y encarecen cada generación.
const UNIT_CONTEXT_BUDGET = 24000;
const UNIT_SUMMARY_SHARE = 0.4;
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
            // UJ-30 (paso 6): la parte del material de la que salió la pregunta
            // viaja con el fallo para que el resultado pueda enlazarla. Es un
            // rótulo del bloque de contexto, no la respuesta correcta. Con
            // alcance de unidad viaja también la clase del bloque, para que el
            // repaso vuelva al encuentro del tema que falló.
            source: q.source || '',
            classId: q.classId || '',
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

// ─── Alcance de la práctica (UJ-30, pasos 1 y 2) ────────────────────
// El alcance se declara en el pedido, no se deduce: `class` es la práctica de
// una clase (contrato heredado) y `unit` la de la unidad completa o el
// subconjunto de clases que la persona eligió. Cualquier valor desconocido cae
// en `class` para no cambiar el comportamiento de quien no manda alcance.

function normalizeScope(raw) {
    return String(raw || '').trim().toLowerCase() === SCOPE_UNIT ? SCOPE_UNIT : SCOPE_CLASS;
}

function normalizeClassIdList(raw) {
    if (!Array.isArray(raw)) return [];
    const ids = [];
    for (const value of raw) {
        const id = sanitizeText(value, 120);
        if (id && !ids.includes(id)) ids.push(id);
        if (ids.length >= MAX_UNIT_CLASSES) break;
    }
    return ids;
}

/**
 * Temas que la persona marcó como flojos en la práctica de cada clase. Es la
 * única fuente honesta de «los temas que más le preocupan»: no se inventan ni se
 * deducen del material, los declaró ella misma (UJ-30, paso 7).
 */
function normalizeTopicList(raw) {
    if (!Array.isArray(raw)) return [];
    const topics = [];
    for (const value of raw) {
        const topic = sanitizeText(value, 120);
        if (topic && !topics.includes(topic)) topics.push(topic);
        if (topics.length >= MAX_REQUESTED_TOPICS) break;
    }
    return topics;
}

const TEXTUAL_MATERIAL_TYPES = ['transcript', 'presentation', 'notes', 'bibliography'];

function isTextualMaterial(material) {
    return Boolean(material) && TEXTUAL_MATERIAL_TYPES.includes(material.type);
}

function publishedClassesOf(classes) {
    return (Array.isArray(classes) ? classes : [])
        .filter((c) => c && c.id && isPublished(resolveClassPublicationState(c)))
        .slice(0, MAX_UNIT_CLASSES);
}

function classLabelOf(classInfo) {
    return sanitizeText(classInfo?.title, 160) || sanitizeText(classInfo?.id, 120);
}

/**
 * Los temas de una clase son los que la cátedra declaró. Cuando la clase no
 * declara ninguno, el tema es la clase misma (su título): el anuncio se queda
 * con lo que hay, sin inventar etiquetas.
 */
function classTopicsOf(classInfo) {
    const declared = Array.isArray(classInfo?.topics)
        ? classInfo.topics.map((t) => sanitizeText(t, 120)).filter(Boolean)
        : [];
    if (declared.length) return { topics: declared, declared: true };
    const fallback = classLabelOf(classInfo);
    return { topics: fallback ? [fallback] : [], declared: false };
}

function scopeKeyOf(scope, classId) {
    return scope === SCOPE_UNIT ? UNIT_SCOPE_KEY : classId;
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

function normalizeQuestions(rawList, sources = []) {
    const list = Array.isArray(rawList) ? rawList : [];
    // UJ-30: sólo se acepta como `source` un rótulo que exista de verdad entre
    // los bloques de contexto. Si el modelo inventa un material, la pregunta
    // queda sin respaldo en vez de mostrar una cita falsa. Con alcance de unidad
    // el bloque además identifica su clase, para que el fallo pueda volver al
    // encuentro del tema que corresponde y no a la unidad entera.
    const labels = new Map(sources.map((s) => [String(s.label || '').trim().toLowerCase(), s]));
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
        const declaredSource = sanitizeText(raw.source || raw.sourceLabel || '', 200);
        const matched = labels.get(declaredSource.toLowerCase()) || null;
        questions.push({
            id: uuidv4(),
            question,
            options,
            correctIndex,
            explanation: sanitizeText(raw.explanation, 500),
            topic: sanitizeText(raw.topic || raw.topicLabel, 200),
            source: matched?.label || '',
            classId: matched?.classId || '',
        });
    }
    return questions;
}

const MATERIAL_SOURCE_LABELS = {
    transcript: 'Transcripción del encuentro',
    presentation: 'Presentación',
    notes: 'Notas',
    bibliography: 'Bibliografía',
};

function materialSourceLabel(material) {
    const kind = MATERIAL_SOURCE_LABELS[material.type] || 'Material';
    return `${kind} — ${material.filename}`;
}

/**
 * Arma el contexto del cuestionario y, a la vez, el catálogo de bloques que lo
 * componen. Cada bloque tiene un rótulo estable: el modelo lo cita por pregunta
 * y el resultado lo usa para enlazar el material que respalda cada fallo
 * (UJ-30, paso 6). El rótulo del bloque es el mismo texto que el catálogo, para
 * que la cita sea verificable contra lo que se le pasó al modelo.
 */
async function loadClassContext(subjectId, classId, context) {
    const parts = [];
    const sources = [];

    const summaryData = await loadJson(CONTAINER_SUMMARIES, `${classId}.json`).catch(() => null);
    const summaryText = typeof summaryData === 'string'
        ? summaryData
        : (summaryData?.summary?.content || summaryData?.summary || '');
    if (summaryText) {
        const label = 'Resumen de la clase (síntesis)';
        parts.push(`[${label}]\n${sanitizeText(summaryText, 8000)}`);
        sources.push({ id: 'summary', label, kind: 'summary' });
    }

    const materials = await listMaterialsByClass(subjectId, classId);
    const textMaterials = materials.filter((m) => ['transcript', 'presentation', 'notes', 'bibliography'].includes(m.type));
    let loadedTexts = 0;
    for (const mat of textMaterials) {
        const processed = await loadJson(CONTAINER_PROCESSED, `${mat.materialId}.json`).catch(() => null);
        const t = processed?.extractedText || processed?.text || '';
        if (t) {
            const label = materialSourceLabel(mat);
            parts.push(`[${label}]\n${sanitizeText(t, 4000)}`);
            sources.push({ id: `material:${mat.materialId}`, label, kind: mat.type, filename: mat.filename });
            loadedTexts++;
        }
    }
    context.log(`[Quiz] Context loaded: summary=${summaryText ? 'yes' : 'no'}, materials=${loadedTexts}/${textMaterials.length}`);
    return { text: parts.join('\n\n'), sources };
}

/**
 * Arma el contexto de la unidad: resumen y materiales de cada clase elegida,
 * con el presupuesto repartido entre todas. Cada bloque se rotula con la clase a
 * la que pertenece, así el modelo no mezcla temas y la cita de cada pregunta
 * sigue siendo verificable contra un material concreto.
 */
async function loadUnitContext(subjectId, classes, context) {
    const parts = [];
    const sources = [];
    const perClassBudget = Math.max(800, Math.floor(UNIT_CONTEXT_BUDGET / Math.max(classes.length, 1)));
    const summaryBudget = Math.max(400, Math.floor(perClassBudget * UNIT_SUMMARY_SHARE));
    const materialBudget = Math.max(400, perClassBudget - summaryBudget);
    let loadedSummaries = 0;
    let loadedMaterials = 0;

    for (const classInfo of classes) {
        const classId = classInfo.id;
        const classLabel = classLabelOf(classInfo);

        const summaryData = await loadJson(CONTAINER_SUMMARIES, `${classId}.json`).catch(() => null);
        const summaryText = typeof summaryData === 'string'
            ? summaryData
            : (summaryData?.summary?.content || summaryData?.summary || '');
        if (summaryText) {
            const label = `Resumen — ${classLabel}`;
            parts.push(`[${label}]\n${sanitizeText(summaryText, summaryBudget)}`);
            sources.push({ id: `summary:${classId}`, label, kind: 'summary', classId, classTitle: classLabel });
            loadedSummaries++;
        }

        const materials = await listMaterialsByClass(subjectId, classId).catch(() => []);
        const textMaterials = materials.filter(isTextualMaterial);
        // El presupuesto de materiales de la clase se reparte entre los que
        // tengan texto extraído: el primero no se lleva todo el espacio.
        const perMaterial = Math.max(300, Math.floor(materialBudget / Math.max(textMaterials.length, 1)));
        for (const mat of textMaterials) {
            const processed = await loadJson(CONTAINER_PROCESSED, `${mat.materialId}.json`).catch(() => null);
            const t = processed?.extractedText || processed?.text || '';
            if (!t) continue;
            const label = `${classLabel} · ${materialSourceLabel(mat)}`;
            parts.push(`[${label}]\n${sanitizeText(t, perMaterial)}`);
            sources.push({
                id: `material:${mat.materialId}`,
                label,
                kind: mat.type,
                filename: mat.filename,
                classId,
                classTitle: classLabel,
            });
            loadedMaterials++;
        }
    }
    context.log(`[Quiz] Unit context loaded: classes=${classes.length}, summaries=${loadedSummaries}, materials=${loadedMaterials}, chars=${parts.join('\n\n').length}`);
    return { text: parts.join('\n\n'), sources };
}

/**
 * Anuncio del alcance de la práctica de la unidad (UJ-30, paso 1). No genera
 * nada: lo que anuncia es lo que hay publicado —clases, sus temas declarados y
 * los materiales procesados—, más los temas que la persona ya marcó como flojos
 * en cada clase. Con eso el panel puede decir qué abarca antes de empezar y
 * ofrecer el acotamiento sin gastar una generación.
 */
async function buildUnitAnnouncement(subjectId, userId) {
    const published = publishedClassesOf(await listClassesBySubject(subjectId).catch(() => []));
    const classes = [];
    const topics = [];
    let materialCount = 0;

    for (const classInfo of published) {
        const materials = await listMaterialsByClass(subjectId, classInfo.id).catch(() => []);
        const usable = materials.filter(isTextualMaterial);
        const { topics: classTopics, declared } = classTopicsOf(classInfo);
        const markedRecord = await getQuizWeakTopics(subjectId, userId, classInfo.id).catch(() => null);
        const markedTopics = normalizeTopicList(markedRecord?.topics || []);
        materialCount += usable.length;

        for (const topic of classTopics) {
            topics.push({
                topic,
                classId: classInfo.id,
                classTitle: classLabelOf(classInfo),
                declared,
                markedWeak: markedTopics.includes(topic),
            });
        }

        classes.push({
            classId: classInfo.id,
            title: classLabelOf(classInfo),
            date: classInfo.date || null,
            topics: classTopics,
            topicsDeclared: declared,
            markedTopics,
            materialCount: usable.length,
            materials: usable.map((m) => ({ type: m.type, filename: m.filename, label: materialSourceLabel(m) })),
            hasMaterialText: usable.length > 0,
        });
    }

    return {
        subjectId,
        scope: {
            kind: SCOPE_UNIT,
            classCount: classes.length,
            classIds: classes.map((c) => c.classId),
            topicCount: topics.length,
            materialCount,
        },
        classes,
        topics,
        // Frase canónica del anuncio: el panel la muestra tal cual y la
        // evidencia la verifica contra los datos, sin reescribirla.
        headline: classes.length
            ? `Esta práctica abarca los ${topics.length} temas de ${classes.length} clase${classes.length === 1 ? '' : 's'} publicada${classes.length === 1 ? '' : 's'} de la unidad.`
            : 'La unidad todavía no tiene clases publicadas: no hay temas para practicar.',
        coverage: { classCount: classes.length, topicCount: topics.length, materialCount },
        generatedAt: new Date().toISOString(),
    };
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

const CLASS_SYSTEM_PROMPT = (questionCount) => `Sos un docente experto en crear cuestionarios de autoevaluación para estudiantes universitarios.
Generás exactamente ${questionCount} preguntas de opción múltiple (4 opciones cada una) sobre el material de clase provisto.
Cada pregunta debe verificar comprensión real del contenido, no datos triviales.

Requerimientos del JSON de salida:
- Devolvé EXCLUSIVAMENTE un array JSON válido, sin texto adicional, sin marcas de código.
- Cada elemento tiene la forma:
  { "question": "texto de la pregunta", "options": ["opción A", "opción B", "opción C", "opción D"], "correctIndex": <índice de la opción correcta (0-3)>, "explanation": "explicación breve de por qué es correcta", "topic": "tema o concepto que evalúa" }
- Deben ser ${questionCount} preguntas exactas.
- Sin preguntas repetidas ni demasiado parecidas entre sí.`;

// UJ-30 (paso 1): con alcance de unidad el cuestionario no es «de una clase»:
// cubre los temas de todas las clases incluidas, repartidas entre ellas.
const UNIT_SYSTEM_PROMPT = (questionCount, topicLabels) => `Sos un docente experto en crear cuestionarios de autoevaluación para estudiantes universitarios.
Generás exactamente ${questionCount} preguntas de opción múltiple (4 opciones cada una) que cubren la UNIDAD completa, no una clase suelta: el material provisto reúne los temas de varias clases.
Cada pregunta debe verificar comprensión real del contenido, no datos triviales.

Requerimientos del JSON de salida:
- Devolvé EXCLUSIVAMENTE un array JSON válido, sin texto adicional, sin marcas de código.
- Cada elemento tiene la forma:
  { "question": "texto de la pregunta", "options": ["opción A", "opción B", "opción C", "opción D"], "correctIndex": <índice de la opción correcta (0-3)>, "explanation": "explicación breve de por qué es correcta", "topic": "tema de la unidad que evalúa", "source": "rótulo del bloque de contexto que respalda la respuesta" }
- Deben ser ${questionCount} preguntas exactas.
- Repartí las preguntas entre los temas incluidos (${topicLabels.length} en total), sin que todas salgan del mismo tema.
- El campo "topic" debe nombrar el tema tal como figura en la lista de temas incluidos.
- Sin preguntas repetidas ni demasiado parecidas entre sí.
- Siempre devolvés las ${questionCount} preguntas: si un tema tiene poco material, cubrí los demás en vez de entregar menos.`;

async function buildQuizPrompt({
    subjectName,
    className,
    contextText,
    questionCount,
    previousQuestions = [],
    previousTopics = [],
    sources = [],
    unit = null,
}) {
    const promptConfig = await getActivePrompt('quiz').catch(() => null);
    const sourceList = sources.map((s, i) => `${i + 1}. ${s.label}`).join('\n');
    const sourceRule = sources.length
        ? `- Cada elemento tiene además un campo "source": el rótulo EXACTO de uno de los bloques de contexto listados abajo, tal cual está escrito (sin agregar ni quitar texto), que respalda la respuesta correcta de esa pregunta.
- Bloques de contexto disponibles (usá el rótulo tal cual):
${sourceList}`
        : '';
    const topicLabels = unit ? unit.topicLabels : [];
    const baseSystem = promptConfig?.systemPrompt
        || (unit ? UNIT_SYSTEM_PROMPT(questionCount, topicLabels) : CLASS_SYSTEM_PROMPT(questionCount));
    // UJ-30 (paso 6): el respaldo de cada pregunta se pide siempre, incluso si la
    // cátedra configuró un prompt propio, porque el resultado lo necesita para
    // enlazar el material. Sólo se pide cuando hay bloques que citar.
    const systemContent = sourceRule ? `${baseSystem}\n${sourceRule}` : baseSystem;
    const defaultUserTemplate = unit
        ? 'Generá ${questionCount} preguntas de autoevaluación sobre la siguiente unidad (todos sus temas, no una clase suelta).\n\nMateria: ${subjectName}\nUnidad: ${className}\n\nCONTEXTO:\n${contextText}'
        : 'Generá ${questionCount} preguntas de autoevaluación sobre la siguiente clase.\n\nMateria: ${subjectName}\nClase: ${className}\n\nCONTEXTO:\n${contextText}';
    let userContent = (promptConfig?.userPromptTemplate || defaultUserTemplate)
        .replace('${questionCount}', String(questionCount))
        .replace('${subjectName}', subjectName || '')
        .replace('${className}', className || '')
        .replace('${contextText}', contextText);
    if (unit) {
        // El alcance va escrito en el pedido: qué temas abarca esta práctica y de
        // qué clase sale cada uno. Es lo mismo que el panel anunció antes de
        // empezar, así que el cuestionario no puede cubrir otra cosa.
        userContent += `\n\nEsta práctica es de la unidad y abarca los temas de estas ${unit.scopeLines.length} clases:\n`
            + unit.scopeLines.map((line, i) => `${i + 1}. ${line}`).join('\n')
            + `\nCubrí todos esos temas, no sólo el primero, y citá en "source" el bloque del tema del que sale cada pregunta.`;
        if (unit.priorityTopics.length) {
            userContent += `\n\nLa persona pidió concentrar la práctica en estos temas, que son los que más le preocupan:\n`
                + unit.priorityTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')
                + `\nSi esos temas están entre los incluidos, al menos la mitad de las preguntas tienen que ser de ellos. Si el material no alcanza para alguno, cubrí el resto de los temas incluidos sin inventar contenido.`;
        }
    }
    // UJ-31: la persona ya hizo la práctica y vuelve a ponerse a prueba. El nuevo
    // conjunto tiene que cubrir el mismo alcance pero sin repetir lo ya visto.
    if (previousQuestions.length) {
        const alcance = unit ? 'esta unidad' : 'esta clase';
        const alcanceNoun = unit ? 'la unidad' : 'la clase';
        userContent += `\n\nLa persona ya respondió una práctica de ${alcance}. NO repitas ninguna de estas preguntas, ni las reformules para evaluar el mismo punto:\n`
            + previousQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
            + `\nCubrí los mismos temas de ${alcanceNoun}, pero con preguntas nuevas sobre otros puntos del material, de dificultad equivalente.`;
    }
    // UJ-31, paso 7: la comparación tema por tema sólo se apoya en la misma vara si
    // el conjunto nuevo declara los mismos temas que el anterior. Sin esta consigna
    // el modelo inventa etiquetas nuevas en cada intento y todos los veredictos
    // quedan en «tema nuevo» / «no se evaluó».
    if (previousTopics.length) {
        userContent += `\n\nPara que el resultado se pueda comparar tema por tema con la práctica anterior, cada pregunta debe declarar su campo "topic" usando EXACTAMENTE una de estas etiquetas, tal cual está escrita (sin variantes, sin sinónimos y sin crear etiquetas nuevas):\n`
            + previousTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')
            + `\nRepartí las ${questionCount} preguntas entre esos temas, priorizando los que mejor representan el material de la ${unit ? 'unidad' : 'clase'}.`;
    }
    return { systemContent, userContent };
}

/**
 * GET /api/quiz-scope — anuncia el alcance de la práctica de la unidad antes de
 * empezar (UJ-30, pasos 1 y 2). Devuelve los temas (clases publicadas) que la
 * práctica abarcaría, con sus materiales y los temas que la persona ya marcó
 * como flojos, para que el panel lo anuncie y permita acotarlo. No genera nada:
 * no consume tokens ni crea estado.
 */
app.http('get-quiz-scope', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'quiz-scope',
    handler: withCorrelation(withAuth(async (request, context) => {
        const log = createStructuredLogger('get-quiz-scope', context);
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
        const { userId } = getAuthenticatedUser(request);
        const subjectId = request.query.get('subjectId');
        if (!subjectId) return jsonResponse(400, { error: 'Parámetros requeridos: subjectId' });

        const principal = parseClientPrincipal(request);
        const isTeacherOrDirector = principal?.userRoles?.some((r) => ['Docente', 'Director'].includes(r));
        if (principal && !isTeacherOrDirector) {
            const enrollment = await getEnrollment(subjectId, userId).catch(() => null);
            if (!enrollment || enrollment.status !== 'active') {
                return jsonResponse(403, { error: 'ENROLLMENT_REQUIRED', message: 'No estás matriculado en esta materia.' });
            }
        }

        const announcement = await buildUnitAnnouncement(subjectId, userId);
        log.info('quiz-scope announced', {
            subjectId,
            classCount: announcement.coverage.classCount,
            topicCount: announcement.coverage.topicCount,
        });
        return jsonResponse(200, announcement);
    })),
});

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

        const { subjectId, classId: requestedClassId, questionCount, subjectName } = body || {};
        const scope = normalizeScope(body?.scope);
        const requestedClassIds = normalizeClassIdList(body?.classIds);
        const priorityTopics = normalizeTopicList(body?.topics);
        if (!subjectId) {
            return jsonResponse(400, { error: 'Faltan campos requeridos: subjectId, classId' });
        }
        // Un acotamiento vacío es un pedido explícito sin temas: se rechaza, no
        // se interpreta como «toda la unidad» (eso sólo vale si no se acotó).
        if (Array.isArray(body?.classIds) && requestedClassIds.length === 0) {
            return jsonResponse(400, {
                error: {
                    code: 'QUIZ_SCOPE_EMPTY',
                    message: 'Elegí al menos un tema de la unidad para armar la práctica.',
                },
                errorCategory: 'VALIDATION',
            });
        }

        // El alcance se resuelve antes de tocar el modelo: en la unidad son las
        // clases publicadas (o el subconjunto pedido), y una elección vacía o
        // ajena se rechaza acá en vez de generar un cuestionario vacío.
        let classId = requestedClassId;
        let unitClasses = [];
        if (scope === SCOPE_UNIT) {
            const published = publishedClassesOf(await listClassesBySubject(subjectId).catch(() => []));
            if (requestedClassIds.length) {
                const unknown = requestedClassIds.filter((id) => !published.some((c) => c.id === id));
                if (unknown.length) {
                    return jsonResponse(400, {
                        error: {
                            code: 'QUIZ_SCOPE_INVALID',
                            message: `Los temas elegidos no están publicados en esta unidad: ${unknown.join(', ')}.`,
                        },
                        errorCategory: 'VALIDATION',
                    });
                }
                unitClasses = published.filter((c) => requestedClassIds.includes(c.id));
            } else {
                unitClasses = published;
            }
            if (unitClasses.length === 0) {
                return jsonResponse(400, {
                    error: {
                        code: 'QUIZ_SCOPE_EMPTY',
                        message: 'Elegí al menos un tema de la unidad para armar la práctica: hoy no hay clases publicadas para practicar.',
                    },
                    errorCategory: 'VALIDATION',
                });
            }
            classId = UNIT_SCOPE_KEY;
        } else if (!classId) {
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
            const contextText = scope === SCOPE_UNIT
                ? await loadUnitContext(subjectId, unitClasses, context)
                : await loadClassContext(subjectId, classId, context);
            if (!contextText.text) {
                if (scope === SCOPE_UNIT) {
                    return jsonResponse(400, {
                        error: {
                            code: 'QUIZ_SCOPE_EMPTY',
                            message: 'Los temas elegidos todavía no tienen resumen ni materiales procesados: no hay con qué armar la práctica.',
                        },
                        errorCategory: 'VALIDATION',
                    });
                }
                return jsonResponse(400, { error: 'No hay resumen ni materiales procesados disponibles para esta clase.' });
            }

            // Intentos previos de esta persona en este alcance: el nuevo conjunto
            // no repite lo ya visto (UJ-31) y la pantalla puede anunciar el número.
            // Los intentos de la unidad viven aparte de los de cada clase.
            const previousAttempts = await listQuizAttempts(subjectId, userId, classId).catch(() => []);
            const previousQuestions = previousQuestionsOf(previousAttempts);
            const previousTopics = previousTopicsOf(previousAttempts);
            const attemptNumber = previousAttempts.length + 1;

            const className = scope === SCOPE_UNIT
                ? (body.unitName || body.className || subjectId)
                : (body.className || classId);
            // Con alcance de unidad el pedido lleva escrito qué temas abarca: es
            // el mismo alcance que el panel anunció antes de empezar.
            const unit = scope === SCOPE_UNIT ? (() => {
                const scopeLines = [];
                const topicLabels = [];
                for (const cls of unitClasses) {
                    const { topics, declared } = classTopicsOf(cls);
                    const label = classLabelOf(cls);
                    scopeLines.push(declared ? `${label} — temas: ${topics.join(', ')}` : label);
                    topicLabels.push(...topics);
                }
                return { scopeLines, topicLabels, priorityTopics };
            })() : null;
            const { systemContent, userContent } = await buildQuizPrompt({
                subjectName,
                className,
                contextText: contextText.text,
                questionCount: count,
                previousQuestions,
                previousTopics,
                sources: contextText.sources,
                unit,
            });

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
            const questions = normalizeQuestions(rawQuestions, contextText.sources);
            if (questions.length === 0) {
                log.warn('Quiz generation returned unparseable output', { length: result?.content?.length, subjectId, classId });
                return jsonResponse(502, { error: 'No se pudo generar un cuestionario válido. Intentá de nuevo.' });
            }

            const payload = {
                quizId: uuidv4(),
                subjectId,
                // El alcance viaja en la respuesta: de qué es la práctica y, si es
                // de la unidad, qué clases la componen (lo que se anunció).
                scope,
                classId: scope === SCOPE_UNIT ? null : classId,
                classIds: scope === SCOPE_UNIT ? unitClasses.map((c) => c.id) : [classId],
                topics: scope === SCOPE_UNIT ? priorityTopics : [],
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
                scope,
                classIds: payload.classIds,
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

        const { subjectId, quizId, answers } = body || {};
        // El intento de la unidad se guarda bajo su propia clave: no es una clase
        // y no debe pisar ni mezclarse con el historial de ninguna.
        const scope = normalizeScope(body?.scope);
        const classId = scopeKeyOf(scope, body?.classId);
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
        const classId = scopeKeyOf(normalizeScope(request.query.get('scope')), request.query.get('classId'));
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
        const classId = scopeKeyOf(normalizeScope(request.query.get('scope')), request.query.get('classId'));
        if (!subjectId || !classId) {
            return jsonResponse(400, { error: 'Parámetros requeridos: subjectId, classId' });
        }
        // Historial de intentos de esa persona en ese alcance, resumido por tema:
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

const MAX_MARKED_TOPICS = 50;

/**
 * UJ-30 (paso 7): los temas flojos los marca la persona, no el sistema. La marca
 * vive por persona y unidad (clase) y sobrevive al cierre de la pestaña, así que
 * no se deriva del último intento: se guarda aparte.
 */
app.http('get-quiz-weak-topics', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'quiz-weak-topics',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
        const { userId } = getAuthenticatedUser(request);
        const subjectId = request.query.get('subjectId');
        const classId = scopeKeyOf(normalizeScope(request.query.get('scope')), request.query.get('classId'));
        if (!subjectId || !classId) {
            return jsonResponse(400, { error: 'Parámetros requeridos: subjectId, classId' });
        }
        const record = await getQuizWeakTopics(subjectId, userId, classId).catch(() => null);
        return jsonResponse(200, { topics: record?.topics || [], updatedAt: record?.updatedAt || null });
    })),
});

app.http('save-quiz-weak-topics', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'quiz-weak-topics',
    handler: withCorrelation(withAuth(withRateLimit(async (request, context) => {
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
        const { userId } = getAuthenticatedUser(request);

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse(400, { error: 'Body JSON inválido' });
        }

        const { subjectId, topics } = body || {};
        const scope = normalizeScope(body?.scope);
        const classId = scopeKeyOf(scope, body?.classId);
        if (!subjectId || !classId || !Array.isArray(topics)) {
            return jsonResponse(400, { error: 'Faltan campos requeridos: subjectId, classId, topics' });
        }
        const cleaned = [];
        for (const raw of topics) {
            const topic = sanitizeText(raw, 200);
            if (topic && !cleaned.includes(topic)) cleaned.push(topic);
            if (cleaned.length >= MAX_MARKED_TOPICS) break;
        }

        const saved = await upsertQuizWeakTopics({ subjectId, userId, classId, topics: cleaned });
        return jsonResponse(200, { topics: saved.topics, updatedAt: saved.updatedAt });
    }, 'general'))),
});

// ─── Práctica compartida del grupo (#445 / UJ-32) ──────────────────
// La práctica individual sigue siendo lo que era: cada persona genera la suya y
// la responde sola. Arriba de eso hay una capa de grupo:
//
//   1. el grupo es el que la materia ya declara —las matrículas activas de la
//      unidad—, no un padrón aparte ni integrantes inventados por el panel;
//   2. la práctica se emite UNA vez para ese grupo: la primera persona que la
//      abre la genera y las demás abren la misma (mismo conjunto, mismo alcance);
//   3. cada persona la responde por separado y sólo puede ver la comparación
//      después de responder la suya: si no, las respuestas ajenas contaminarían
//      la propia y dejaría de ser individual;
//   4. la comparación dice en qué preguntas coincidieron y en cuáles no, y el
//      grupo asienta un resultado común con los temas que no pudo acordar, para
//      llevarlos a quien enseña (UJ-28, aguas abajo).
//
// El costo de una generación lo paga el grupo una sola vez: reabrir la práctica
// no vuelve a llamar al modelo mientras la ventana siga abierta.

// Una práctica compartida no vive un rato: la gente la responde cuando puede.
const GROUP_QUIZ_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Con una sola respuesta no hay comparación posible: «coincidieron» necesita al
// menos dos personas que hayan contestado la misma pregunta.
const GROUP_MIN_RESPONSES_TO_COMPARE = 2;

/**
 * El grupo de la práctica son las personas con matrícula activa de la materia.
 * No se inventa un padrón: si la materia no declara matrículas, no hay grupo y
 * el panel lo dice en vez de simular uno.
 * @returns {Promise<string[]|null>} ids, o null si no se pudo leer la matrícula.
 */
async function loadGroupMemberIds(subjectId) {
    const enrollments = await getEnrollmentsBySubject(subjectId).catch(() => null);
    if (!Array.isArray(enrollments)) return null;
    const ids = [];
    for (const enrollment of enrollments) {
        if (String(enrollment?.role || '').toLowerCase() !== 'student') continue;
        if (String(enrollment?.status || '').toLowerCase() !== 'active') continue;
        const id = enrollment?.userId;
        if (!id || ids.includes(id)) continue;
        ids.push(id);
    }
    return ids;
}

/**
 * Puerta común de la práctica del grupo. Devuelve el `users` resuelto o la
 * respuesta de error con la que se corta el pedido.
 */
async function requireGroupMembership(request, subjectId) {
    const { userId } = getAuthenticatedUser(request);
    const members = await loadGroupMemberIds(subjectId);
    if (members === null) {
        return {
            error: jsonResponse(503, {
                error: { code: 'GROUP_UNAVAILABLE', message: 'No pudimos determinar el grupo de esta materia. Probá de nuevo.' },
                errorCategory: 'DEPENDENCY',
            }),
        };
    }
    if (!members.includes(userId)) {
        return {
            error: jsonResponse(403, {
                error: {
                    code: 'GROUP_NOT_ENROLLED',
                    message: 'El grupo de esta práctica son las personas con matrícula activa en la materia: la tuya no figura activa.',
                },
                errorCategory: 'AUTH',
            }),
        };
    }
    return { userId, members };
}

/**
 * Resuelve el alcance de la práctica compartida con las mismas reglas que la
 * individual (unidad completa, subconjunto de clases o una clase), pero devuelve
 * además las clases y un rótulo para que el panel diga qué abarca la práctica común.
 */
async function resolveGroupScope(subjectId, scope, requestedClassId, requestedClassIds) {
    const classes = await listClassesBySubject(subjectId).catch(() => []);
    if (scope === SCOPE_UNIT) {
        const published = publishedClassesOf(classes);
        if (requestedClassIds.length) {
            const unknown = requestedClassIds.filter((id) => !published.some((c) => c.id === id));
            if (unknown.length) {
                return {
                    error: {
                        status: 400,
                        code: 'QUIZ_SCOPE_INVALID',
                        message: `Los temas elegidos no están publicados en esta unidad: ${unknown.join(', ')}.`,
                    },
                };
            }
        }
        const selected = requestedClassIds.length
            ? published.filter((c) => requestedClassIds.includes(c.id))
            : published;
        if (!selected.length) {
            return {
                error: {
                    status: 400,
                    code: 'QUIZ_SCOPE_EMPTY',
                    message: 'Elegí al menos un tema de la unidad para armar la práctica: hoy no hay clases publicadas para practicar.',
                },
            };
        }
        return {
            scope,
            classId: UNIT_SCOPE_KEY,
            classIds: selected.map((c) => c.id),
            classes: selected,
            label: 'la unidad completa',
        };
    }
    const info = classes.find((c) => c.id === requestedClassId) || null;
    return {
        scope,
        classId: requestedClassId,
        classIds: [requestedClassId],
        classes: info ? [info] : [],
        label: info ? classLabelOf(info) : requestedClassId,
    };
}

/** Tema con el que se agrupa una pregunta en la comparación. */
function groupTopicOf(question) {
    return sanitizeText(question?.topic || '', 200) || 'Sin tema';
}

function groupTopicSummary(questions) {
    const acc = new Map();
    for (const question of questions) {
        const entry = acc.get(question.topic) || { topic: question.topic, questionCount: 0 };
        entry.questionCount += 1;
        acc.set(question.topic, entry);
    }
    return Array.from(acc.values());
}

/**
 * Arma la comparación del grupo pregunta por pregunta. Deliberadamente no
 * devuelve quién eligió qué: para responder «¿coincidieron?» alcanza con la
 * distribución de respuestas, y nombrar a las personas convertiría la
 * comparación en una exposición de cada una.
 */
function buildGroupComparison(groupQuiz, responses, myUserId) {
    const answeredCount = responses.length;
    const perQuestion = (groupQuiz.questions || []).map((question) => {
        const optionCount = Array.isArray(question.options) ? question.options.length : 0;
        const distribution = new Array(optionCount).fill(0);
        let mine = null;
        let mineCorrect = null;
        let votes = 0;
        for (const response of responses) {
            const answer = (response.answers || []).find((a) => a && a.questionId === question.id);
            const selected = Number.isInteger(answer?.selectedIndex) ? answer.selectedIndex : null;
            if (selected !== null && selected >= 0 && selected < optionCount) {
                distribution[selected] += 1;
                votes += 1;
            }
            if (response.userId === myUserId) {
                mine = selected;
                mineCorrect = answer?.isCorrect === true;
            }
        }
        const maxVotes = distribution.reduce((max, count) => Math.max(max, count), 0);
        // Coincidieron = todas las respuestas recibidas eligieron la misma opción.
        const agreed = votes >= GROUP_MIN_RESPONSES_TO_COMPARE && maxVotes === votes;
        return {
            questionId: question.id,
            question: question.question,
            options: question.options,
            topic: groupTopicOf(question),
            answeredCount: votes,
            distribution,
            agreed,
            commonAnswerIndex: agreed ? distribution.indexOf(maxVotes) : null,
            correctIndex: question.correctIndex,
            myAnswerIndex: mine,
            myCorrect: mineCorrect,
        };
    });

    const compared = perQuestion.filter((q) => q.answeredCount >= GROUP_MIN_RESPONSES_TO_COMPARE);
    const agreedQuestions = compared.filter((q) => q.agreed);
    const disagreedQuestions = compared.filter((q) => !q.agreed);
    // Coincidir en una respuesta equivocada no es acuerdo: es un tema que el
    // grupo comparte mal y que también conviene llevar a quien enseña.
    const consensusWrong = agreedQuestions.filter((q) => q.commonAnswerIndex !== q.correctIndex);

    return {
        questions: perQuestion,
        commonResult: {
            questionCount: perQuestion.length,
            answeredCount,
            memberCount: groupQuiz.memberCount,
            pendingCount: Math.max(0, groupQuiz.memberCount - answeredCount),
            comparedCount: compared.length,
            agreedCount: agreedQuestions.length,
            disagreedCount: disagreedQuestions.length,
            consensusWrongCount: consensusWrong.length,
        },
        agreed: agreedQuestions.map((q) => ({
            questionId: q.questionId,
            question: q.question,
            topic: q.topic,
            answerIndex: q.commonAnswerIndex,
            correctIndex: q.correctIndex,
            isCorrect: q.commonAnswerIndex === q.correctIndex,
        })),
        disagreed: disagreedQuestions.map((q) => ({
            questionId: q.questionId,
            question: q.question,
            topic: q.topic,
            distribution: q.distribution,
            correctIndex: q.correctIndex,
        })),
        coincidieronEnIncorrecta: consensusWrong.map((q) => ({
            questionId: q.questionId,
            question: q.question,
            topic: q.topic,
            answerIndex: q.commonAnswerIndex,
            correctIndex: q.correctIndex,
        })),
        // «Temas que no pudieron acordar»: la lista que se lleva a quien enseña.
        consultTopics: groupTopicSummary(disagreedQuestions),
    };
}

// El resumen que ve el grupo no incluye quién la abrió: la práctica es del
// grupo, no de la persona que la generó, y nombrarla no aporta nada.
function groupQuizSummary(quiz) {
    return {
        groupQuizId: quiz.groupQuizId,
        scope: quiz.scope,
        classId: quiz.scope === SCOPE_UNIT ? null : quiz.classId,
        classIds: quiz.classIds,
        questionCount: quiz.questionCount,
        memberCount: quiz.memberCount,
        createdAt: quiz.createdAt,
        expiresAt: quiz.expiresAt,
    };
}

/**
 * GET /api/group-quiz — estado de la práctica compartida de un alcance: si ya
 * existe, cuántas personas respondieron, qué respondió quien consulta y si el
 * grupo ya asentó un resultado común. No genera nada.
 */
app.http('get-group-quiz', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'group-quiz',
    handler: withCorrelation(withAuth(async (request, context) => {
        const log = createStructuredLogger('get-group-quiz', context);
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
        const subjectId = request.query.get('subjectId');
        const scope = normalizeScope(request.query.get('scope'));
        const requestedClassId = request.query.get('classId');
        if (!subjectId) return jsonResponse(400, { error: 'Parámetros requeridos: subjectId' });
        if (scope === SCOPE_CLASS && !requestedClassId) {
            return jsonResponse(400, { error: 'Parámetros requeridos: subjectId, classId' });
        }

        const gate = await requireGroupMembership(request, subjectId);
        if (gate.error) return gate.error;

        const resolved = await resolveGroupScope(subjectId, scope, requestedClassId, []);
        if (resolved.error) {
            return jsonResponse(resolved.error.status, {
                error: { code: resolved.error.code, message: resolved.error.message },
                errorCategory: 'VALIDATION',
            });
        }

        const practice = await findOpenGroupQuiz(subjectId, scope, resolved.classId).catch(() => null);
        const myResponse = practice
            ? await getGroupQuizResponse(practice.groupQuizId, gate.userId).catch(() => null)
            : null;
        const responses = practice
            ? await listGroupQuizResponses(practice.groupQuizId).catch(() => [])
            : [];
        const record = practice ? await getGroupQuizRecord(practice.groupQuizId).catch(() => null) : null;

        log.info('group quiz state', {
            subjectId,
            scope,
            classId: resolved.classId,
            hasPractice: Boolean(practice),
            answeredCount: responses.length,
            memberCount: gate.members.length,
        });

        return jsonResponse(200, {
            group: {
                subjectId,
                memberCount: gate.members.length,
                // Cómo se forma el grupo, tal como lo deriva el servidor: no hay
                // integrantes inventados por el panel.
                derivedFrom: 'matrículas activas de la materia (rol student, estado active)',
            },
            scope: {
                kind: scope,
                classId: scope === SCOPE_UNIT ? null : resolved.classId,
                classIds: resolved.classIds,
                label: resolved.label,
            },
            practice: practice
                ? { ...groupQuizSummary(practice), answeredCount: responses.length }
                : null,
            myResponse: myResponse
                ? {
                    score: myResponse.score,
                    correctCount: myResponse.correctCount,
                    totalQuestions: myResponse.totalQuestions,
                    passed: myResponse.passed,
                    weakTopics: myResponse.weakTopics,
                    answers: myResponse.answers,
                    submittedAt: myResponse.submittedAt,
                }
                : null,
            record: record
                ? {
                    revision: record.revision,
                    respondedCount: record.respondedCount,
                    memberCount: record.memberCount,
                    agreedCount: record.agreed.length,
                    disagreedCount: record.disagreed.length,
                    consultTopics: record.consultTopics,
                    recordedAt: record.recordedAt,
                }
                : null,
        });
    })),
});

/**
 * POST /api/group-quiz — abre la práctica compartida del alcance. Si ya hay una
 * abierta la devuelve tal cual (`reused: true`): es lo que garantiza que todas
 * respondan el mismo conjunto. Sólo la primera apertura gasta una generación.
 */
app.http('create-group-quiz', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'group-quiz',
    handler: withCorrelation(withAuth(withRateLimit(async (request, context) => {
        const log = createStructuredLogger('create-group-quiz', context);
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse(400, { error: 'Body JSON inválido' });
        }

        const { subjectId, questionCount, subjectName, className } = body || {};
        const scope = normalizeScope(body?.scope);
        const requestedClassIds = normalizeClassIdList(body?.classIds);
        if (!subjectId) return jsonResponse(400, { error: 'Faltan campos requeridos: subjectId' });
        if (Array.isArray(body?.classIds) && requestedClassIds.length === 0) {
            return jsonResponse(400, {
                error: { code: 'QUIZ_SCOPE_EMPTY', message: 'Elegí al menos un tema de la unidad para armar la práctica.' },
                errorCategory: 'VALIDATION',
            });
        }

        const gate = await requireGroupMembership(request, subjectId);
        if (gate.error) return gate.error;

        const resolved = await resolveGroupScope(subjectId, scope, body?.classId, requestedClassIds);
        if (resolved.error) {
            return jsonResponse(resolved.error.status, {
                error: { code: resolved.error.code, message: resolved.error.message },
                errorCategory: 'VALIDATION',
            });
        }

        const open = await findOpenGroupQuiz(subjectId, scope, resolved.classId).catch(() => null);
        if (open) {
            const myResponse = await getGroupQuizResponse(open.groupQuizId, gate.userId).catch(() => null);
            log.info('group quiz reused', { subjectId, groupQuizId: open.groupQuizId });
            return jsonResponse(200, {
                ...groupQuizSummary(open),
                reused: true,
                answered: Boolean(myResponse),
                questions: toClientQuestions(open.questions),
            });
        }

        const count = normalizeQuestionCount(questionCount);
        const startTime = Date.now();
        try {
            const contextText = scope === SCOPE_UNIT
                ? await loadUnitContext(subjectId, resolved.classes, context)
                : await loadClassContext(subjectId, resolved.classId, context);
            if (!contextText.text) {
                return jsonResponse(400, {
                    error: {
                        code: 'QUIZ_SCOPE_EMPTY',
                        message: 'Los temas de esta práctica todavía no tienen resumen ni materiales procesados: no hay con qué armarla.',
                    },
                    errorCategory: 'VALIDATION',
                });
            }

            // El pedido de la práctica compartida NO lleva exclusiones ni temas
            // propios de quien la abre: el conjunto tiene que servirle a todo el
            // grupo por igual, no estar adaptado a una persona.
            const unit = scope === SCOPE_UNIT ? (() => {
                const scopeLines = [];
                const topicLabels = [];
                for (const cls of resolved.classes) {
                    const { topics, declared } = classTopicsOf(cls);
                    const label = classLabelOf(cls);
                    scopeLines.push(declared ? `${label} — temas: ${topics.join(', ')}` : label);
                    topicLabels.push(...topics);
                }
                return { scopeLines, topicLabels, priorityTopics: [] };
            })() : null;
            const { systemContent, userContent } = await buildQuizPrompt({
                subjectName,
                className: scope === SCOPE_UNIT ? (body?.unitName || className || subjectId) : (className || resolved.label),
                contextText: contextText.text,
                questionCount: count,
                sources: contextText.sources,
                unit,
            });

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

            const questions = normalizeQuestions(extractQuizJson(result?.content), contextText.sources);
            if (questions.length === 0) {
                log.warn('Group quiz generation returned unparseable output', { subjectId, classId: resolved.classId });
                return jsonResponse(502, { error: 'No se pudo generar la práctica del grupo. Intentá de nuevo.' });
            }

            const saved = await saveGroupQuiz({
                subjectId,
                groupQuizId: uuidv4(),
                scope,
                classId: resolved.classId,
                classIds: resolved.classIds,
                questions,
                questionCount: questions.length,
                memberCount: gate.members.length,
                createdBy: gate.userId,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + GROUP_QUIZ_TTL_MS).toISOString(),
            });
            log.info('group quiz generated', {
                subjectId,
                groupQuizId: saved.groupQuizId,
                questions: questions.length,
                memberCount: gate.members.length,
                durationMs: Date.now() - startTime,
            });
            // Dos personas abriendo al mismo tiempo pueden generar dos veces. Lo
            // que se responde es la práctica que quedó vigente, no la que este
            // pedido acaba de generar: así las siguientes aperturas y las
            // respuestas posteriores hablan del mismo registro.
            const vigente = await findOpenGroupQuiz(subjectId, scope, resolved.classId).catch(() => null) || saved;
            return jsonResponse(200, {
                ...groupQuizSummary(vigente),
                reused: false,
                answered: false,
                questions: toClientQuestions(vigente.questions),
                model: getModelDisplayName(quizModel),
                generatedAt: vigente.createdAt,
                durationMs: Date.now() - startTime,
            });
        } catch (err) {
            const categorized = normalizeCategorizedError(err, ErrorCategory.LLM);
            context.error('[GroupQuiz] Error generating shared practice:', categorized);
            return jsonResponse(categorized.status, {
                error: `Error generando la práctica del grupo: ${categorized.message}`,
                errorCategory: categorized.errorCategory,
            });
        }
    }, 'chat'))),
});

/**
 * POST /api/group-quiz-response — la respuesta individual a la práctica común.
 * Se corrige en el servidor contra el cuestionario guardado (igual que la
 * individual) y se guarda una sola vez por persona: la comparación se arma con
 * la primera respuesta de cada una.
 */
app.http('save-group-quiz-response', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'group-quiz-response',
    handler: withCorrelation(withAuth(withRateLimit(async (request, context) => {
        const log = createStructuredLogger('save-group-quiz-response', context);
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse(400, { error: 'Body JSON inválido' });
        }
        const { subjectId, groupQuizId, answers } = body || {};
        if (!subjectId || !groupQuizId || !Array.isArray(answers)) {
            return jsonResponse(400, { error: 'Faltan campos requeridos: subjectId, groupQuizId, answers' });
        }

        const gate = await requireGroupMembership(request, subjectId);
        if (gate.error) return gate.error;

        const quiz = await getGroupQuiz(subjectId, groupQuizId).catch(() => null);
        if (!quiz) {
            return jsonResponse(404, {
                error: { code: 'GROUP_QUIZ_NOT_FOUND', message: 'No encontramos esa práctica del grupo. Abrila de nuevo.' },
                errorCategory: 'NOT_FOUND',
            });
        }
        if (quiz.expiresAt && Date.parse(quiz.expiresAt) < Date.now()) {
            return jsonResponse(409, {
                error: { code: 'GROUP_QUIZ_EXPIRED', message: 'La práctica del grupo venció. Abrí una nueva para volver a intentarlo.' },
                errorCategory: 'CONFLICT',
            });
        }
        const already = await getGroupQuizResponse(groupQuizId, gate.userId).catch(() => null);
        if (already) {
            return jsonResponse(409, {
                error: {
                    code: 'GROUP_QUIZ_ALREADY_ANSWERED',
                    message: 'Ya respondiste esta práctica del grupo: la comparación se arma con la primera respuesta de cada persona.',
                },
                errorCategory: 'CONFLICT',
            });
        }

        // Sólo `questionId` + `selectedIndex` del cliente: la corrección, el
        // puntaje y los temas flojos los deriva el servidor.
        const graded = gradeAttempt(quiz, answers);
        const saved = await upsertGroupQuizResponse({
            subjectId,
            groupQuizId,
            userId: gate.userId,
            classId: quiz.classId,
            score: graded.score,
            totalQuestions: graded.totalQuestions,
            correctCount: graded.correctCount,
            passed: graded.passed,
            weakTopics: graded.weakTopics,
            answers: graded.answers,
            submittedAt: new Date().toISOString(),
        });
        const responses = await listGroupQuizResponses(groupQuizId).catch(() => []);
        log.info('group quiz response saved', {
            groupQuizId,
            score: saved.score,
            answeredCount: responses.length,
            memberCount: quiz.memberCount,
        });
        return jsonResponse(200, {
            groupQuizId,
            score: saved.score,
            totalQuestions: saved.totalQuestions,
            correctCount: saved.correctCount,
            passed: saved.passed,
            weakTopics: saved.weakTopics,
            answers: saved.answers,
            submittedAt: saved.submittedAt,
            answeredCount: responses.length,
            memberCount: quiz.memberCount,
        });
    }, 'general'))),
});

/**
 * GET /api/group-quiz-comparison — la superficie que no existía: pregunta por
 * pregunta, quiénes coincidieron y en qué quedó dividido el grupo. Se abre sólo
 * para quien ya respondió su propia práctica.
 */
app.http('get-group-quiz-comparison', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'group-quiz-comparison',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
        const subjectId = request.query.get('subjectId');
        const groupQuizId = request.query.get('groupQuizId');
        if (!subjectId || !groupQuizId) {
            return jsonResponse(400, { error: 'Parámetros requeridos: subjectId, groupQuizId' });
        }

        const gate = await requireGroupMembership(request, subjectId);
        if (gate.error) return gate.error;

        const quiz = await getGroupQuiz(subjectId, groupQuizId).catch(() => null);
        if (!quiz) {
            return jsonResponse(404, {
                error: { code: 'GROUP_QUIZ_NOT_FOUND', message: 'No encontramos esa práctica del grupo.' },
                errorCategory: 'NOT_FOUND',
            });
        }

        // La comparación espera a que la persona haya respondido lo suyo: ver las
        // respuestas de las demás antes de contestar convertiría la práctica
        // individual en una copia.
        const mine = await getGroupQuizResponse(groupQuizId, gate.userId).catch(() => null);
        if (!mine) {
            return jsonResponse(409, {
                error: {
                    code: 'GROUP_QUIZ_NOT_ANSWERED',
                    message: 'Respondé la práctica del grupo para ver la comparación: las respuestas de las demás se abren cuando respondiste la tuya.',
                },
                errorCategory: 'CONFLICT',
            });
        }

        const responses = await listGroupQuizResponses(groupQuizId).catch(() => []);
        const comparison = buildGroupComparison(quiz, responses, gate.userId);
        const record = await getGroupQuizRecord(groupQuizId).catch(() => null);

        return jsonResponse(200, {
            ...groupQuizSummary(quiz),
            myResponse: {
                score: mine.score,
                correctCount: mine.correctCount,
                totalQuestions: mine.totalQuestions,
                passed: mine.passed,
                submittedAt: mine.submittedAt,
            },
            ...comparison,
            record: record
                ? {
                    revision: record.revision,
                    respondedCount: record.respondedCount,
                    memberCount: record.memberCount,
                    consultTopics: record.consultTopics,
                    recordedAt: record.recordedAt,
                }
                : null,
        });
    })),
});

/**
 * POST /api/group-quiz-record — asienta el resultado común del grupo: qué
 * preguntas quedaron acordadas, cuáles no, y los temas que el grupo no pudo
 * acordar. El contenido lo deriva el servidor de las respuestas (no se acepta
 * del cliente); reasentar incrementa la revisión.
 */
app.http('save-group-quiz-record', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'group-quiz-record',
    handler: withCorrelation(withAuth(withRateLimit(async (request, context) => {
        const log = createStructuredLogger('save-group-quiz-record', context);
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse(400, { error: 'Body JSON inválido' });
        }
        const { subjectId, groupQuizId } = body || {};
        if (!subjectId || !groupQuizId) {
            return jsonResponse(400, { error: 'Faltan campos requeridos: subjectId, groupQuizId' });
        }

        const gate = await requireGroupMembership(request, subjectId);
        if (gate.error) return gate.error;

        const quiz = await getGroupQuiz(subjectId, groupQuizId).catch(() => null);
        if (!quiz) {
            return jsonResponse(404, {
                error: { code: 'GROUP_QUIZ_NOT_FOUND', message: 'No encontramos esa práctica del grupo.' },
                errorCategory: 'NOT_FOUND',
            });
        }
        const mine = await getGroupQuizResponse(groupQuizId, gate.userId).catch(() => null);
        if (!mine) {
            return jsonResponse(409, {
                error: {
                    code: 'GROUP_QUIZ_NOT_ANSWERED',
                    message: 'Respondé tu práctica antes de asentar el resultado común del grupo.',
                },
                errorCategory: 'CONFLICT',
            });
        }

        const responses = await listGroupQuizResponses(groupQuizId).catch(() => []);
        const comparison = buildGroupComparison(quiz, responses, gate.userId);
        const previous = await getGroupQuizRecord(groupQuizId).catch(() => null);
        const record = await upsertGroupQuizRecord({
            subjectId,
            groupQuizId,
            revision: (previous?.revision || 0) + 1,
            respondedCount: comparison.commonResult.answeredCount,
            memberCount: quiz.memberCount,
            agreed: comparison.agreed,
            disagreed: comparison.disagreed,
            coincidieronEnIncorrecta: comparison.coincidieronEnIncorrecta,
            consultTopics: comparison.consultTopics,
            recordedBy: gate.userId,
            recordedAt: new Date().toISOString(),
        });
        log.info('group quiz record saved', {
            groupQuizId,
            revision: record.revision,
            agreedCount: record.agreed.length,
            disagreedCount: record.disagreed.length,
            consultTopics: record.consultTopics.length,
        });
        return jsonResponse(200, {
            record: {
                revision: record.revision,
                respondedCount: record.respondedCount,
                memberCount: record.memberCount,
                agreed: record.agreed,
                disagreed: record.disagreed,
                coincidieronEnIncorrecta: record.coincidieronEnIncorrecta,
                consultTopics: record.consultTopics,
                recordedAt: record.recordedAt,
            },
        });
    }, 'general'))),
});
