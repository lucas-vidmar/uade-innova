/**
 * rag-query.js — POST /api/rag-query
 * Motor RAG: embedding de la pregunta → similitud Pinecone → chat con contexto
 */
import { app } from '@azure/functions';
import { generateEmbedding, chatCompletion, getChatModelName, getModelDisplayName, resolveModelForTask } from '../services/ai.js';
import { querySimilar } from '../services/vector-store.js';
import { saveJson, loadJson, saveMetricsToTable } from '../services/storage.js';
import { resolveRagPrompt, getActivePrompt } from '../services/prompts.js';
import { trackRAGInteraction, trackRAGError, trackUnansweredQuery } from '../services/telemetry.js';
import { parseClientPrincipal, validateFrontDoorId, getAuthenticatedUser, hasResolvedIdentity } from '../services/auth-utils.js';
import { normalizeCategorizedError, ErrorCategory } from '../services/error-categories.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { withRateLimit } from '../middleware/with-rate-limit.js';
import { withAuth } from '../middleware/with-auth.js';
import { createStructuredLogger } from '../services/structured-logger.js';
import { v4 as uuidv4 } from 'uuid';
import { listMaterialsBySubject, listReviewedCorrections, listClassesBySubject } from '../services/state-store.js';
import { getEnrollment, getConsentStatus } from '../services/state-store.js';
import { alertIndexIntegrity } from '../services/index-integrity-alert.js';
import { getGlossary } from '../services/glossary-store.js';
import { resolveGlossaryTerm } from '../services/glossary-match.js';
import { getSubjectWeights } from '../services/subject-weights.js';
import { CONFIG } from '../services/config.js';
import {
    MAX_RAG_CHUNKS, RETRIEVAL_CANDIDATES, MAX_CHUNKS_PER_SOURCE,
    filterMatchesByTranscriptFocus, buildHybridContext, diversifyBySourceFile,
    resolveMaterialPriority, resolveSourceMix, resolveSelectedClassCount, resolveFilterType
} from '../services/rag-ranking.js';
import { isQuarantined, normalizeClassIds } from '../services/vector-audit.js';
import { excludeRetiredMatches, partitionMaterialsByRetirement } from '../services/material-retirement.js';
import {
    resolveRagGenerationConfig, describeGenerationConfig, DETERMINISM,
} from '../services/rag-generation-config.js';
const MIN_HISTORY_TURNS = CONFIG.history.minTurns;
const MAX_HISTORY_TURNS = CONFIG.history.maxTurns;
const DEFAULT_HISTORY_TURNS = CONFIG.history.defaultTurns;
// #410: el hilo viaja también al prompt de respuesta, así que hay que acotarlo:
// un turno largo (respuesta completa del asistente) no puede comerse el
// presupuesto de contexto del turno actual.
const MAX_HISTORY_TURN_CHARS = CONFIG.history.maxTurnChars;
const MAX_HISTORY_CHARS = CONFIG.history.maxChars;
const MAX_HISTORY_SOURCES_PER_TURN = 5;

function sanitizeHistorySource(source) {
    if (!source || typeof source !== 'object') return null;
    const pick = (value) => (typeof value === 'string' ? value.trim().slice(0, 160) : '');
    const sourceFilename = pick(source.sourceFilename);
    const slideTitle = pick(source.slideTitle);
    if (!sourceFilename && !slideTitle) return null;
    const materialType = pick(source.materialType);
    return {
        sourceFilename: sourceFilename || null,
        slideTitle: slideTitle || null,
        materialType: materialType || null,
    };
}

function sanitizeTurn(turn) {
    if (!turn || typeof turn !== 'object') return null;
    const role = turn.role === 'assistant' ? 'assistant' : turn.role === 'user' ? 'user' : null;
    const content = typeof turn.content === 'string' ? turn.content.trim() : '';
    if (!role || !content) return null;
    // #410: las fuentes citadas por el asistente son la bibliografía del hilo.
    // Sin ellas, "¿qué bibliografía respalda lo anterior?" sólo puede repetir el
    // texto de la respuesta previa, no nombrar los materiales.
    const sources = role === 'assistant' && Array.isArray(turn.sources)
        ? turn.sources.map(sanitizeHistorySource).filter(Boolean).slice(0, MAX_HISTORY_SOURCES_PER_TURN)
        : [];
    return sources.length > 0 ? { role, content, sources } : { role, content };
}

function normalizeConversationHistory(rawHistory, requestedWindowSize) {
    if (!Array.isArray(rawHistory) || rawHistory.length === 0) return [];
    const parsedWindow = Number.isInteger(requestedWindowSize) ? requestedWindowSize : DEFAULT_HISTORY_TURNS;
    const boundedWindow = Math.max(MIN_HISTORY_TURNS, Math.min(MAX_HISTORY_TURNS, parsedWindow));
    const turns = rawHistory
        .map(sanitizeTurn)
        .filter(Boolean)
        .slice(-boundedWindow)
        .map((turn) => (turn.content.length > MAX_HISTORY_TURN_CHARS
            ? { ...turn, content: `${turn.content.slice(0, MAX_HISTORY_TURN_CHARS).trimEnd()}…` }
            : turn));

    // Presupuesto total: se descartan los turnos más viejos hasta entrar en el tope.
    let totalChars = turns.reduce((sum, turn) => sum + turn.content.length, 0);
    while (turns.length > 1 && totalChars > MAX_HISTORY_CHARS) {
        totalChars -= turns[0].content.length;
        turns.shift();
    }
    return turns;
}

async function rewriteQuestionWithHistory(question, conversationHistory, context) {
    if (!conversationHistory.length) return question;

    const rewritePrompt = await getActivePrompt('rewrite').catch(() => null);
    const rewriteSystemPrompt = rewritePrompt?.content || `Reescribe la ultima pregunta del estudiante para que sea autonoma y clara.
Debes conservar fielmente el significado original sin agregar informacion nueva.
Devuelve unicamente la pregunta reescrita en espanol, sin comillas ni explicaciones.`;

    const historyText = conversationHistory
        .map((turn, index) => `${index + 1}. ${turn.role === 'assistant' ? 'Asistente' : 'Estudiante'}: ${turn.content}`)
        .join('\n');

    const rewriteMessages = [
        { role: 'system', content: rewriteSystemPrompt },
        {
            role: 'user',
            content: `Historial reciente:\n${historyText}\n\nPregunta actual: ${question}`,
        },
    ];

    try {
        const rewriteModel = rewritePrompt?.model || await resolveModelForTask('rewrite');
        const rewritten = await chatCompletion(rewriteMessages, false, {
            model: rewriteModel,
            temperature: 0,
            max_tokens: 120,
            headers: context?.dependencyHeaders,
        });
        const rewrittenQuestion = rewritten?.content?.trim();
        if (!rewrittenQuestion) return question;
        context.log(`[RAG] Follow-up rewrite aplicado: "${question}" -> "${rewrittenQuestion}"`);
        return rewrittenQuestion;
    } catch (err) {
        context.error('[RAG] Error reescribiendo follow-up. Se usa pregunta original:', err);
        return question;
    }
}

function formatHistorySource(source) {
    const parts = [source.slideTitle, source.sourceFilename].filter(Boolean);
    return parts.join(' — ');
}

// #410: el historial del hilo viaja al prompt de RESPUESTA como turnos reales.
// Antes sólo alimentaba la reescritura de la pregunta, así que el modelo no veía
// el intercambio previo y contestaba que no tenía acceso a él.
function buildConversationMessages(conversationHistory) {
    const messages = [];
    for (const turn of conversationHistory) {
        let content = turn.content;
        if (turn.role === 'assistant' && Array.isArray(turn.sources) && turn.sources.length > 0) {
            const cited = turn.sources.map(formatHistorySource).filter(Boolean);
            if (cited.length > 0) content = `${content}\n\n[Fuentes citadas en este turno: ${cited.join(' · ')}]`;
        }
        const previous = messages[messages.length - 1];
        // Se fusionan turnos consecutivos del mismo rol: algunos proveedores no
        // aceptan dos mensajes seguidos con el mismo rol.
        if (previous && previous.role === turn.role) {
            previous.content = `${previous.content}\n\n${content}`;
        } else {
            messages.push({ role: turn.role, content });
        }
    }
    return messages;
}

