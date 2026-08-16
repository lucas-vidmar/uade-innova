/**
 * global-search.js — POST /api/global-search
 * Búsqueda completa en 4 categorías: materiales, clases, tareas y chats.
 */
import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { generateEmbedding } from '../services/ai.js';
import { querySimilar } from '../services/vector-store.js';
import { validateFrontDoorId, parseClientPrincipal, getAuthenticatedUser } from '../services/auth-utils.js';
import { getEnrollment, listClassesBySubject } from '../services/state-store.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { ErrorCategory, normalizeCategorizedError, structuredErrorResponse } from '../services/error-categories.js';
import { loadJson, listBlobs } from '../services/storage.js';
import { CONFIG } from '../services/config.js';
import { isQuarantined } from '../services/vector-audit.js';

const MAX_GLOBAL_RESULTS = 12;
const MAX_CHAT_RESULTS = 5;
const MAX_CLASS_RESULTS = 5;
const MAX_TASK_RESULTS = 5;
const CHAT_HISTORY_LIMIT = 50;
const CONTAINER_CHAT = 'chat-logs';
const CONTAINER_TASKS = CONFIG.containers.tasks;
const CONTAINER_DEADLINES = 'deadlines';

function buildSnippet(text = '', query = '') {
    const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleanText) return '';
    const queryLower = query.toLowerCase();
    const textLower = cleanText.toLowerCase();
    const matchIndex = textLower.indexOf(queryLower);
    const snippetRadius = 120;
    if (matchIndex < 0) return cleanText.slice(0, 220);
    const start = Math.max(0, matchIndex - snippetRadius);
    const end = Math.min(cleanText.length, matchIndex + query.length + snippetRadius);
    const prefix = start > 0 ? '... ' : '';
    const suffix = end < cleanText.length ? ' ...' : '';
    return `${prefix}${cleanText.slice(start, end)}${suffix}`;
}