// Instrucción que habilita el hilo dentro de un prompt gobernado que pide
// responder sólo con <contexto_rag>. Sin ella el modelo sigue negándose aunque
// los turnos previos estén en la conversación.
function buildThreadInstruction({ hasThreadAnswer, hasFreshMaterial }) {
    if (!hasThreadAnswer) return '';
    const base = `\n\n<hilo_de_conversacion>
Esta consulta continua un hilo abierto: los turnos previos de la conversacion estan en este mismo intercambio, antes de la pregunta actual, y las fuentes que se citaron en cada respuesta anterior aparecen entre corchetes al final de ese turno.
Cuando la pregunta retome lo ya conversado ("lo anterior", "eso", "la respuesta previa", "la bibliografia que mencionaste"), responde usando esos turnos y nombra esas fuentes si hacen falta.
No respondas que no tenes acceso al intercambio previo ni pidas que se repita la pregunta: el hilo esta disponible.`;
    const noFreshMaterial = hasFreshMaterial
        ? ''
        : `\nLa busqueda no devolvio fragmentos nuevos de los materiales para esta pregunta. Si la respuesta ya esta en el hilo, respondela desde el hilo y aclara que proviene de lo respondido antes en esta conversacion. Si no esta en el hilo, responde exactamente: "No encontre informacion sobre eso en los materiales seleccionados."`;
    return `${base}${noFreshMaterial}\n</hilo_de_conversacion>`;
}

// #410: señales de que el turno retoma lo ya conversado. Con hilo y sin material
// nuevo, sólo una pregunta de este tipo justifica pagar una generación: una
// consulta nueva que no encontró material sigue rechazándose sin llamar al modelo.
const THREAD_REFERENTIAL_SIGNALS = [
    'lo anterior', 'lo previo', 'lo dicho', 'lo que se respondio', 'lo que respondiste',
    'la respuesta anterior', 'la respuesta previa', 'tu respuesta', 'el hilo', 'este hilo',
    'ese hilo', 'mencionaste', 'mencionamos', 'dijiste', 'dijimos', 'respondiste', 'respondimos',
    'eso', 'esto', 'esos', 'esas', 'ese', 'esa', 'aquello', 'aquel', 'aquella',
    'antes', 'anterior', 'anteriores', 'anteriormente', 'previo', 'previa', 'previamente',
    'la bibliografia',
];

function normalizeForSignal(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isThreadFollowUp(...texts) {
    return texts.some((text) => {
        const normalized = normalizeForSignal(text);
        return THREAD_REFERENTIAL_SIGNALS.some((signal) => new RegExp(`\\b${signal}\\b`).test(normalized));
    });
}

function jsonResponse(status, payload) {
    return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    };
}

const GLOSSARY_NOT_FOUND_MSG = 'No encontré ese término en el glosario de la materia. ¿Querés preguntarle al docente que lo agregue?';

/**
 * #358/UJ-22: la abstención ("el material no alcanza") es una decisión del
 * backend, no una coincidencia literal en el texto del modelo. Se expone como
 * bandera explícita `abstained` en los eventos SSE (`metadata`/`done`) y en el
 * payload JSON para que la UI deje constancia de la pregunta sin respuesta de
 * forma consistente, sin re-derivarla por substring del texto del modelo.
 *
 * Cubre los motivos reales de abstención: sin contexto (`no_context`), rechazo
 * redactado por el modelo (`refusal_answer`), respuesta vacía (`empty_answer`) y
 * término ausente del glosario.
 */
const ABSTENTION_SIGNALS = [
    'no encontre informacion',
    'no encuentro informacion',
    'no tengo informacion',
    'no pude encontrar',
    'no se encontraron materiales',
    'no hay informacion disponible',
    'no esta disponible en los materiales',
    'no encontre ese termino',
];

export function isAbstentionAnswer(answer) {
    const trimmed = String(answer || '').trim();
    if (!trimmed) return true; // empty_answer
    // Insensible a tildes: el rechazo canónico del backend no las lleva, pero el
    // modelo puede redactar "No encontré información…".
    const lower = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return ABSTENTION_SIGNALS.some((s) => lower.includes(s));
}

/**
 * Construye la respuesta del fast-path de glosario (Story 11.1.6).
 * Determinística: devuelve la definición del término (o el mensaje de
 * "no encontrado" del AC) sin embedding ni LLM, marcando el badge
 * `glossary` en la metadata SSE / payload JSON para que la UI renderice
 * "📖 Glosario".
 */
function buildGlossaryResponse({ answer, glossaryMeta, stream }) {
    // #358/UJ-22: el término ausente del glosario también es una abstención; la
    // definición encontrada, no.
    const abstained = answer === GLOSSARY_NOT_FOUND_MSG;
    // #408: la declaración de configuración también viaja acá. Este camino no
    // llama al modelo (la definición es fija), así que lo declara tal cual: así
    // nadie compara una abstención del glosario contra una del modelo.
    const generation = resolveRagGenerationConfig({ determinism: DETERMINISM.GLOSSARY });
    if (stream) {
        const encoder = new TextEncoder();
        const interactionId = uuidv4();
        const responseStream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify({ interactionId, sources: [], glossary: glossaryMeta, abstained, model: getChatModelName(), generation })}\n\n`));
                controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ content: answer })}\n\n`));
                controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ answer, abstained, generation })}\n\n`));
                controller.close();
            }
        });
        return {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
            body: responseStream,
        };
    }
    return jsonResponse(200, { id: uuidv4(), answer, sources: [], glossary: glossaryMeta, abstained, generation });
}

/**
 * Detecta una consulta de definición de término ("¿qué significa X?") y
 * extrae el término buscado. Devuelve el término o null si no aplica.
 *
 * #571: el charset incluye los separadores que forman parte de un término
 * (`-`, `.`, `/`, `()`, `+`, `#`). Antes el guion cortaba la captura y
 * `QAW-2610182111` se buscaba como `QAW`, que matcheaba cualquier otra entrada
 * del glosario con ese prefijo. La coma queda afuera porque separa una lista de
 * términos ("DDD, CQRS y hexagonal") y no es parte de ninguno.
 */
export function extractGlossaryTerm(question) {
    const glossaryPattern = /(?:qu[eé]\s*significa|qu[eé]\s*es|definici[oó]n\s*de|definime|explic[aá]|significado\s*de)\s+["“«]?([\w\sáéíóúñüÁÉÍÓÚÑÜ./()+#-]+)/i;
    const match = question.match(glossaryPattern);
    if (!match?.[1]) return null;
    const term = match[1]
        .replace(/^[\s"“«]+/u, '')
        .replace(/[\s.,;:!?¿¡"”»]+$/u, '')
        .trim();
    return term || null;
}

/**
 * Construye el bloque <preferencias_asistente> a partir de las preferencias
 * de tono/longitud del alumno (story #223 / 11-5-1). Devuelve '' si no hay
 * preferencias configuradas.
 */
function buildPreferencesBlock({ botTone, botLength, includeSources }) {
    const instructions = [];

    const TONE = {
        formal: 'Usá un tono formal y académico, sin coloquialismos.',
        didactic: 'Usá un tono didáctico y cercano, explicando los conceptos paso a paso.',
        concise: 'Usá un tono directo y resumido, yendo al punto sin rodeos.',
    };
    const LENGTH = {
        concise: 'Respondé de forma concisa. Usá breves párrafos y evitá desarrollos extensos.',
        detailed: 'Respondé de forma detallada y completa, desarrollando los conceptos con profundidad.',
    };

    if (TONE[botTone]) instructions.push(TONE[botTone]);
    if (LENGTH[botLength]) instructions.push(LENGTH[botLength]);
    if (includeSources === false) {
        instructions.push('No enumeres ni listes las fuentes en la respuesta.');
    }

    if (instructions.length === 0) return '';

    return `\n\n<preferencias_asistente>\n${instructions.map(i => `- ${i}`).join('\n')}\n</preferencias_asistente>`;
}

function buildPineconeFilter(subjectId, classIds, disableBibliographyFallback = false) {
    // Todo filtro RAG excluye vectores cuarentenados (defense-in-depth, Story 10.17).
    // El campo `quarantined` es always-present tras una corrida de normalizacion,
    // de modo que `{ $ne: true }` solo excluye los marcados en cuarentena.
    if (!classIds || classIds.length === 0 || classIds.includes('all')) {
        return { subjectId: { $eq: subjectId }, quarantined: { $ne: true } };
    }

    const isSingleClass = classIds.length === 1 && classIds[0] !== 'all';

    const clauses = [];

    if (isSingleClass) {
        // #389: un material puede pertenecer a más de un encuentro. Los vectores
        // guardan `classId` (escalar: la primera clase) y `classIds` (lista con todas).
        // Con el alcance acotado a un solo encuentro hay que mirar las dos formas; si
        // no, un material asociado a dos encuentros sólo se alcanza desde el primero
        // (y sigue alcanzándose desde el primero aunque se lo hayan quitado).
        clauses.push({ classId: { $eq: classIds[0] } }, { classIds: { $in: [classIds[0]] } });
    } else {
        clauses.push({ classIds: { $in: classIds } });
    }

    if (!disableBibliographyFallback) {
        // #399: el fallback de bibliografía ya NO abre la materia entera cuando
        // el alcance está acotado — era la vía de fuga (la bibliografía de la
        // Clase 5 entraba con alcance Clase 1).
        // La bibliografía de las clases seleccionadas alcanza por las cláusulas
        // de clase de arriba; este fallback sólo cubre la bibliografía SIN clase
        // asignada (classId vacío: material legado — el alta exige classIds y la
        // auditoría marca metadata-incomplete, pero se conserva para no perder
        // recall si aún existe). La de otro encuentro no entra.
        clauses.push({ materialType: { $eq: 'bibliography' }, classId: { $eq: '' } });
    }

    return {
        subjectId: { $eq: subjectId },
        $or: clauses,
        quarantined: { $ne: true },
    };
}

/**
 * Set de clases explícitas de un vector (#399): usa `classIds` (lista) o, si
 * no hay lista, el escalar `classId`. Devuelve [] cuando el vector no trae
 * información de clase (caso mismatch-only: no se descarta por esa sola razón).
 */
function vectorClassSet(metadata) {
    const meta = metadata || {};
    return normalizeClassIds(meta.classIds ?? (meta.classId ? [meta.classId] : []));
}

// #380 / UJ-21 / UJ-27: la etiqueta legible de la evidencia. El vector de una
// respuesta verificada guarda su etiqueta en `metadata.title` (verify-answer),
// mientras que los materiales normales la guardan en `metadata.slideTitle`. La
// vía estándar sólo leía `slideTitle`, así que un fragmento `verified-answer`
// recuperado como fuente de una respuesta normal caía al `sourceFilename`
// interno (`correction-<uuid>`) y la persona no podía reconocer el material.
// Acá se resuelve la misma etiqueta legible en TODAS las vías.
function resolveSourceSlideTitle(metadata) {
    const meta = metadata || {};
    if (meta.slideTitle) return meta.slideTitle;
    if (meta.materialType === 'verified-answer') return meta.title || 'Respuesta verificada por el docente';
    return undefined;
}

function handleErrorResponse(status, message, category, isStream, code = null) {
    if (isStream) {
        const encoder = new TextEncoder();
        // #338: propagate the machine-readable error code through the SSE
        // path so the UI can distinguish CONSENT_REQUIRED (terms CTA) from
        // generic AUTH denials instead of falling back to the wrong copy.
        const payload = { error: message, errorCategory: category };
        if (code) payload.code = code;
        const body = JSON.stringify(payload);
        const responseStream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(`event: error\ndata: ${body}\n\n`));
                controller.close();
            }
        });
        return {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
            },
            body: responseStream
        };
    }
    const payload = { error: message, errorCategory: category };
    if (code) payload.code = code;
    return jsonResponse(status, payload);
}

app.http('rag-query', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'rag-query',
    handler: withCorrelation(withRateLimit(withAuth(async (request, context) => {
        const { correlationId, dependencyHeaders } = context;

        const log = createStructuredLogger('rag-query', context);
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
        log.info('rag-query triggered');
        const user = context.user || getAuthenticatedUser(request);
        const userId = user?.userId || 'anonymous';
        const sanitizedId = user?.sanitizedId || String(userId).replace(/[^a-zA-Z0-9]/g, '_');
        log.info('RAG query start', { correlationId, userId });

        // ── 0. Identidad resuelta (fail closed, #481) ─────────────────────
        // Los guards de matrícula y consentimiento llevan `&& principal`, así
        // que con `principal === null` (nadie resolvió identidad) ninguno de los
        // dos se evaluaba y la consulta seguía al pipeline: el anónimo consumía
        // modelo pagado y saltaba matrícula y consentimiento. `getAuthenticatedUser`
        // nunca devuelve null —fabrica { userId: 'anonymous', role: 'Anonymous'}—
        // por eso la comprobación va sobre la identidad resuelta, no sobre la
        // existencia de un objeto. Mismo criterio que los tres cierres de #434.
        if (!hasResolvedIdentity(user)) {
            log.info('rag-query denied: sin identidad resuelta');
            return jsonResponse(401, {
                error: 'AUTH_REQUIRED',
                message: 'Se requiere autenticación para consultar al asistente.',
                errorCategory: 'AUTH',
            });
        }

        // Capture start time for end-to-end latency measurement (Issue #69)
        const startTime = Date.now();

        // ── 1. Parsear request ────────────────────────────────────
        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse(400, { error: 'Body JSON inválido' });
        }

        const { question, classIds, subjectId, sessionId, stream = false, conversationHistory, historyWindowSize, transcriptFocus, sandbox = false, simulateStudent = false, botTone, botLength, includeSources, promptVersion } = body;

        if (!question || !subjectId) {
                return jsonResponse(400, { error: 'Faltan campos requeridos: question, subjectId' });
        }

        const recentConversationHistory = normalizeConversationHistory(conversationHistory, historyWindowSize);
        // #410: si el hilo ya tiene una respuesta previa, el turno actual puede
        // apoyarse en ella aunque la búsqueda no devuelva fragmentos nuevos.
        const hasThreadAnswer = recentConversationHistory.some((turn) => turn.role === 'assistant');

        const principal = context.principal || parseClientPrincipal(request);
        const userRoles = principal?.userRoles || [];
        const isTeacherOrDirector = userRoles.includes('Docente') || userRoles.includes('Director');

        // ── 1b. Sandbox mode (teacher RAG playground) ────────────────────
        // sandbox is accepted via query string (?sandbox=true) OR body. When
        // active, enrollment + consent gates are bypassed unconditionally and
        // the teacher subject scope (subjectId/classIds) drives retrieval.
        const sandboxMode = sandbox === true || request.query?.get?.('sandbox') === 'true';
        const simulateStudentMode = sandboxMode && simulateStudent === true;

        // ── 1b2. Sandbox requires Docente/Director role ─────────────────
        // The frontend route is teacher-only (client-side guard), but the backend
        // is authLevel:anonymous — so the role must be verified server-side to
        // prevent students from bypassing enrollment/consent/reviewed filters.
        if (sandboxMode && principal && !isTeacherOrDirector) {
            context.log(`[RAG] Sandbox denied: no es Docente/Director. userId=${userId}, subjectId=${subjectId}`);
            return jsonResponse(403, {
                error: 'SANDBOX_FORBIDDEN',
                message: 'El sandbox de RAG solo está disponible para docentes y directores.',
            });
        }

        if (sandboxMode) {
            context.log(`[RAG] Sandbox mode active: userId=${userId}, subjectId=${subjectId}, simulateStudent=${simulateStudentMode}`);
        }

        // ── 1c. Enrollment access check ──────────────────────────────────
        const enrollment = await getEnrollment(subjectId, userId).catch(() => null);


        if (!sandboxMode && !isTeacherOrDirector && principal) {
            if (!enrollment || enrollment.status !== 'active') {
                context.log(`[Enrollment] Access denied: userId=${userId}, subjectId=${subjectId}`);
                return jsonResponse(403, {
                    error: 'ENROLLMENT_REQUIRED',
                    message: 'No estás matriculado en esta materia. Contactá a administración.',
                });
            }
        }

        // ── 1d. AI content consent check ────────────────────────────────
        if (!sandboxMode && !isTeacherOrDirector && principal) {
            const consentAccepted = await getConsentStatus(userId).catch(() => false);
            if (!consentAccepted) {
                context.log(`[Consent] Consent required: userId=${userId}`);
                return jsonResponse(403, {
                    success: false,
                    error: { code: 'CONSENT_REQUIRED', message: 'Debés aceptar los términos de uso antes de usar el chat.', errorCategory: 'AUTH' },
                    meta: { timestamp: new Date().toISOString(), requestId: correlationId },
                });
            }
        }

        const rewrittenQuestion = await rewriteQuestionWithHistory(question, recentConversationHistory, context);

        context.log(`Pregunta: "${question}" | Reescrita: "${rewrittenQuestion}" | Materia: ${subjectId} | Clases: ${classIds?.join(',') || 'todas'} | Session: ${sessionId || 'auto'}`);

        // ── 1e. Glossary fast-path (Story 11.1.6) ──────────────────
        // Si la pregunta pide la definición de un término ("¿qué significa X?")
        // y la materia tiene glosario, se responde determinísticamente desde el
        // glosario: definición con badge 📖 Glosario. Si no hay glosario
        // configurado se cae al pipeline RAG normal.
        //
        // #349: el glosario es un atajo por ACIERTO, no un cortocircuito por
        // FALLO. Si el término no está en el glosario, la consulta definicional
        // sigue por el pipeline RAG (el material puede cubrirla perfectamente);
        // el mensaje de "no encontré ese término" se usa recién como último
        // recurso, cuando la recuperación de material vuelve vacía.
        const glossaryLookupTerm = extractGlossaryTerm(rewrittenQuestion || question);
        let glossaryMissTerm = null;
        if (glossaryLookupTerm) {
            try {
                const glossary = await getGlossary(subjectId);
                if (glossary && Array.isArray(glossary.terms) && glossary.terms.length > 0) {
                    const found = resolveGlossaryTerm(glossary.terms, glossaryLookupTerm);
                    if (found) {
                        const definition = String(found.definition || '').trim();
                        const answer = definition
                            ? `**${found.term}**: ${definition}`
                            : `**${found.term}** está en el glosario de la materia, pero el docente aún no cargó su definición.`;
                        context.log(`[RAG] Glossary fast-path HIT: term="${found.term}" subjectId=${subjectId}`);
                        return buildGlossaryResponse({
                            answer,
                            glossaryMeta: { found: true, term: found.term, definition },
                            stream,
                        });
                    }
                    // MISS: no cortocircuitar; recordar el término y seguir al RAG.
                    glossaryMissTerm = glossaryLookupTerm;
                    context.log(`[RAG] Glossary fast-path MISS (fall-through a RAG): term="${glossaryLookupTerm}" subjectId=${subjectId}`);
                }
            } catch (glossaryErr) {
                context.warn('[RAG] Error loading glossary (non-blocking):', glossaryErr.message);
            }
        }

        // ── 2. Embedding de la pregunta ───────────────────────────
        let questionEmbedding;
        let embeddingUsage;
        try {
            const embeddingResult = await generateEmbedding(rewrittenQuestion, { headers: dependencyHeaders });
            questionEmbedding = embeddingResult.embedding;
            embeddingUsage = embeddingResult.usage;
        } catch (err) {
            const categorizedError = normalizeCategorizedError(err, ErrorCategory.LLM);
            context.error('Error generando embedding:', categorizedError);
            trackRAGError({
                errorCategory: categorizedError.errorCategory,
                code: categorizedError.code,
                message: categorizedError.message,
                subjectId,
                userId,
                correlationId,
                stackTrace: err?.stack,
            }).catch(e => context.error('[Telemetry] Error emitting RAGErrorCategorized (embedding):', e));
            return handleErrorResponse(categorizedError.status, `Error procesando la pregunta (embedding): ${categorizedError.message}`, categorizedError.errorCategory, stream, categorizedError.code);
        }

        // ── 3. Filtro Pinecone por subjectId y classIds ───────────
        const disableBibliographyFallback = process.env.RAG_DISABLE_BIBLIOGRAPHY_FALLBACK === 'true';
        const filter = buildPineconeFilter(subjectId, classIds, disableBibliographyFallback);
        const filterType = resolveFilterType(classIds);

        // #399: alcance por clase acotado (null = alcance de materia entera:
        // classIds vacío o con 'all'). Se usa para acotar también el fast path
        // de respuestas verificadas y para el post-filter de clase (4a3).
        const classScope = Array.isArray(classIds) && classIds.length > 0 && !classIds.includes('all')
            ? classIds.map(String)
            : null;

        // ── 3b. Verified-answer-first pre-search ──────────────────
        const VERIFIED_SCORE_THRESHOLD = 0.85;
        const verifiedFilter = {
            subjectId: { $eq: subjectId },
            materialType: { $eq: 'verified-answer' },
            quarantined: { $ne: true },
        };

        let verifiedMatch = null;
        let verifiedAnswerText = '';

        try {
            const verifiedMatches = await querySimilar(questionEmbedding, verifiedFilter, 5, { correlationId });
            // Pass-6 fix: buscar el primer match no-cuarentenado por encima del
            // umbral (no solo el top-1), para que un match cuarentenado rank-1 no
            // eclipse a un verified-answer limpio rank-2 (defense-in-depth).
            const topVerified = verifiedMatches.find((m) => !isQuarantined(m.metadata) && m.score > VERIFIED_SCORE_THRESHOLD);
            // Loopback 1/4.3: un verifiedMatch cuarentenado se descarta (el fast
            // path no debe devolver contenido que pudo quedar flaggeado).
            if (topVerified) {
                // #399: con alcance acotado a una clase, la respuesta verificada
                // sólo sirve si su clase pertenece al alcance — un `correction-<uuid>`
                // de otro encuentro es material de otro encuentro. Mismatch-only:
                // si no trae clase explícita, se conserva (su caso lo resuelve el
                // runner de cuarentena) para no romper el recall del fast path.
                const verifiedClasses = vectorClassSet(topVerified.metadata);
                if (classScope && verifiedClasses.length > 0 && !verifiedClasses.some((c) => classScope.includes(String(c)))) {
                    context.log(`[RAG] Verified answer fuera de alcance (classId=[${verifiedClasses.join(',')}] vs alcance [${classScope.join(',')}]) — se omite el fast path (#399)`);
                } else {
                    verifiedMatch = topVerified;
                    verifiedAnswerText = topVerified.metadata?.text || topVerified.metadata?.correctedAnswer || '';
                    context.log(`[RAG] Verified answer match (score=${topVerified.score.toFixed(3)}) — bypassing LLM`);
                }
            }
        } catch (err) {
            context.error('[RAG] Error in verified-answer pre-search (non-blocking):', err);
        }

        if (verifiedMatch && verifiedAnswerText) {
            context.log('[RAG] Returning verified answer — skipping standard search and LLM');
            const verifiedSources = [{
                materialType: 'verified-answer',
                subjectId: verifiedMatch.metadata?.subjectId,
                classId: verifiedMatch.metadata?.classId ?? verifiedMatch.metadata?.classIds?.[0],
                chunkIndex: 0,
                sourceFilename: verifiedMatch.metadata?.sourceFilename || '',
                // #380 (UJ-27): la persona tiene que reconocer la evidencia. El
                // identificador interno (correction-<uuid>) queda sólo para uso
                // interno; lo que se muestra es esto.
                slideTitle: resolveSourceSlideTitle(verifiedMatch.metadata),
                score: Math.round(verifiedMatch.score * 100) / 100,
            }];
            const interactionId = uuidv4();

            if (stream) {
                const responseStream = new ReadableStream({
                    start(controller) {
                        const encoder = new TextEncoder();
                        controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify({ interactionId, sources: verifiedSources, verified: true, verifiedBy: verifiedMatch.metadata?.teacherId, model: getChatModelName() })}\n\n`));
                        controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ content: verifiedAnswerText })}\n\n`));
                        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ answer: verifiedAnswerText })}\n\n`));
                        controller.close();
                    }
                });
                return {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                    },
                    body: responseStream,
                };
            }

            return jsonResponse(200, { id: interactionId, answer: verifiedAnswerText, sources: verifiedSources, verified: true, verifiedBy: verifiedMatch.metadata?.teacherId });
        }

        // ── 3c. Cargar pesos de material type por materia ────────
        let materialWeights = null;
        try {
            const weightResult = await getSubjectWeights(subjectId);
            materialWeights = weightResult.weights;
        } catch (weightErr) {
            context.error('[RAG] Error loading subject weights (non-blocking):', weightErr);
        }

        // ── 4. Búsqueda de similitud en Pinecone ──────────────────
        let matches;
        try {
            matches = await querySimilar(questionEmbedding, filter, RETRIEVAL_CANDIDATES, { correlationId });
        } catch (err) {
            const categorizedError = normalizeCategorizedError(err, ErrorCategory.RETRIEVAL_FAILURE);
            context.error('Error consultando Pinecone:', categorizedError);
            trackRAGError({
                errorCategory: categorizedError.errorCategory,
                code: categorizedError.code,
                message: categorizedError.message,
                subjectId,
                userId,
                classIds,
                correlationId,
                stackTrace: err?.stack,
            }).catch(e => context.error('[Telemetry] Error emitting RAGErrorCategorized (Pinecone):', e));
            return handleErrorResponse(categorizedError.status, `Error buscando en la base de conocimiento: ${categorizedError.message}`, categorizedError.errorCategory, stream, categorizedError.code);
        }

        matches = filterMatchesByTranscriptFocus(matches, transcriptFocus);

        // ── 4a. Post-filter de cuarentena (defense-in-depth) ───────
        // Incluso si el filtro de Pinecone fallara o la propagacion de metadata
        // estuviera incompleta, un source cuarentenado no debe llegar al LLM.
        const preQuarantineCount = matches.length;
        matches = matches.filter((m) => !isQuarantined(m.metadata));
        if (matches.length !== preQuarantineCount) {
            const dropped = preQuarantineCount - matches.length;
            context.log(`[RAG] Quarantine post-filter: se descartaron ${dropped} matches cuarentenados (subjectId=${subjectId}, correlationId=${correlationId})`);
        }

        // ── 4a2. Post-filter de subjectId (#328, mismatch-only) ────
        // Vectores mal etiquetados (ej: DASI/test.txt con subjectId de otra
        // materia) no deben llegar al LLM aunque el filtro Pinecone los haya
        // devuelto. Solo se descartan los que traen un subjectId explícito
        // distinto; los que no traen subjectId quedan sujetos al runner de
        // cuarentena (vector-audit metadata-incomplete) sin romper el recall.
        const preSubjectCount = matches.length;
        matches = matches.filter((m) => !m.metadata?.subjectId || String(m.metadata.subjectId) === String(subjectId));
        if (matches.length !== preSubjectCount) {
            const dropped = preSubjectCount - matches.length;
            context.log(`[RAG] Subject post-filter: se descartaron ${dropped} matches fuera de subjectId=${subjectId} (correlationId=${correlationId})`);
        }

        // ── 4a3. Post-filter de alcance por clase (#399, mismatch-only) ──
        // Con alcance acotado a uno o más encuentros, un vector con información
        // de clase explícita que NO intersecta el alcance no debe llegar al LLM:
        // era la fuga de #399 (la bibliografía de la Clase 5 entraba con alcance
        // Clase 1 por el fallback del filtro). Mismatch-only, igual que #328:
        // los que no traen clase se dejan pasar (su caso lo resuelve el runner
        // de cuarentena, vector-audit metadata-incomplete) sin romper el recall.
        if (classScope) {
            const preClassCount = matches.length;
            matches = matches.filter((m) => {
                const vectorClasses = vectorClassSet(m.metadata);
                return vectorClasses.length === 0 || vectorClasses.some((c) => classScope.includes(String(c)));
            });
            if (matches.length !== preClassCount) {
                const dropped = preClassCount - matches.length;
                context.log(`[RAG] Class post-filter: se descartaron ${dropped} matches fuera del alcance [${classScope.join(',')}] (subjectId=${subjectId}, correlationId=${correlationId})`);
            }
        }

        // ── 4b. Filtrar materiales no revisados y fuentes retiradas ───
        let priorityMap = {};
        try {
            const allMaterials = await listMaterialsBySubject(subjectId);

            // #328: un vector cuyo material no está registrado en la materia no
            // puede alimentar una respuesta. Son vectores que quedaron en el
            // índice con el `subjectId` equivocado (el propio índice los clasifica
            // `orphan`: «no hay registro autoritativo — material de otra materia»)
            // y su contenido es de otra unidad. Medido contra el entorno: una
            // consulta de alumno acotada a `arq-software-2026/class-02` citaba el
            // cronograma de otra asignatura (FACE/DEARH, LAUDON) porque ese vector
            // llevaba `subjectId` de esta materia con clases de la otra.
            //
            // El filtro de revisión de abajo NO los cubría: se saltea cuando la
            // materia no tiene ningún material revisado —que es el estado real del
            // entorno— «para no bloquear el chat», y por esa puerta entraban. Este
            // filtro no se saltea: si el registro cargó, el registro manda.
            // ── Registro autoritativo de la unidad (#328) ─────────────
            // Un vector cuya metadata no cierra contra el registro de la unidad
            // no puede alimentar una respuesta: son vectores que quedaron en el
            // índice con el `subjectId` equivocado (el propio índice los clasifica
            // `orphan`/`mismatch`) y su contenido es de otra unidad. Medido contra
            // el entorno: una consulta de alumno acotada a
            // `arq-software-2026/class-02` citaba el cronograma de otra asignatura
            // (FACE/DEARH, LAUDON) como bibliografía de la Clase 2.
            //
            // Tres estados que antes se confundían en uno:
            //   1. la lectura del registro falló → no se puede juzgar: se deja
            //      pasar y se registra el error (lo cubre el catch de abajo);
            //   2. el registro resolvió vacío → no alcanza para juzgar por
            //      material, así que se juzga por las clases de la unidad;
            //   3. el registro resolvió con contenido → manda el registro.
            // En los casos 2 y 3, si algo se descarta, se levanta el aviso a
            // docentes y dirección: el índice quedó sucio y hay que regularizarlo.
            const registrados = new Set(
                allMaterials.map(m => String(m.materialId || m.id || '')).filter(Boolean)
            );
            let clasesDeLaUnidad = new Set();
            if (registrados.size === 0) {
                try {
                    const clases = await listClassesBySubject(subjectId);
                    clasesDeLaUnidad = new Set(
                        clases.map(c => String(c.id || c.classId || '')).filter(Boolean)
                    );
                } catch (err) {
                    context.error?.('[RAG] No se pudieron leer las clases de la unidad para validar el índice:', err);
                }
            }
            if (registrados.size > 0 || clasesDeLaUnidad.size > 0) {
                const antesDelFiltro = matches.length;
                const materialesAjenos = new Set();
                const clasesAjenas = new Set();
                matches = matches.filter((m) => {
                    const materialId = String(m.metadata?.materialId || '');
                    const clasesDelVector = (Array.isArray(m.metadata?.classIds) ? m.metadata.classIds : [])
                        .map(c => String(c)).filter(Boolean);
                    const materialFuera = registrados.size > 0 && Boolean(materialId) && !registrados.has(materialId);
                    const claseFuera = clasesDeLaUnidad.size > 0
                        && clasesDelVector.some(c => !clasesDeLaUnidad.has(c));
                    if (!materialFuera && !claseFuera) return true;
                    if (materialFuera) materialesAjenos.add(materialId);
                    if (claseFuera) clasesDelVector.forEach(c => { if (!clasesDeLaUnidad.has(c)) clasesAjenas.add(c); });
                    return false;
                });
                if (materialesAjenos.size > 0 || clasesAjenas.size > 0) {
                    context.log(`[RAG] Filtro de registro autoritativo: se descartaron ${antesDelFiltro - matches.length} fragmentos (materiales fuera de la unidad: ${materialesAjenos.size}, clases inexistentes: ${clasesAjenas.size}; subjectId=${subjectId}, registrados=${registrados.size}, correlationId=${correlationId})`);
                    // Docentes y dirección tienen que enterarse: el índice quedó
                    // con material ajeno y hay que regularizarlo. Best-effort: no
                    // bloquea ni demora la respuesta.
                    alertIndexIntegrity({
                        subjectId,
                        droppedMaterialIds: [...materialesAjenos],
                        droppedClassIds: [...clasesAjenas],
                        context,
                    }).catch((e) => context.error?.('[RAG] Error al dejar el aviso de integridad:', e));
                }
            }

            // Construir mapa de prioridades (overrides)
            allMaterials.forEach(m => {
                if (m.priority) {
                    priorityMap[m.materialId || m.id] = m.priority;
                }
            });

            // #391: una fuente retirada deja de alimentar las respuestas. A
            // diferencia del filtro de revisión, el retiro es una decisión explícita
            // del docente sobre esa fuente, así que se aplica también en el sandbox
            // (es exactamente ahí donde se comprueba que ya no se cita).
            const { retiredIds } = partitionMaterialsByRetirement(allMaterials);
            if (retiredIds.size > 0) {
                const beforeRetired = matches.length;
                matches = excludeRetiredMatches(matches, retiredIds);
                retiredIds.forEach((id) => delete priorityMap[id]);
                if (beforeRetired !== matches.length) {
                    context.log(`[RAG] Filtro de retiro: ${beforeRetired} → ${matches.length} matches (${retiredIds.size} fuentes retiradas)`);
                }
            }

            const reviewedMaterialIds = new Set(
                allMaterials.filter(m => m.reviewed === true).map(m => m.materialId || m.id)
            );
            // En sandbox, el modo "Simular alumno" reproduce la vista de estudiante
            // (solo materiales publicados/revisados). El modo docente (default)
            // omite el filtro para poder testear borradores antes de publicar.
            const applyReviewedFilter = !sandboxMode || simulateStudentMode;
            // Si hay al menos un material revisado, filtrar; si no hay ninguno revisado,
            // dejamos pasar todo para no bloquear el chat completamente.
            if (applyReviewedFilter && reviewedMaterialIds.size > 0) {
                const before = matches.length;
                matches = matches.filter(m => reviewedMaterialIds.has(m.metadata?.materialId));
                if (before !== matches.length) {
                    context.log(`[RAG] Filtro de revisión: ${before} → ${matches.length} matches (${reviewedMaterialIds.size} materiales revisados)`);
                }
            } else if (sandboxMode && !simulateStudentMode) {
                context.log(`[RAG] Sandbox teacher preview: omitiendo filtro de revisión (${reviewedMaterialIds.size} revisados, ${matches.length} matches)`);
            }
        } catch (reviewErr) {
            context.error('[RAG] Error obteniendo materiales para filtro/prioridad (no bloqueante):', reviewErr);
        }

        matches = buildHybridContext(matches, MAX_RAG_CHUNKS, priorityMap, materialWeights);
        matches = diversifyBySourceFile(matches);

        const REFUSAL_MESSAGE = "No encontre informacion sobre eso en los materiales seleccionados.";

        // ── 5. Early return if no context found ───────────────────
        // #410: un seguimiento que retoma el hilo no se rechaza por falta de
        // material nuevo: la respuesta puede estar en lo ya respondido. El
        // modelo decide con el hilo delante y mantiene el rechazo si no está.
        const answersFromThread = hasThreadAnswer && isThreadFollowUp(question, rewrittenQuestion);
        if (matches.length === 0 && !answersFromThread) {
            // #349: si la consulta era definicional y no hubo material, se
            // compone el mensaje del glosario ("no encontré ese término") como
            // último recurso; en cualquier otro caso, el rechazo estándar.
            const noMatchAnswer = glossaryMissTerm ? GLOSSARY_NOT_FOUND_MSG : REFUSAL_MESSAGE;
            const noMatchGlossaryMeta = glossaryMissTerm ? { found: false, term: glossaryMissTerm } : null;
            // #408: acá la abstención NO es del muestreo del modelo — no hay
            // fragmentos, así que no se llama al modelo. Se declara como tal para
            // que nadie la compare contra una abstención del modelo sobre
            // evidencia que sí existía.
            const noContextGeneration = resolveRagGenerationConfig({ determinism: DETERMINISM.NO_CONTEXT });
            const noContextDeclaration = {
                evidenceCount: 0,
                abstainedWithEvidence: false,
                generation: noContextGeneration,
            };
            context.log(`[RAG] No matches found for subjectId=${subjectId}. ${glossaryMissTerm ? 'Definitional query: glossary not-found fallback.' : 'Sending refusal stream.'}`);
            // Audit unanswered query (no context) for prompt-injection / knowledge-gap detection (#221).
            trackUnansweredQuery({
                question,
                rewrittenQuestion,
                reason: 'no_context',
                subjectId,
                userId,
                classIds,
                correlationId,
                sourcesCount: 0,
            }).catch(e => context.error('[Telemetry] Error emitting UnansweredQuery (no_context):', e));
            if (stream) {
                const responseStream = new ReadableStream({
                    start(controller) {
                        const encoder = new TextEncoder();
                        // 1. Enviar metadatos vacíos para inicializar el footer.
                        // #358/UJ-22: se marca `abstained: true` para que la UI
                        // deje constancia de la pregunta sin respuesta por el
                        // motivo real (sin contexto), no por coincidencia textual.
                        controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify({ sources: [], abstained: true, model: getChatModelName(), ...noContextDeclaration, ...(noMatchGlossaryMeta ? { glossary: noMatchGlossaryMeta } : {}) })}\n\n`));

                        // 2. Enviar el mensaje como un delta para que la UI lo anime/muestre progresivamente si quiere, 
                        // o al menos use el path más probado del frontend.
                        controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ content: noMatchAnswer })}\n\n`));

                        // 3. Enviar evento final
                        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ answer: noMatchAnswer, abstained: true, ...noContextDeclaration })}\n\n`));
                        controller.close();
                    }
                });
                return {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' },
                    body: responseStream
                };
            } else {
                return jsonResponse(200, {
                    answer: noMatchAnswer,
                    sources: [],
                    abstained: true,
                    ...noContextDeclaration,
                    ...(noMatchGlossaryMeta ? { glossary: noMatchGlossaryMeta } : {}),
                });
            }
        }

        // ── 6. Construir prompt RAG ───────────────────────────────
        const contextText = matches
            .map((m, i) => {
                const n = i + 1;
                const filename = m.metadata?.sourceFilename || 'desconocido';
                const materialType = m.metadata?.materialType || 'material';
                const chunkIndex = Number.isInteger(m.metadata?.chunkIndex) ? m.metadata.chunkIndex : '';
                const header = `<chunk indice="${n}" archivo="${filename}" tipo="${materialType}" chunkIndex="${chunkIndex}">`;
                const body = `${m.metadata?.text || ''}`;
                return `[${n}] ${header}\n${body}\n</chunk>`;
            })
            .join('\n\n');

        const focusClause = transcriptFocus?.label
            ? `\n\n<transcripcion_foco>\n${transcriptFocus.label}\nUsa este foco para priorizar la respuesta sobre esa seccion de la clase.\n</transcripcion_foco>`
            : '';

        let deadlineBlock = '';
        const deadlinePatterns = ['entrega', 'vencimiento', 'deadline', 'fecha', 'semana', 'cuándo', 'próxima', 'próximo'];
        if (deadlinePatterns.some(p => question.toLowerCase().includes(p))) {
            const now = new Date();
            const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

            // ── Entregas del alumno (tareas por estudiante, Story 11.1.5) ──
            // Carga las tareas del alumno desde tasks-config/{studentId}.json
            // (misma fuente que GET /api/tasks) para responder "¿qué entregas
            // tengo esta semana?" con el detalle de la propia entrega.
            const tasksStudentId = user?.id || sanitizedId;
            let studentTasks = [];
            try {
                const savedTasks = await loadJson(CONFIG.containers.tasks, `${tasksStudentId}.json`);
                if (Array.isArray(savedTasks)) studentTasks = savedTasks;
            } catch (taskErr) {
                context.warn(`[RAG] Error loading student tasks (non-blocking) studentId=${tasksStudentId}:`, taskErr.message);
            }

            const pendingSubjectTasks = studentTasks.filter(t =>
                t.subjectId === subjectId &&
                t.status !== 'completed'
            );
            const upcomingTasks = pendingSubjectTasks.filter(t => {
                const due = new Date(t.dueDate);
                return due >= now && due <= weekFromNow;
            });

            let subjectName = subjectId;
            try {
                const subjects = await loadJson(CONFIG.containers.classes, CONFIG.blobs.subjects);
                if (Array.isArray(subjects)) {
                    const found = subjects.find(s => s?.id === subjectId);
                    if (found?.name) subjectName = found.name;
                }
            } catch (subjectErr) {
                context.warn('[RAG] Error loading subjects for deadlines (non-blocking):', subjectErr.message);
            }

            if (upcomingTasks.length > 0) {
                const lines = upcomingTasks
                    .map(t => {
                        const date = new Date(t.dueDate).toLocaleDateString('es-AR');
                        return `- ${t.title} (${subjectName}) — vence el ${date} — [Ver tarea](#/student/tasks)`;
                    })
                    .join('\n');
                deadlineBlock = `\n\n<entregas_semana>\nEntregas de la semana (${subjectName}):\n${lines}\n</entregas_semana>`;
                context.log(`[RAG] Deadline augmentation: ${upcomingTasks.length} student tasks this week for subjectId=${subjectId}, studentId=${tasksStudentId}`);
            } else if (studentTasks.some(t => t.subjectId === subjectId && t.status !== 'completed')) {
                const nextTask = pendingSubjectTasks
                    .filter(t => new Date(t.dueDate) >= now)
                    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
                if (nextTask) {
                    const date = new Date(nextTask.dueDate).toLocaleDateString('es-AR');
                    deadlineBlock = `\n\n<entregas_semana>\nNo tenés entregas esta semana. Tu próxima entrega es ${nextTask.title} el ${date}.\n</entregas_semana>`;
                    context.log(`[RAG] Deadline augmentation: no weekly tasks, next student task subjectId=${subjectId}, studentId=${tasksStudentId}`);
                }
            } else {
                // Fallback: entregas por materia (deadlines/{subjectId}.json)
                try {
                    const deadlines = await loadJson('deadlines', `${subjectId}.json`);
                    if (Array.isArray(deadlines) && deadlines.length > 0) {
                        const upcoming = deadlines.filter(d => {
                            const due = new Date(d.dueDate);
                            return due >= now && due <= weekFromNow;
                        });
                        if (upcoming.length > 0) {
                            deadlineBlock = `\n\n<entregas_semana>\nEntregas de la semana (${subjectName}):\n${upcoming.map(d => `- ${d.title}: vence el ${new Date(d.dueDate).toLocaleDateString('es-AR')}`).join('\n')}\n</entregas_semana>`;
                        } else {
                            const nextDeadline = deadlines
                                .filter(d => new Date(d.dueDate) >= now)
                                .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
                            if (nextDeadline) {
                                deadlineBlock = `\n\n<entregas_semana>\nNo tenés entregas esta semana. Tu próxima entrega es ${nextDeadline.title} el ${new Date(nextDeadline.dueDate).toLocaleDateString('es-AR')}.\n</entregas_semana>`;
                            }
                        }
                    }
                } catch (deadlineErr) {
                    context.warn('[RAG] Error loading deadlines (non-blocking):', deadlineErr.message);
                }
            }
        }

        // ── 6a. Preferencias del asistente (tono/longitud/fuentes) ──
        const preferencesBlock = buildPreferencesBlock({ botTone, botLength, includeSources });

        // Response length cap for concise preference (story #223 / 11-5-1)
        const maxTokens = botLength === 'concise' ? Math.min(CONFIG.ai.maxTokens.chat, 400) : CONFIG.ai.maxTokens.chat;

        // La versión ACTIVA es la que responde a cualquiera (UJ-48 paso 6). El banco de
        // pruebas puede pedir una versión concreta (`promptVersion`) para enfrentarla
        // contra la vigente SIN activarla, y así no llega a ningún hilo real (UJ-49).
        const requestedPromptVersion = sandboxMode
          ? (promptVersion || request.query?.get?.('promptVersion') || null)
          : null;
        const { id: promptId, content: systemPromptBase, source: promptSource } = await resolveRagPrompt({ versionId: requestedPromptVersion });
        if (requestedPromptVersion && promptSource !== 'requested') {
          return jsonResponse(400, {
            error: 'PROMPT_VERSION_NOT_FOUND',
            message: `La versión "${requestedPromptVersion}" no existe para el prompt del asistente.`,
          });
        }
        // Log telemetry explicit event inside standard console output for App Insights Analytics mapping
        context.log(`[PromptGovernance] Respuesta gobernada por versionId=${promptId} (origen=${promptSource}${sandboxMode ? ', sandbox' : ''})`);
        const ragModel = await resolveModelForTask('rag-master');

        // ── #408/UJ-27: configuración de generación DECLARADA ──
        // La respuesta del asistente se generaba con el default del servicio
        // (temperature 0.3) y sin declararlo en ningún lado: dos personas con la
        // misma evidencia podían recibir textos distintos —o una respuesta y una
        // abstención— sin forma de saber que la diferencia era del muestreo.
        // Desde acá la temperatura baja a 0 y el bloque viaja en cada respuesta
        // (metadata SSE, `done`, payload sin stream y log de la interacción), así
        // que la comparación entre dos personas tiene árbitro: mismo modelo,
        // mismos parámetros, misma evidencia → la diferencia es del proveedor.
        const generation = resolveRagGenerationConfig({
            model: ragModel,
            modelLabel: getModelDisplayName(ragModel),
            maxTokens,
            promptVersion: promptId,
        });
        context.log(`[RAG] Generación declarada: ${describeGenerationConfig(generation)}`);

        // ── 6b. Cargar feedback docente (correcciones revisadas) ──
        let teacherFeedbackBlock = '';
        try {
          const reviewedCorrections = await listReviewedCorrections(subjectId);
          if (reviewedCorrections.length > 0) {
            const feedbackEntries = reviewedCorrections
              .slice(0, 5)
              .map((c, i) => {
                const date = c.reviewedAt ? new Date(c.reviewedAt).toLocaleDateString('es-AR') : '';
                return `<feedback indice="${i + 1}">
  <consulta>${c.question || ''}</consulta>
  <comentario_docente>${c.comments || ''}</comentario_docente>
  ${date ? `<fecha_revision>${date}</fecha_revision>` : ''}
</feedback>`;
              })
              .join('\n');
            teacherFeedbackBlock = `\n\n<feedback_docente>\nA continuacion, feedback y correcciones que el docente ha revisado sobre consultas anteriores. Usa esta informacion para mejorar tus respuestas y evitar errores similares.\n${feedbackEntries}\n</feedback_docente>`;
            context.log(`[RAG] Loaded ${reviewedCorrections.length} teacher-reviewed corrections for subjectId=${subjectId}`);
          }
        } catch (feedbackErr) {
          context.error('[RAG] Error loading teacher feedback (non-blocking):', feedbackErr);
        }

        const threadInstruction = buildThreadInstruction({
            hasThreadAnswer,
            hasFreshMaterial: matches.length > 0,
        });

        const messages = [
            {
                role: 'system',
                content: `${systemPromptBase}${focusClause}

<contexto_rag>
${contextText}
</contexto_rag>${teacherFeedbackBlock}${deadlineBlock}${preferencesBlock}${threadInstruction}`,

            },
            ...buildConversationMessages(recentConversationHistory),
            {
                role: 'user',
                content: rewrittenQuestion,
            },
        ];

        // ── 6. Generar respuesta con GPT-4o mini ──────────────────
        if (stream) {
            context.log('🔄 Iniciando stream RAG...');
            const interactionId = uuidv4();
            const sources = matches.map(m => ({
                materialType: m.metadata?.materialType,
                materialPriority: resolveMaterialPriority(m.metadata, priorityMap),
                subjectId: m.metadata?.subjectId,
                classId: m.metadata?.classId ?? m.metadata?.classIds?.[0],
                classIds: m.metadata?.classIds,
                chunkIndex: m.metadata?.chunkIndex,
                sourceFilename: m.metadata?.sourceFilename,
                slideTitle: resolveSourceSlideTitle(m.metadata),
                score: Math.round(m.score * 100) / 100,
                text: m.metadata?.text || '',
                materialId: m.metadata?.materialId || '',
            }));

            const responseStream = new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();

                    // Enviar metadatos iniciales
                    // #408: `generation` declara modelo y parámetros con los que
                    // se va a generar ESTA respuesta, antes de que se genere.
                    controller.enqueue(encoder.encode(`event: metadata\ndata: ${JSON.stringify({ interactionId, sources, model: getModelDisplayName(ragModel), promptVersion: promptId, evidenceCount: sources.length, generation })}\n\n`));

                    let fullAnswer = '';
                    let finalUsage = null;
                    let firstTokenAt = null;
                    let ttftMs = null;

                    const networkSetupMs = Date.now() - startTime;

                    if (request.signal?.aborted) {
                        context.log(`[RAG] Client already disconnected before stream start — aborting immediately`);
                        try { controller.close(); } catch (_) {}
                        return;
                    }

                    try {
                        const stream = await chatCompletion(messages, true, { model: ragModel, temperature: generation.temperature, headers: dependencyHeaders, signal: request.signal, max_tokens: maxTokens });
                        for await (const chunk of stream) {
                            const delta = chunk.choices?.[0]?.delta?.content || '';
                            if (delta) {
                                if (!firstTokenAt) {
                                    firstTokenAt = new Date().toISOString();
                                    ttftMs = Date.now() - startTime;
                                    context.log(`[Telemetry] TTFT captured: ${ttftMs}ms | networkSetupMs: ${networkSetupMs}ms | interactionId=${interactionId}`);
                                }
                                fullAnswer += delta;
                                controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ content: delta })}\n\n`));
                            }
                            if (chunk.usage) {
                                finalUsage = chunk.usage;
                            }
                        }

                        // Calcular duración y métricas al finalizar
                        const durationMs = Date.now() - startTime;
                        const userAuth = getAuthenticatedUser(request);
                        const userId = userAuth.userId;
                        const totalInteractionTokens = (embeddingUsage?.total_tokens || 0) + (finalUsage?.total_tokens || 0);

                        const selectedClassCount = resolveSelectedClassCount(classIds);

                        trackRAGInteraction({
                            userId,
                            subjectId,
                            promptTokens: finalUsage?.prompt_tokens || 0,
                            completionTokens: finalUsage?.completion_tokens || 0,
                            totalTokens: totalInteractionTokens,
                            durationMs,
                            networkSetupMs,
                            ttftMs,
                            promptVersion: promptId,
                            interactionId,
                            firstTokenAt,
                            filterType,
                            selectedClassCount,
                            sourceMix: resolveSourceMix(sources),
                            correlationId,
                            sandbox: sandboxMode,
                            simulateStudent: simulateStudentMode,
                        }).catch(err => context.error('[Telemetry] Error emitting RAGInteraction event from stream:', err));


                        const chatLog = {
                            id: interactionId,
                            userId: userAuth.userId,
                            subjectId,
                            sessionId: sessionId || interactionId,
                            classIds,
                            transcriptFocus,
                            question,
                            rewrittenQuestion,
                            answer: fullAnswer,
                            sources,
                            promptVersion: promptId,
                            sandbox: sandboxMode,
                            simulateStudent: simulateStudentMode,
                            // #408: la declaración queda en el log de la
                            // interacción, así el historial (chat-history) puede
                            // mostrarla al reabrir el hilo y la comparación entre
                            // dos personas se puede auditar después.
                            generation,
                            abstained: isAbstentionAnswer(fullAnswer),
                            timestamp: new Date().toISOString(),
                        };

                        if (!sandboxMode) {
                            // Persist the chat-log BEFORE signalling completion:
                            // feedback/rating/report endpoints look the message up
                            // by id, so an async (fire-and-forget) write let a fast
                            // rating/report hit a not-yet-existing blob → 404
                            // MESSAGE_NOT_FOUND / missing class context (#330, UJ-38/39).
                            try {
                                await saveJson('chat-logs', `${userAuth.sanitizedId}/${subjectId}/${interactionId}.json`, chatLog);
                            } catch (e) {
                                context.error('Error guardando log de chat (stream):', e);
                            }

                            saveMetricsToTable('SessionMetrics', {
                                partitionKey: subjectId,
                                rowKey: interactionId,
                                subjectId,
                                userId,
                                promptTokens: finalUsage?.prompt_tokens || 0,
                                completionTokens: finalUsage?.completion_tokens || 0,
                                totalTokens: totalInteractionTokens,
                                promptVersion: promptId,
                                timestamp: new Date()
                            }).catch(e => context.error('Error guardando Table Metrics (stream):', e));
                        }

                        // Enviar evento de finalización.
                        // #358/UJ-22: `abstained` marca el rechazo redactado por
                        // el modelo (o la respuesta vacía) para que la UI deje
                        // constancia sin depender de coincidencia textual.
                        // #408: `evidenceCount` + `generation` dejan ver si la
                        // abstención salió CON evidencia disponible (el modelo se
                        // abstuvo) o SIN ella (el material no alcanza). Son dos
                        // cosas distintas y antes se veían iguales.
                        const abstained = isAbstentionAnswer(fullAnswer);
                        const evidenceCount = sources.length;
                        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ usage: finalUsage, answer: fullAnswer, abstained, evidenceCount, abstainedWithEvidence: abstained && evidenceCount > 0, generation })}\n\n`));
                        controller.close();
                    } catch (err) {
                        if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') {
                            const latencyBeforeAbortMs = Date.now() - startTime;
                            const charsGenerated = fullAnswer?.length || 0;
                            const estimatedTokens = Math.round(charsGenerated / 4);
                            context.log(`[RAG] Stream aborted by client disconnect — interactionId=${interactionId}, subjectId=${subjectId}, chars=${charsGenerated}, latency=${latencyBeforeAbortMs}ms`);
                            trackRAGError({
                                errorCategory: 'CLIENT_ABORT',
                                code: 'STREAM_ABORTED',
                                message: `Stream aborted after ${latencyBeforeAbortMs}ms, ${estimatedTokens} estimated tokens sent`,
                                subjectId,
                                userId,
                                classIds,
                                correlationId,
                            }).catch(e => context.error('[Telemetry] Error emitting RAGErrorCategorized (CLIENT_ABORT):', e));
                            try { controller.close(); } catch (_) {}
                            return;
                        }
                        const categorizedError = normalizeCategorizedError(err, ErrorCategory.LLM);
                        context.error('Error durante el stream:', categorizedError);
                        trackRAGError({
                            errorCategory: categorizedError.errorCategory,
                            code: categorizedError.code,
                            message: categorizedError.message,
                            subjectId,
                            userId,
                            classIds,
                            correlationId,
                            stackTrace: err?.stack,
                        }).catch(e => context.error('[Telemetry] Error emitting RAGErrorCategorized (stream):', e));
                        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: categorizedError.message, errorCategory: categorizedError.errorCategory, code: categorizedError.code })}\n\n`));
                        controller.close();
                    }
                }
            });

            return {
                status: 200,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
                body: responseStream
            };
        }

        // ── Standard Blocking Mode (Legacy) ───────────────────────
        const networkSetupMs = Date.now() - startTime;
        let answer;
        let chatUsage;
        try {
            const chatResult = await chatCompletion(messages, false, { model: ragModel, temperature: generation.temperature, headers: dependencyHeaders, max_tokens: maxTokens });
            answer = chatResult.content;
            chatUsage = chatResult.usage;
        } catch (err) {
            const categorizedError = normalizeCategorizedError(err, ErrorCategory.LLM);
            context.error('Error en chat completion:', categorizedError);
            trackRAGError({
                errorCategory: categorizedError.errorCategory,
                code: categorizedError.code,
                message: categorizedError.message,
                subjectId,
                userId,
                classIds,
                correlationId,
                stackTrace: err?.stack,
            }).catch(e => context.error('[Telemetry] Error emitting RAGErrorCategorized (blocking):', e));

            // Audit queries blocked by content-safety filters (#221).
            if (categorizedError.errorCategory === 'SAFETY') {
                trackUnansweredQuery({
                    question,
                    rewrittenQuestion,
                    reason: 'safety_blocked',
                    subjectId,
                    userId,
                    classIds,
                    correlationId,
                    sourcesCount: matches.length,
                }).catch(e => context.error('[Telemetry] Error emitting UnansweredQuery (safety_blocked):', e));
            }

            return jsonResponse(categorizedError.status, {
                error: `Error generando respuesta (chat): ${categorizedError.message}`,
                errorCategory: categorizedError.errorCategory,
                code: categorizedError.code,
            });
        }

        // ── 6b. Emit App Insights telemetry (Issue #69) ───────────
        const durationMs = Date.now() - startTime;
        // userId and sanitizedId are already defined at the top of the handler

        // Accumulate total tokens for this interaction (embedding + chat)
        const totalInteractionTokens = (embeddingUsage?.total_tokens || 0) + (chatUsage?.total_tokens || 0);

        // Audit unanswered queries (empty / refusal-like model output) (#221).
        const trimmedAnswer = String(answer || '').trim();
        const isRefusalLike = !trimmedAnswer
            || trimmedAnswer.toLowerCase().includes('no encontre informacion')
            || trimmedAnswer.toLowerCase().includes('no tengo informacion')
            || trimmedAnswer.toLowerCase().includes('no encuentro informacion');
        if (isRefusalLike) {
            trackUnansweredQuery({
                question,
                rewrittenQuestion,
                reason: trimmedAnswer ? 'refusal_answer' : 'empty_answer',
                subjectId,
                userId,
                classIds,
                correlationId,
                sourcesCount: matches.length,
            }).catch(err => context.error('[Telemetry] Error emitting UnansweredQuery (unanswered):', err));
        }

        const sourceMix = resolveSourceMix(matches.map(m => ({ materialType: m.metadata?.materialType })));

        trackRAGInteraction({
            userId,
            subjectId,
            promptTokens: chatUsage?.prompt_tokens || 0,
            completionTokens: chatUsage?.completion_tokens || 0,
            totalTokens: totalInteractionTokens,
            durationMs,
            networkSetupMs,
            promptVersion: promptId,
            interactionId: uuidv4(),
            filterType,
            selectedClassCount: resolveSelectedClassCount(classIds),
            sourceMix,
            correlationId,
            sandbox: sandboxMode,
            simulateStudent: simulateStudentMode,
        }).catch(err => context.error('[Telemetry] Error emitting RAGInteraction event:', err));

        // ── 7. Construir respuesta con fuentes ────────────────────
        const sources = matches.map(m => ({
            materialType: m.metadata?.materialType,
            materialPriority: resolveMaterialPriority(m.metadata, priorityMap),
            subjectId: m.metadata?.subjectId,
            classId: m.metadata?.classId ?? m.metadata?.classIds?.[0],
            classIds: m.metadata?.classIds,
            chunkIndex: m.metadata?.chunkIndex,
            sourceFilename: m.metadata?.sourceFilename,
            slideTitle: resolveSourceSlideTitle(m.metadata),
            score: Math.round(m.score * 100) / 100,
            text: m.metadata?.text || '',
            materialId: m.metadata?.materialId || '',
        }));

        // ── 8. Guardar log de interacción (HU#62) ─────────────────
        const interactionId = uuidv4();
        const chatLog = {
            id: interactionId,
            userId,
            subjectId,
            sessionId: sessionId || interactionId,
            classIds,
            transcriptFocus,
            question,
            rewrittenQuestion,
            answer,
            sources,
            promptVersion: promptId,
            sandbox: sandboxMode,
            simulateStudent: simulateStudentMode,
            // #408: misma declaración que en el camino con stream, para que el
            // historial y la comparación entre personas la puedan leer.
            generation,
            abstained: isRefusalLike,
            timestamp: new Date().toISOString(),
            feedback: null
        };

        if (!sandboxMode) {
            try {
                // Guardamos en un container específico para logs
                await saveJson('chat-logs', `${sanitizedId}/${subjectId}/${interactionId}.json`, chatLog);

                // Asíncronamente persistimos las métricas RAG en la Table Storage (HU #83)
                saveMetricsToTable('SessionMetrics', {
                    partitionKey: subjectId,
                    rowKey: interactionId,
                    subjectId,
                    userId,
                    promptTokens: chatUsage?.prompt_tokens || 0,
                    completionTokens: chatUsage?.completion_tokens || 0,
                    totalTokens: totalInteractionTokens,
                    promptVersion: promptId,
                    timestamp: new Date()
                }).catch(e => context.error('Error insertando Table Metrics de sesión silenciosa:', e));
            } catch (logErr) {
                context.error('Error guardando log de chat:', logErr);
            }
        }

        return jsonResponse(200, {
            id: interactionId,
            answer,
            sources,
            abstained: isRefusalLike,
            evidenceCount: sources.length,
            abstainedWithEvidence: isRefusalLike && sources.length > 0,
            model: getModelDisplayName(ragModel),
            promptVersion: promptId,
            generation,
        });
    }), 'chat')),
});