function keywordFrequency(text = '', query = '') {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return 0;
    const regex = new RegExp(normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = String(text || '').match(regex);
    return matches ? matches.length : 0;
}

function textScore(text = '', query = '') {
    if (!text || !query) return 0;
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    if (lower === q) return 1.0;
    if (lower.includes(q)) return 0.8 + (q.length / lower.length) * 0.15;
    const words = q.split(/\s+/).filter(Boolean);
    const matchCount = words.filter(w => lower.includes(w)).length;
    if (matchCount === 0) return 0;
    return (matchCount / words.length) * 0.7;
}

app.http('global-search', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'global-search',
    handler: withCorrelation(withAuth(async (request, context) => {
        const { correlationId, dependencyHeaders } = context;

        if (!validateFrontDoorId(request)) {
            return {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID', errorCategory: ErrorCategory.AUTH, code: 'FRONTDOOR_INVALID' }),
            };
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Body JSON inválido', errorCategory: ErrorCategory.VALIDATION, code: 'INVALID_JSON' }),
            };
        }

        const query = typeof body.query === 'string' ? body.query.trim() : '';
        const subjectId = typeof body.subjectId === 'string' ? body.subjectId.trim() : '';

        if (!query || !subjectId) {
            return {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Faltan campos requeridos: query, subjectId', errorCategory: ErrorCategory.VALIDATION, code: 'MISSING_FIELDS' }),
            };
        }

        // Security Check: Enrollment-based access control
        const principal = parseClientPrincipal(request);
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const roles = principal?.userRoles || [];
        const isDirector = roles.includes('Director');

        if (!isDirector && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development') {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.status !== 'active') {
                    return {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'No tienes acceso a esta materia.', errorCategory: ErrorCategory.AUTH, code: 'ENROLLMENT_INACTIVE' })
                    };
                }
            } catch (err) {
                return {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Error verificando permisos de acceso.', errorCategory: ErrorCategory.AUTH, code: 'ENROLLMENT_CHECK_FAILED' })
                };
            }
        }

        try {
            const allResults = [];

            // ── 1. Materiales (Pinecone) ──────────────────────────
            try {
                const { embedding } = await generateEmbedding(query, { headers: dependencyHeaders });
                const materialFilter = {
                    subjectId: { $eq: subjectId },
                    materialType: { $in: ['transcript', 'bibliography', 'presentation', 'notes'] },
                    quarantined: { $ne: true },
                };

                const rawMatches = await querySimilar(embedding, materialFilter, MAX_GLOBAL_RESULTS, { correlationId });
                // Post-filter de cuarentena: incluso si el filtro de Pinecone fallara,
                // un source cuarentenado no debe aparecer en los resultados.
                const matches = rawMatches.filter((match) => !isQuarantined(match.metadata));
                if (matches.length !== rawMatches.length) {
                    context?.log?.(`[global-search] Quarantine post-filter descarto ${rawMatches.length - matches.length} matches cuarentenados (subjectId=${subjectId}, correlationId=${correlationId})`);
                }
                for (const match of matches) {
                    const text = match.metadata?.text || '';
                    const filename = match.metadata?.sourceFilename || '';
                    const keywordHits = keywordFrequency(text, query) + keywordFrequency(filename, query);
                    const semanticScore = Number(match.score || 0);
                    const finalScore = semanticScore + Math.min(keywordHits * 0.04, 0.2);

                    allResults.push({
                        category: 'material',
                        materialId: match.metadata?.materialId,
                        classIds: match.metadata?.classIds || [],
                        materialType: match.metadata?.materialType,
                        materialPriority: match.metadata?.materialPriority || (match.metadata?.materialType === 'bibliography' ? 'secondary' : 'primary'),
                        sourceFilename: filename,
                        snippet: buildSnippet(text, query),
                        title: filename || 'Material sin nombre',
                        url: `#/student/class/${(match.metadata?.classIds || [])[0] || ''}`,
                        score: Number(finalScore.toFixed(4)),
                    });
                }
            } catch (err) {
                context.warn('[global-search] Error buscando en materiales:', err.message);
            }

            // ── 2. Clases (Table Storage) ─────────────────────────
            try {
                const classes = await listClassesBySubject(subjectId);
                for (const cls of classes) {
                    const titleScore = textScore(cls.title || '', query);
                    const topicsText = (cls.topics || []).join(' ');
                    const topicsScore = textScore(topicsText, query);
                    const maxScore = Math.max(titleScore, topicsScore);
                    if (maxScore > 0) {
                        allResults.push({
                            category: 'class',
                            classId: cls.id,
                            title: cls.title,
                            snippet: cls.topics?.length ? cls.topics.slice(0, 3).join(' · ') : cls.date || '',
                            url: `#/student/class/${cls.id}`,
                            score: maxScore,
                        });
                    }
                }
            } catch (err) {
                context.warn('[global-search] Error buscando en clases:', err.message);
            }

            // ── 3. Tareas (Blob Storage) ──────────────────────────
            try {
                if (userId && userId !== 'anonymous') {
                    const tasks = await loadJson(CONTAINER_TASKS, `${userId}.json`);
                    if (Array.isArray(tasks)) {
                        const subjectTasks = tasks.filter(t => !t.subjectId || t.subjectId === subjectId);
                        for (const task of subjectTasks) {
                            const titleScore = textScore(task.title || '', query);
                            const descScore = textScore(task.description || '', query);
                            const maxScore = Math.max(titleScore, descScore);
                            if (maxScore > 0) {
                                allResults.push({
                                    category: 'task',
                                    taskId: task.id || task.title,
                                    title: task.title || 'Tarea sin título',
                                    snippet: task.description ? task.description.slice(0, 200) : '',
                                    url: '#/student/tasks',
                                    score: maxScore,
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                context.warn('[global-search] Error buscando en tareas:', err.message);
            }

            // ── 4. Chats (Blob Storage) ───────────────────────────
            try {
                if (userId && userId !== 'anonymous') {
                    const sanitizedId = userId.replace(/[^a-zA-Z0-9]/g, '_');
                    const prefix = `${sanitizedId}/${subjectId}/`;
                    const blobNames = await listBlobs(CONTAINER_CHAT, prefix);
                    const sortedNames = blobNames.slice().reverse();
                    const recentBlobs = sortedNames.slice(0, CHAT_HISTORY_LIMIT);

                    for (const name of recentBlobs) {
                        const data = await loadJson(CONTAINER_CHAT, name);
                        if (!data) continue;
                        const questionScore = textScore(data.question || '', query);
                        const answerScore = textScore(data.answer || '', query);
                        const maxScore = Math.max(questionScore, answerScore);
                        if (maxScore > 0) {
                            allResults.push({
                                category: 'chat',
                                sessionId: data.sessionId || data.id,
                                title: (data.question || '').slice(0, 120),
                                snippet: buildSnippet(data.answer || '', query).slice(0, 200),
                                url: data.sessionId ? `#/student/dashboard?sessionId=${encodeURIComponent(data.sessionId)}` : '#/student/dashboard',
                                score: maxScore,
                            });
                        }
                    }
                }
            } catch (err) {
                context.warn('[global-search] Error buscando en chats:', err.message);
            }

            // ── Sort & limit final results ────────────────────────
            allResults.sort((a, b) => b.score - a.score);
            const topResults = allResults.slice(0, 30);

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query,
                    subjectId,
                    total: topResults.length,
                    results: topResults,
                }),
            };
        } catch (err) {
            context.error('Error en global-search:', err);
            const categorized = normalizeCategorizedError(err, ErrorCategory.RETRIEVAL_FAILURE);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: `Error buscando: ${categorized.message}`, errorCategory: categorized.errorCategory, code: categorized.code }),
            };
        }
    })),
});
