import { app } from '@azure/functions';
import { loadJson, saveJson, listBlobs, deleteBlob, uploadFile, getTableClient } from '../services/storage.js';
import { v4 as uuidv4 } from 'uuid';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { listClassesBySubject, listMaterialsBySubject, replaceClassesForSubject, deleteMaterialStateById, getMaterialState, upsertMaterialState, deleteClassesBySubject, deleteMaterialsBySubject, getEnrollmentsByUser, getEnrollment } from '../services/state-store.js';
import * as vectorStore from '../services/vector-store.js';
import { trackPollingEvent } from '../services/telemetry.js';

const rawBudget = process.env.DIRECTOR_BUDGET_MONTHLY_USD;
if (!rawBudget) {
    throw new Error('DIRECTOR_BUDGET_MONTHLY_USD environment variable is required');
}
const parsedBudget = Number(rawBudget);
if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) {
    throw new Error(`DIRECTOR_BUDGET_MONTHLY_USD must be a positive number, got: ${rawBudget}`);
}
const MONTHLY_BUDGET = parsedBudget;

const CONTAINER_CLASSES = process.env.AZURE_STORAGE_CONTAINER_CLASSES || 'classes-config';
const CONTAINER_PROCESSED = 'processed';
const SUBJECTS_BLOB = 'subjects.json';

const DEFAULT_SUBJECTS = [
    { id: 'arq-software-2026', name: 'Arquitectura de Software', group: 'GRP-ARQ-SOFT-2026' },
    { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas', group: 'GRP-DIS-SIST-2026' }
];

const SESSION_METRICS_TABLE = 'SessionMetrics';
const POWERBI_DEFAULT_DAYS = 14;

function toIsoDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
}

function createDailyBucket(date) {
    return {
        date,
        dau: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        inputCost: 0,
        outputCost: 0,
        totalCost: 0,
        avgCostPerInteraction: 0,
        ragInteractions: 0,
        _users: new Set(),
    };
}

function computeInputCost(promptTokens = 0) {
    return Number(promptTokens || 0) * 0.00000015;
}

function computeOutputCost(completionTokens = 0) {
    return Number(completionTokens || 0) * 0.0000006;
}

async function loadSessionMetricsRows(context) {
    try {
        const tableClient = getTableClient(SESSION_METRICS_TABLE);
        const rows = [];
        for await (const entity of tableClient.listEntities()) {
            rows.push(entity);
        }
        return rows;
    } catch (err) {
        context.log.warn(`[PowerBI] Could not read ${SESSION_METRICS_TABLE}: ${err.message}`);
        return [];
    }
}

async function loadSessionMetricsRowsPaginated(context, { limit = 1000, continuationToken, subjectId } = {}) {
    try {
        const tableClient = getTableClient(SESSION_METRICS_TABLE);

        const filterParts = ["eventType ne 'material-upload'"];
        if (subjectId) {
            const esc = String(subjectId).replace(/'/g, "''");
            filterParts.push(`subjectId eq '${esc}'`);
        }

        const iter = tableClient.listEntities({
            queryOptions: { filter: filterParts.join(' and ') },
        });

        const rows = [];
        let nextToken = null;

        for await (const page of iter.byPage({ maxPageSize: limit, continuationToken: continuationToken || undefined })) {
            for (const entity of page) {
                rows.push(entity);
            }
            nextToken = page.continuationToken || null;
            break;
        }

        return { rows, continuationToken: nextToken };
    } catch (err) {
        context.log.warn(`[SessionMetrics] Could not read paginated ${SESSION_METRICS_TABLE}: ${err.message}`);
        return { rows: [], continuationToken: null };
    }
}

function createSubjectDailyBucket(date, subjectId) {
    return {
        date, subjectId,
        promptTokens: 0, completionTokens: 0, totalTokens: 0,
        ragInteractions: 0, _users: new Set(),
    };
}

async function computeDirectorMetrics(context, requestedDays = POWERBI_DEFAULT_DAYS) {
    const days = Math.min(Math.max(Number(requestedDays) || POWERBI_DEFAULT_DAYS, 1), 90);
    const rows = await loadSessionMetricsRows(context);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setUTCDate(today.getUTCDate() - (days - 1));

    const buckets = new Map();
    const uniqueUsersWindow = new Set();

    const subjectBuckets = new Map();
    const materialUploadsByTeacher = {};

    const subjectNames = {};

    for (let i = 0; i < days; i++) {
        const date = new Date(start);
        date.setUTCDate(start.getUTCDate() + i);
        const iso = toIsoDate(date);
        buckets.set(iso, createDailyBucket(iso));
    }

    const uploadCounts = { transcript: 'transcripts', presentation: 'presentations', notes: 'notes', bibliography: 'bibliography' };

    for (const row of rows) {
        const iso = toIsoDate(row?.timestamp);
        if (!iso || !buckets.has(iso)) continue;

        const eventType = String(row?.eventType || '').trim();
        const isUpload = eventType === 'material-upload';

        if (isUpload) {
            const teacherId = safeObjectKey(String(row?.teacherId || row?.userId || 'unknown').trim());
            const mt = String(row?.materialType || 'unknown').trim();
            if (!materialUploadsByTeacher[teacherId]) {
                materialUploadsByTeacher[teacherId] = { teacherId, transcripts: 0, presentations: 0, notes: 0, bibliography: 0, total: 0 };
            }
            const key = uploadCounts[mt];
            if (key) materialUploadsByTeacher[teacherId][key] += 1;
            materialUploadsByTeacher[teacherId].total += 1;
            continue;
        }

        // Only aggregate cost for rows with token data (RAG interactions)
        const hasTokens = Number(row?.promptTokens || 0) > 0 || Number(row?.completionTokens || 0) > 0;
        if (!hasTokens) continue;

        const bucket = buckets.get(iso);
        const promptTokens = Number(row?.promptTokens || 0);
        const completionTokens = Number(row?.completionTokens || 0);
        const totalTokens = Number(row?.totalTokens || 0);
        const userId = String(row?.userId || '').trim();
        const subjectId = String(row?.subjectId || '').trim();

        bucket.promptTokens += Number.isFinite(promptTokens) ? promptTokens : 0;
        bucket.completionTokens += Number.isFinite(completionTokens) ? completionTokens : 0;
        bucket.totalTokens += Number.isFinite(totalTokens) ? totalTokens : 0;
        bucket.ragInteractions += 1;
        if (userId && userId !== 'anonymous') {
            bucket._users.add(userId);
            uniqueUsersWindow.add(userId);
        }

        if (subjectId) {
            const safeSubjectId = safeObjectKey(subjectId);
            subjectNames[safeSubjectId] = row?.subjectName || subjectId;
            const subKey = `${iso}::${safeSubjectId}`;
            if (!subjectBuckets.has(subKey)) {
                subjectBuckets.set(subKey, createSubjectDailyBucket(iso, safeSubjectId));
            }
            const sb = subjectBuckets.get(subKey);
            sb.promptTokens += Number.isFinite(promptTokens) ? promptTokens : 0;
            sb.completionTokens += Number.isFinite(completionTokens) ? completionTokens : 0;
            sb.totalTokens += Number.isFinite(totalTokens) ? totalTokens : 0;
            sb.ragInteractions += 1;
            if (userId && userId !== 'anonymous') sb._users.add(userId);
        }
    }

    const daily = Array.from(buckets.values()).map((bucket) => ({
        inputCost: Number(computeInputCost(bucket.promptTokens).toFixed(6)),
        outputCost: Number(computeOutputCost(bucket.completionTokens).toFixed(6)),
        totalCost: Number((computeInputCost(bucket.promptTokens) + computeOutputCost(bucket.completionTokens)).toFixed(6)),
        avgCostPerInteraction: Number(((computeInputCost(bucket.promptTokens) + computeOutputCost(bucket.completionTokens)) / Math.max(bucket.ragInteractions, 1)).toFixed(8)),
        date: bucket.date,
        dau: bucket._users.size,
        promptTokens: bucket.promptTokens,
        completionTokens: bucket.completionTokens,
        totalTokens: bucket.totalTokens,
        ragInteractions: bucket.ragInteractions,
    }));

    const latest = daily[daily.length - 1] || { dau: 0, totalTokens: 0, ragInteractions: 0, totalCost: 0 };
    const previous = daily[daily.length - 2] || { dau: 0, totalTokens: 0, ragInteractions: 0, totalCost: 0 };

    const dauDelta = previous.dau > 0
        ? Math.round(((latest.dau - previous.dau) / previous.dau) * 100)
        : (latest.dau > 0 ? 100 : 0);
    const ragDelta = previous.ragInteractions > 0
        ? Math.round(((latest.ragInteractions - previous.ragInteractions) / previous.ragInteractions) * 100)
        : (latest.ragInteractions > 0 ? 100 : 0);
    const costDelta = previous.totalCost > 0
        ? Math.round(((latest.totalCost - previous.totalCost) / previous.totalCost) * 100)
        : (latest.totalCost > 0 ? 100 : 0);

    const subjectGroups = new Map();
    for (const [key, sb] of subjectBuckets) {
        const sid = sb.subjectId;
        if (!subjectGroups.has(sid)) subjectGroups.set(sid, []);
        subjectGroups.get(sid).push({
            date: sb.date,
            cost: Number((computeInputCost(sb.promptTokens) + computeOutputCost(sb.completionTokens)).toFixed(6)),
            ragInteractions: sb.ragInteractions,
        });
    }

    const costBySubject = Array.from(subjectGroups.entries()).map(([sid, dailyCosts]) => ({
        subjectId: sid,
        subjectName: subjectNames[sid] || sid,
        dailyCost: dailyCosts.sort((a, b) => a.date.localeCompare(b.date)),
    }));

    const now = new Date();
    const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
    const weekStartIso = toIsoDate(weekStart);

    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setUTCDate(prevWeekStart.getUTCDate() - 7);
    const prevWeekStartIso = toIsoDate(prevWeekStart);

    const wausBySubject = {};
    for (const [key, sb] of subjectBuckets) {
        const sid = safeObjectKey(sb.subjectId);
        if (!wausBySubject[sid]) {
            wausBySubject[sid] = { subjectId: sid, subjectName: subjectNames[sid] || sid, currentWeek: new Set(), previousWeek: new Set() };
        }
        if (sb.date >= weekStartIso) {
            sb._users.forEach(u => wausBySubject[sid].currentWeek.add(u));
        } else if (sb.date >= prevWeekStartIso && sb.date < weekStartIso) {
            sb._users.forEach(u => wausBySubject[sid].previousWeek.add(u));
        }
    }

    const byTeacher = Object.values(materialUploadsByTeacher);

    return {
        _rawRows: rows,
        updatedAt: new Date().toISOString(),
        windowDays: days,
        daily,
        totals: {
            promptTokens: daily.reduce((sum, item) => sum + item.promptTokens, 0),
            completionTokens: daily.reduce((sum, item) => sum + item.completionTokens, 0),
            totalTokens: daily.reduce((sum, item) => sum + item.totalTokens, 0),
            totalCost: Number(daily.reduce((sum, item) => sum + item.totalCost, 0).toFixed(6)),
            ragInteractions: daily.reduce((sum, item) => sum + item.ragInteractions, 0),
            uniqueActiveUsers: uniqueUsersWindow.size,
        },
        latest,
        deltas: {
            dau: `${dauDelta >= 0 ? '+' : ''}${dauDelta}%`,
            ragInteractions: `${ragDelta >= 0 ? '+' : ''}${ragDelta}%`,
            cost: `${costDelta >= 0 ? '+' : ''}${costDelta}%`,
        },
        costBySubject,
        wausBySubject: Object.values(wausBySubject).map(w => ({
            subjectId: w.subjectId,
            subjectName: w.subjectName,
            currentWeek: w.currentWeek.size,
            previousWeek: w.previousWeek.size,
        })),
        materialUploads: {
            byTeacher,
        },
    };
}

function computeBudgetProjection(daily) {
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const year = todayUtc.getUTCFullYear();
    const month = todayUtc.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const daysElapsed = todayUtc.getUTCDate();
    const daysRemaining = daysInMonth - daysElapsed;

    let currentMonthSpend = 0;
    const monthStartIso = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}`;
    for (const d of daily) {
        if (d.date.startsWith(monthStartIso)) {
            currentMonthSpend += d.totalCost;
        }
    }

    const avgDailyCost = currentMonthSpend > 0 ? currentMonthSpend / Math.max(daysElapsed, 1) : 0;

    // Weekend-aware projection: count weekdays and weekends separately
    let weekdayRemaining = 0;
    let weekendRemaining = 0;
    for (let i = 1; i <= daysRemaining; i++) {
        const checkDate = new Date(Date.UTC(year, month, daysElapsed + i));
        const dayOfWeek = checkDate.getUTCDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            weekendRemaining++;
        } else {
            weekdayRemaining++;
        }
    }

    // Weekend activity is ~60% of weekday (0.6 factor)
    const WEEKEND_ACTIVITY_FACTOR = 0.6;
    const projectedRemaining = (weekdayRemaining * avgDailyCost) + (weekendRemaining * avgDailyCost * WEEKEND_ACTIVITY_FACTOR);
    const projectedEndOfMonth = currentMonthSpend + projectedRemaining;

    const percentUsed = MONTHLY_BUDGET > 0 ? (projectedEndOfMonth / MONTHLY_BUDGET) * 100 : 0;
    const remainingBudget = Math.max(0, MONTHLY_BUDGET - currentMonthSpend);

    return {
        monthlyLimit: MONTHLY_BUDGET,
        currentSpend: Number(currentMonthSpend.toFixed(6)),
        projectedEndOfMonth: Number(projectedEndOfMonth.toFixed(6)),
        remainingBudget: Number(remainingBudget.toFixed(6)),
        percentUsed: Number(percentUsed.toFixed(1)),
        warningLevel: percentUsed >= 95 ? 'critical' : percentUsed >= 80 ? 'warning' : 'none',
    };
}

function computeCostSpikeAlert(daily) {
    if (daily.length < 8) return null;
    const today = daily[daily.length - 1];
    const sevenDaySlice = daily.slice(daily.length - 8, daily.length - 1);
    const validDays = sevenDaySlice.filter(d => Number.isFinite(d.avgCostPerInteraction));
    const avgCost = validDays.length > 0 ? validDays.reduce((sum, d) => sum + d.avgCostPerInteraction, 0) / validDays.length : 0;
    const todayCost = today.avgCostPerInteraction || 0;
    const MIN_COST_THRESHOLD = 0.0001;
    if (avgCost < MIN_COST_THRESHOLD || todayCost <= avgCost * 2) return null;
    const delta = Math.round(((todayCost - avgCost) / avgCost) * 100);
    return { detected: true, delta, todayAvg: todayCost, sevenDayAvg: avgCost };
}

function normalizeLimit(value, fallback = 1000) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(Math.max(Math.floor(parsed), 1), 1000);
}

function safeObjectKey(key) {
    if (typeof key !== 'string') return String(key || '');
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return `_${key}`;
    }
    return key;
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
        } catch {
            return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
        }
    }
    return [];
}

function normalizeMaterialStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();
    if (['pending', 'processing', 'ready', 'error'].includes(normalized)) {
        return normalized;
    }
    return 'pending';
}

function normalizeMaterialForResponse(material) {
    if (!material || typeof material !== 'object') return material;
    return {
        ...material,
        status: normalizeMaterialStatus(material.status),
    };
}

function parseMaterialIdsQuery(request) {
    const query = request?.query;
    const values = [];

    if (query && typeof query.getAll === 'function') {
        values.push(...query.getAll('materialIds'));
    }

    if (query && typeof query.get === 'function') {
        const single = query.get('materialIds');
        if (single) values.push(single);
    }

    return Array.from(new Set(values
        .flatMap((value) => String(value || '').split(','))
        .map((value) => value.trim())
        .filter(Boolean)));
}

async function getMaterialBySubjectAndId(subjectId, materialId, context) {
    let material = null;

    try {
        material = await getMaterialState(subjectId, materialId);
    } catch (tableErr) {
        context.error(`[StateStore] Error leyendo material ${materialId} para ${subjectId}:`, tableErr);
    }

    if (!material) {
        const legacy = await loadJson(CONTAINER_PROCESSED, `${materialId}.json`);
        if (legacy && legacy.subjectId === subjectId) {
            material = {
                id: legacy.materialId || legacy.id,
                materialId: legacy.materialId || legacy.id,
                subjectId: legacy.subjectId,
                classIds: normalizeStringArray(legacy.classIds || legacy.classId),
                type: legacy.type,
                filename: legacy.filename,
                status: legacy.status,
                blobUrl: legacy.blobUrl,
                uploadedAt: legacy.uploadedAt,
                processedAt: legacy.processedAt,
                errorMessage: legacy.errorMessage,
                chunkCount: legacy.chunkCount,
            };
        }
    }

    return normalizeMaterialForResponse(material);
}

function slugifySubjectId(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function normalizeSubject(subject = {}) {
    return {
        ...subject,
        id: String(subject.id || '').trim(),
        name: String(subject.name || '').trim(),
        group: String(subject.group || '').trim()
    };
}

async function loadSubjects() {
    const saved = await loadJson(CONTAINER_CLASSES, SUBJECTS_BLOB);
    // Solo cargamos los valores por defecto si el archivo no existe (null) o no es un array.
    // Si es un array vacío [], significa que el usuario eliminó todo y debemos respetarlo.
    if (saved === null || !Array.isArray(saved)) return [...DEFAULT_SUBJECTS];
    
    return saved.map(normalizeSubject).filter((s) => s.id && s.name);
}

async function saveSubjects(subjects) {
    await saveJson(CONTAINER_CLASSES, SUBJECTS_BLOB, subjects);
}

function canManageSubjects(principal) {
    return principal?.userRoles?.includes('Director') || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
}

// ── GET /api/subjects ──────────────────────────────────────────────
// Devuelve las materias disponibles (mock para el MVP)
app.http('get-subjects', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'subjects',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        context.log('get-subjects triggered');

        const principal = parseClientPrincipal(request);
        const groups = principal?.groups || [];
        const roles = principal?.userRoles || [];
        const isTeacher = roles.includes('Docente');
        const isDirector = roles.includes('Director');
        const userId = principal?.userId || principal?.oid || request.headers.get('x-mock-role') || 'anonymous';

        const allSubjects = await loadSubjects();

        // Enrollment-based filtering (primary) with group-based fallback (backward compatibility)
        let filteredSubjects = allSubjects;
        
        try {
            const userEnrollments = await getEnrollmentsByUser(userId);

            if (userEnrollments.length > 0) {
                // Primary: enrollment table filtering
                if (isDirector) {
                    filteredSubjects = allSubjects;
                } else if (isTeacher) {
                    const assignedSubjectIds = userEnrollments
                        .filter(e => e.role === 'teacher' && e.status === 'active')
                        .map(e => e.subjectId);
                    filteredSubjects = allSubjects.filter(s => assignedSubjectIds.includes(s.id));
                } else {
                    const enrolledSubjectIds = userEnrollments
                        .filter(e => e.status === 'active')
                        .map(e => e.subjectId);
                    filteredSubjects = allSubjects.filter(s => enrolledSubjectIds.includes(s.id));
                }
            } else if (principal && !isTeacher && !isDirector) {
                // Fallback: group-based filtering for students without enrollment records
                filteredSubjects = allSubjects.filter(s => !s.group || groups.includes(s.group));
            }
        } catch (enrollmentErr) {
            context.log.warn(`[get-subjects] Enrollment lookup failed, falling back to group filtering: ${enrollmentErr.message}`);
            // Fallback: group-based filtering
            if (principal && !isTeacher && !isDirector) {
                filteredSubjects = allSubjects.filter(s => !s.group || groups.includes(s.group));
            }
        }

        return { 
            status: 200, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(filteredSubjects) 
        };
    }
});

// ── POST|PUT /api/subjects ─────────────────────────────────────────
// Crea o actualiza materias (solo Director)
app.http('save-subject', {
    methods: ['POST', 'PUT'],
    authLevel: 'anonymous',
    route: 'subjects',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const principal = parseClientPrincipal(request);
        if (!canManageSubjects(principal)) {
            context.log.warn(`Unauthorized attempt to save subject. User: ${principal?.userDetails || 'Anonymous'}. Roles: ${principal?.userRoles?.join(',') || 'None'}`);
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
        }

        try {
            const payload = normalizeSubject(await request.json());
            if (!payload.name) {
                return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'El nombre de la materia es obligatorio' }) };
            }

            const subjects = await loadSubjects();
            const desiredId = payload.id || slugifySubjectId(payload.name);
            if (!desiredId) {
                return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No se pudo generar el ID de la materia' }) };
            }

            if (request.method === 'POST') {
                if (subjects.some((s) => s.id === desiredId)) {
                    return { status: 409, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Ya existe una materia con ese ID' }) };
                }
                const next = [...subjects, { ...payload, id: desiredId }];
                await saveSubjects(next);
                return { status: 201, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: desiredId, name: payload.name }) };
            }

            const idx = subjects.findIndex((s) => s.id === desiredId);
            if (idx < 0) {
                return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Materia no encontrada' }) };
            }

            subjects[idx] = { ...subjects[idx], ...payload };
            await saveSubjects(subjects);
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subjects[idx]) };
        } catch (err) {
            context.error(err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Error guardando materia: ${err.message}` }) };
        }
    }
});

// ── DELETE /api/subjects/{subjectId} ───────────────────────────────
// Elimina materias (solo Director) si no tienen clases asociadas
app.http('delete-subject', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'subjects/{subjectId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const subjectId = request.params.subjectId;
        const cascade = request.query.get('cascade') === 'true';

        const principal = parseClientPrincipal(request);
        if (!canManageSubjects(principal)) {
            context.log.warn(`Unauthorized attempt to delete subject ${subjectId || 'unknown'}. User: ${principal?.userDetails || 'Anonymous'}. Roles: ${principal?.userRoles?.join(',') || 'None'}`);
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
        }

        if (!subjectId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        try {
            const subjects = await loadSubjects();
            const index = subjects.findIndex(s => s.id === subjectId);
            if (index === -1) {
                return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Materia no encontrada" }) };
            }

            const classes = await listClassesBySubject(subjectId);
            if (classes.length > 0 && !cascade) {
                return {
                    status: 409,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        error: "No se puede eliminar una materia con clases asociadas. Use 'cascade=true' para eliminar todo.",
                        classCount: classes.length
                    })
                };
            }

            if (cascade) {
                context.log(`[CascadeDelete] Iniciando limpieza para materia ${subjectId}...`);

                // 1. Limpiar Pinecone (por subjectId es más eficiente)
                try {
                    await vectorStore.deleteVectorsByFilter({ subjectId: { "$eq": subjectId } });
                    context.log(`[CascadeDelete] Vectores de ${subjectId} eliminados.`);
                } catch (vErr) {
                    context.error(`[CascadeDelete] Error eliminando vectores:`, vErr);
                }

                // 2. Limpiar materiales (blobs y tablas)
                const materials = await listMaterialsBySubject(subjectId);
                for (const material of materials) {
                    try {
                        // Borrar blobs de materiales
                        await deleteBlob(CONTAINER_PROCESSED, `${material.materialId}.json`);
                        // El blob original suele estar en class-materials/{classId}/{materialId}-{filename}
                        if (material.blobUrl && material.classIds?.length > 0) {
                            const primaryClassId = material.classIds[0];
                            const blobName = `${primaryClassId}/${material.materialId}-${material.filename}`;
                            await deleteBlob('class-materials', blobName).catch(() => {});
                        }
                    } catch (mErr) {
                        context.error(`[CascadeDelete] Error borrando archivos de material ${material.materialId}:`, mErr);
                    }
                }
                await deleteMaterialsBySubject(subjectId);

                // 3. Limpiar clases (resúmenes, mapas y tablas)
                for (const cls of classes) {
                    try {
                        await deleteBlob('class-summaries', `${cls.id}.json`).catch(() => {});
                        await deleteBlob('class-maps', `${cls.id}.json`).catch(() => {});
                    } catch (cErr) {
                        context.error(`[CascadeDelete] Error borrando recursos de clase ${cls.id}:`, cErr);
                    }
                }
                await deleteClassesBySubject(subjectId);

                context.log(`[CascadeDelete] Limpieza de ${subjectId} completada.`);
            }

            subjects.splice(index, 1);
            await saveSubjects(subjects);
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, cascade }) };
        } catch (err) {
            context.error(err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Error eliminando materia: ${err.message}` }) };
        }
    }
});

// ── GET /api/classes ───────────────────────────────────────────────
// Lista las clases de un subject, cruzadas con sus materiales
app.http('get-classes', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'classes/{subjectId?}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        context.log('get-classes triggered');
        
        let subjectId = request.params.subjectId || request.query.get('subjectId');
        if (!subjectId || subjectId === 'undefined') return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };

        // Security Check: Enrollment-based access control
        const principal = parseClientPrincipal(request);
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const roles = principal?.userRoles || [];
        const isDirector = roles.includes('Director');

        if (!isDirector) {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.status !== 'active') {
                    context.log.warn(`[get-classes] Unauthorized access attempt: User ${userId} is not enrolled in ${subjectId}`);
                    return {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'No tienes acceso a esta materia.' })
                    };
                }
            } catch (enrollmentErr) {
                context.error(`[get-classes] Error verifying enrollment for ${userId} in ${subjectId}:`, enrollmentErr);
                return { status: 500, body: JSON.stringify({ error: 'Error al verificar permisos de acceso.' }) };
            }
        }

        try {
            let classesConfig = [];
            let materials = [];
            let tableSuccess = false;

            try {
                classesConfig = await listClassesBySubject(subjectId);
                materials = await listMaterialsBySubject(subjectId);
                tableSuccess = true;
                context.log(`[get-classes] Table storage query successful for ${subjectId}`);
            } catch (tableErr) {
                context.error(`[get-classes] Table storage error for ${subjectId}:`, tableErr.message);
                // Si falla la tabla, intentamos fallback a blobs
            }

            // 2. Fallback solo si las tablas fallaron o están vacías Y realmente queremos intentar recuperar legacy
            if (!tableSuccess || (classesConfig.length === 0 && materials.length === 0)) {
                context.log(`[get-classes] Attempting legacy blob fallback for ${subjectId}...`);
                
                // Fallback de Clases
                if (classesConfig.length === 0) {
                    const legacyClasses = await loadJson(CONTAINER_CLASSES, `${subjectId}.json`);
                    if (legacyClasses) {
                        classesConfig = Array.isArray(legacyClasses) ? legacyClasses : [];
                        context.log(`[get-classes] Loaded ${classesConfig.length} legacy classes from blob`);
                    }
                }

                // Fallback de Materiales (SOLO si no hay nada en tablas)
                // PRECAUCIÓN: Esto es lento si hay muchos blobs. Lo limitamos.
                if (materials.length === 0) {
                    const blobNames = await listBlobs(CONTAINER_PROCESSED);
                    const subjectMaterials = [];
                    // Solo escaneamos los primeros 50 para evitar timeouts si el sistema crece
                    const limitedBlobs = blobNames.slice(0, 50); 
                    for (const blob of limitedBlobs) {
                        if (!blob.endsWith('.json')) continue;
                        const mat = await loadJson(CONTAINER_PROCESSED, blob);
                        if (mat && mat.subjectId === subjectId) subjectMaterials.push(mat);
                    }
                    materials = subjectMaterials;
                    if (materials.length > 0) context.log(`[get-classes] Found ${materials.length} materials in legacy blobs`);
                }
            }

            // 3. Cruzar datos
            context.log(`[get-classes] Joining ${classesConfig.length} classes with ${materials.length} materials for subject ${subjectId}`);

            const resultClasses = classesConfig.map(c => {
                if (!c.date) context.log.warn(`[get-classes] Class ${c.id} ("${c.title}") is missing the date field.`);
                return { 
                    ...c, 
                    materials: [], 
                    summaryReady: c.summaryReady || false,
                    professorIds: c.professorIds || [],
                    studentIds: c.studentIds || []
                };
            });

            // Materiales huérfanos o que pertenecen a múltiples clases
            for (const mat of materials) {
                const targetClasses = normalizeStringArray(mat.classIds || mat.classId);
                const matSafe = {
                    id: mat.materialId || mat.id,
                    type: mat.type,
                    filename: mat.filename,
                    status: mat.status,
                    uploadedAt: mat.uploadedAt || mat.processedAt,
                    blobUrl: mat.blobUrl,
                    classIds: targetClasses,
                    reviewed: mat.reviewed === true,
                    chunkCount: mat.chunkCount,
                    priority: mat.priority,
                };

                context.log(`[get-classes] Processing material ${matSafe.id} ("${matSafe.filename}") - status: ${matSafe.status}, linked classes: ${targetClasses.join(', ')}`);

                for (const cid of targetClasses) {
                    const cls = resultClasses.find(c => c.id === cid);
                    if (cls) {
                        cls.materials.push(matSafe);
                        context.log(`[get-classes]   -> Successfully linked material ${matSafe.id} to class ${cid}`);
                    } else {
                        context.log.warn(`[get-classes]   -> Warning: Material ${matSafe.id} refers to non-existent class ${cid}`);
                    }
                }
            }

            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resultClasses) };
        } catch (err) {
            context.error(err);
            return { status: 500, body: JSON.stringify({ error: 'Error interno' }) };
        }
    }
});

// ── GET /api/material-status/{materialId} ──────────────────────────
// Devuelve el estado puntual de un material por subjectId + materialId
app.http('get-material-status', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'material-status/{materialId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const materialId = request.params.materialId;
        const subjectId = request.query.get('subjectId');

        if (!materialId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta materialId' }) };
        }

        if (!subjectId || subjectId === 'undefined') {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        // Security Check: Enrollment-based access control
        const principal = parseClientPrincipal(request);
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const roles = principal?.userRoles || [];
        const isDirector = roles.includes('Director');

        if (!isDirector) {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.status !== 'active') {
                    context.log.warn(`[get-material-status] Unauthorized access attempt: User ${userId} is not enrolled in ${subjectId}`);
                    return {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'No tienes acceso a este material.' })
                    };
                }
            } catch (enrollmentErr) {
                context.error(`[get-material-status] Error verifying enrollment for ${userId} in ${subjectId}:`, enrollmentErr);
                return { status: 500, body: JSON.stringify({ error: 'Error al verificar permisos de acceso.' }) };
            }
        }

        try {
            const material = await getMaterialBySubjectAndId(subjectId, materialId, context);

            if (!material) {
                trackPollingEvent({
                    eventType: 'material_status_single_success',
                    subjectId,
                    materialCount: 0,
                });
                return {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Material no encontrado' }),
                };
            }

            trackPollingEvent({
                eventType: 'material_status_single_success',
                subjectId,
                materialCount: 1,
            });
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(material),
            };
        } catch (err) {
            context.error(err);
            trackPollingEvent({
                eventType: 'polling_error',
                subjectId,
                errorMessage: err.message,
                endpoint: 'get-material-status',
            });
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error interno' }) };
        }
    },
});

// ── GET /api/material-status?subjectId=...&materialIds=... ─────────
// Consulta estado de múltiples materiales en una sola llamada
app.http('get-material-status-batch', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'material-status',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const subjectId = request.query.get('subjectId');
        const materialIds = parseMaterialIdsQuery(request);

        if (!subjectId || subjectId === 'undefined') {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        if (materialIds.length === 0) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta materialIds' }) };
        }

        if (materialIds.length > 50) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'materialIds excede el máximo permitido (50)' }) };
        }

        // Security Check: Enrollment-based access control
        const principal = parseClientPrincipal(request);
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const roles = principal?.userRoles || [];
        const isDirector = roles.includes('Director');

        if (!isDirector) {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.status !== 'active') {
                    context.log.warn(`[get-material-status-batch] Unauthorized access attempt: User ${userId} is not enrolled in ${subjectId}`);
                    return {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'No tienes acceso a los materiales de esta materia.' })
                    };
                }
            } catch (enrollmentErr) {
                context.error(`[get-material-status-batch] Error verifying enrollment for ${userId} in ${subjectId}:`, enrollmentErr);
                return { status: 500, body: JSON.stringify({ error: 'Error al verificar permisos de acceso.' }) };
            }
        }

        try {
            const results = [];
            let foundCount = 0;

            for (const materialId of materialIds) {
                const material = await getMaterialBySubjectAndId(subjectId, materialId, context);
                if (!material) {
                    results.push({ materialId, found: false, httpStatus: 404 });
                    continue;
                }

                results.push({
                    materialId,
                    found: true,
                    httpStatus: 200,
                    status: normalizeMaterialStatus(material.status),
                    material,
                });
                foundCount++;
            }

            trackPollingEvent({
                eventType: 'material_status_batch_get_success',
                subjectId,
                materialCount: foundCount,
                endpoint: 'get-material-status-batch',
            });
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subjectId, results }),
            };
        } catch (err) {
            context.error(err);
            trackPollingEvent({
                eventType: 'polling_error',
                subjectId,
                materialCount: materialIds.length,
                errorMessage: err.message,
                endpoint: 'get-material-status-batch',
            });
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error interno' }) };
        }
    },
});

// ── POST /api/material-status/batch ────────────────────────────────
// Consulta estado de múltiples materiales en una sola llamada (POST)
app.http('post-material-status-batch', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'material-status/batch',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        let body;
        try {
            body = await request.json();
        } catch {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Cuerpo de la solicitud inválido' }) };
        }

        const subjectId = body?.subjectId;
        const materialIds = Array.isArray(body?.materialIds) ? body.materialIds.map(id => String(id).trim()).filter(Boolean) : [];

        if (!subjectId || subjectId === 'undefined') {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        if (materialIds.length === 0) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta materialIds' }) };
        }

        if (materialIds.length > 50) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'materialIds excede el máximo permitido (50)' }) };
        }

        // Security Check: Enrollment-based access control
        const principal = parseClientPrincipal(request);
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const roles = principal?.userRoles || [];
        const isDirector = roles.includes('Director');

        if (!isDirector) {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.status !== 'active') {
                    context.log.warn(`[post-material-status-batch] Unauthorized access attempt: User ${userId} is not enrolled in ${subjectId}`);
                    return {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'No tienes acceso a los materiales de esta materia.' })
                    };
                }
            } catch (enrollmentErr) {
                context.error(`[post-material-status-batch] Error verifying enrollment for ${userId} in ${subjectId}:`, enrollmentErr);
                return { status: 500, body: JSON.stringify({ error: 'Error al verificar permisos de acceso.' }) };
            }
        }

        try {
            const results = [];
            let foundCount = 0;

            for (const materialId of materialIds) {
                const material = await getMaterialBySubjectAndId(subjectId, materialId, context);
                if (!material) {
                    results.push({ materialId, found: false, httpStatus: 404 });
                    continue;
                }

                results.push({
                    materialId,
                    found: true,
                    httpStatus: 200,
                    status: normalizeMaterialStatus(material.status),
                    material,
                });
                foundCount++;
            }

            trackPollingEvent({
                eventType: 'material_status_batch_success',
                subjectId,
                materialCount: foundCount,
                endpoint: 'post-material-status-batch',
            });
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subjectId, results }),
            };
        } catch (err) {
            context.error(err);
            trackPollingEvent({
                eventType: 'polling_error',
                subjectId,
                materialCount: materialIds.length,
                errorMessage: err.message,
                endpoint: 'post-material-status-batch',
            });
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error interno' }) };
        }
    },
});

// ── POST /api/classes ──────────────────────────────────────────────
// Crea o actualiza una clase entera (o la lista de clases)
app.http('save-classes', {
    methods: ['POST', 'PUT'],
    authLevel: 'anonymous',
    route: 'classes/{subjectId?}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        
        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Forbidden - Teacher access required" }) };
        }

        context.log('save-classes triggered');

        let subjectId = request.params.subjectId || request.query.get('subjectId');
        if (!subjectId || subjectId === 'undefined') return { status: 400, body: JSON.stringify({ error: 'Falta subjectId' }) };

        // Security Check: Enrollment-based access control
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const isDirector = principal?.userRoles?.includes('Director');

        if (!isDirector) {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
                    context.log.warn(`[save-classes] Unauthorized save attempt: User ${userId} is not an active teacher for ${subjectId}`);
                    return {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'No tienes permisos para modificar clases en esta materia.' })
                    };
                }
            } catch (enrollmentErr) {
                context.error(`[save-classes] Error verifying enrollment for ${userId} in ${subjectId}:`, enrollmentErr);
                return { status: 500, body: JSON.stringify({ error: 'Error al verificar permisos de docente.' }) };
            }
        }

        try {
            const body = await request.json();
            // Esperamos un array completo de clases para hacer overwrite del state
            const classesToSave = Array.isArray(body) ? body : [body];

            // Si la clase no tiene ID, le generamos uno
            classesToSave.forEach(c => { if (!c.id) c.id = `class-${uuidv4().substring(0, 8)}`; });

            try {
                await replaceClassesForSubject(subjectId, classesToSave);
            } catch (tableErr) {
                context.error(`[StateStore] Error guardando clases en tabla para ${subjectId}:`, tableErr);
            }

            await saveJson(CONTAINER_CLASSES, `${subjectId}.json`, classesToSave);

            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, classes: classesToSave }) };
        } catch (err) {
            context.error(err);
            return { status: 500, body: JSON.stringify({ error: `Error interno guardando clases: ${err.message}` }) };
        }
    }
});

// ── GET /api/class-summary/{classId} ───────────────────────────────
// Devuelve el resumen generado por IA para una clase
app.http('get-class-summary', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'class-summary/{classId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const classId = request.params.classId;
        const CONTAINER_SUMMARIES = 'class-summaries';
        try {
            const summaryData = await loadJson(CONTAINER_SUMMARIES, `${classId}.json`);
            // Retornamos 200 con { summary: null } en lugar de 404 para evitar que el frontend rompa
            if (!summaryData) return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId, summary: null }) };
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summaryData) };
        } catch (err) {
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId, summary: null, error: err.message }) };
        }
    }
});

// ── GET /api/class-map/{classId} ───────────────────────────────────
// Devuelve el código Mermaid del mapa conceptual generado por IA
app.http('get-class-map', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'class-map/{classId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const classId = request.params.classId;
        const CONTAINER_MAPS = 'class-maps';
        try {
            const mapData = await loadJson(CONTAINER_MAPS, `${classId}.json`);
            if (!mapData) return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId, mapCode: null }) };
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mapData) };
        } catch (err) {
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classId, mapCode: null, error: err.message }) };
        }
    }
});

// ── POST /api/class-map/{classId} ──────────────────────────────────
// Guarda o actualiza un mapa conceptual
app.http('save-class-map', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'class-map/{classId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Forbidden - Teacher access required" }) };
        }

        const classId = request.params.classId;
        const CONTAINER_MAPS = 'class-maps';
        try {
            const body = await request.json(); // { mapCode: "..." }
            const existingData = await loadJson(CONTAINER_MAPS, `${classId}.json`) || { classId };
            const updatedData = { ...existingData, mapCode: body.mapCode, lastModifiedAt: new Date().toISOString() };
            await saveJson(CONTAINER_MAPS, `${classId}.json`, updatedData);
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedData) };
        } catch (err) {
            return { status: 500, body: JSON.stringify({ error: `Error guardando mapa: ${err.message}` }) };
        }
    }
});

// ── POST /api/class-summary/{classId} ──────────────────────────────
// Guarda o valida un resumen (acción del docente)
app.http('save-class-summary', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'class-summary/{classId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const classId = request.params.classId;
        const CONTAINER_SUMMARIES = 'class-summaries';
        const principal = parseClientPrincipal(request);
        
        const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Forbidden - Teacher access required" }) };
        }
        
        try {
            const body = await request.json(); // { summary: "...", validated: true }
            const existingData = await loadJson(CONTAINER_SUMMARIES, `${classId}.json`) || { classId };
            
            const updatedData = {
                ...existingData,
                summary: body.summary,
                lastModifiedAt: new Date().toISOString(),
                lastModifiedBy: principal?.userDetails || 'docente',
                validated: body.validated || false
            };

            await saveJson(CONTAINER_SUMMARIES, `${classId}.json`, updatedData);

            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedData) };
        } catch (err) {
            return { status: 500, body: JSON.stringify({ error: `Error guardando resumen: ${err.message}` }) };
        }
    }
});

// ── GET /api/director/stats ──────────────────────────────────────
// Devuelve métricas agregadas para el dashboard del director
app.http('get-director-stats', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'director/stats',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
        }

        context.log('get-director-stats triggered');
        const metrics = await computeDirectorMetrics(context, POWERBI_DEFAULT_DAYS);
        const budget = computeBudgetProjection(metrics.daily);
        const spikeAlert = computeCostSpikeAlert(metrics.daily);
        const uniqueActiveUsers = metrics.totals.uniqueActiveUsers;
        const currentPeriodCost = metrics.totals.totalCost;
        const costPerActiveStudent = uniqueActiveUsers > 0 ? Number((currentPeriodCost / uniqueActiveUsers).toFixed(6)) : 0;

        const MOCK_STATS = {
            dau: metrics.latest.dau,
            dauDelta: metrics.deltas.dau,
            classesProcessed: 14,
            ragInteractions: metrics.latest.ragInteractions,
            ragDelta: metrics.deltas.ragInteractions,
            adoptionRate: 68,
            subjectAdoption: [
                { name: 'Arq. de Software', rate: 82 },
                { name: 'Diseño de BD', rate: 71 },
                { name: 'Ing. de Software I', rate: 63 },
                { name: 'Sistemas Distribuidos', rate: 44 },
            ],
            earlyAlertSummary: {
                totalStudentsAtRisk: 3,
                highRiskCount: 1,
                mediumRiskCount: 2,
                lowAttendanceCount: 2,
                lowGradeCount: 2,
                attendanceBelow60Count: 1,
                attendance60To75Count: 2,
                attendanceAbove75Count: 0,
            },
            powerBiSource: {
                mode: 'continuous-export-db',
                storage: 'Azure Table Storage',
                table: SESSION_METRICS_TABLE,
                windowDays: metrics.windowDays,
                updatedAt: metrics.updatedAt,
            },
            costBySubject: metrics.costBySubject,
            wausBySubject: metrics.wausBySubject,
            materialUploads: metrics.materialUploads,
            budget,
            spikeAlert,
            costPerActiveStudent,
        };
        return { 
            status: 200, 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(MOCK_STATS) 
        };
    }
});

// ── GET /api/director/powerbi-metrics ─────────────────────────────
// Exposición de métricas DAU + tokens para Power BI (Issue #75)
app.http('get-director-powerbi-metrics', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'director/powerbi-metrics',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
        }

        const days = request.query.get('days') || POWERBI_DEFAULT_DAYS;
        const subjectId = request.query.get('subjectId') || '';
        const metrics = await computeDirectorMetrics(context, days);
        const budget = computeBudgetProjection(metrics.daily);

        let costByClass = [];
        if (subjectId) {
            const classGroups = {};
            for (const row of metrics._rawRows || []) {
                const sId = String(row?.subjectId || '').trim();
                if (sId !== subjectId) continue;
                const eventType = String(row?.eventType || '').trim();
                if (eventType === 'material-upload') continue;
                const hasTokens = Number(row?.promptTokens || 0) > 0 || Number(row?.completionTokens || 0) > 0;
                if (!hasTokens) continue;
                const cId = safeObjectKey(String(row?.classId || 'unknown').trim());
                const cost = computeInputCost(Number(row?.promptTokens || 0)) + computeOutputCost(Number(row?.completionTokens || 0));
                if (!classGroups[cId]) classGroups[cId] = { classId: cId, cost: 0, interactions: 0 };
                classGroups[cId].cost += cost;
                classGroups[cId].interactions += 1;
            }
            costByClass = Object.values(classGroups).map(c => ({
                classId: c.classId,
                cost: Number(c.cost.toFixed(6)),
                interactions: c.interactions,
            }));
        }

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: {
                    mode: 'continuous-export-db',
                    storage: 'Azure Table Storage',
                    table: SESSION_METRICS_TABLE,
                    integrationHint: 'Power BI can connect directly to exported DB metrics via this endpoint or Azure Table connector.',
                },
                pricing: {
                    inputPerMillionTokensUsd: 0.15,
                    outputPerMillionTokensUsd: 0.60,
                    inputPerTokenUsd: 0.00000015,
                    outputPerTokenUsd: 0.0000006,
                },
                summary: {
                    totalPromptTokens: metrics.totals.promptTokens,
                    totalCompletionTokens: metrics.totals.completionTokens,
                    totalTokens: metrics.totals.totalTokens,
                    totalInteractions: metrics.totals.ragInteractions,
                    totalCostUsd: metrics.totals.totalCost,
                    avgCostPerInteractionUsd: Number((metrics.totals.totalCost / Math.max(metrics.totals.ragInteractions, 1)).toFixed(8)),
                },
                updatedAt: metrics.updatedAt,
                windowDays: metrics.windowDays,
                daily: metrics.daily,
                costBySubject: metrics.costBySubject,
                costByClass,
                projectedEndOfMonth: budget.projectedEndOfMonth,
            }),
        };
    }
});

// ── DELETE /api/materials/{id} ────────────────────────────────────
// Borra un material (del JSON. Dejar pendiente limpieza en vector store)
app.http('delete-material', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'materials/{materialId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const principal = parseClientPrincipal(request);
        // In direct Function App calls (without SWA proxy), x-ms-client-principal may be absent.
        // For the pilot, allow deletion when principal header is missing.
        const isAuthorized = !principal
            || principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role))
            || process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development";
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Forbidden - Teacher access required" }) };
        }

        const materialId = request.params.materialId;
        try {
            // Limpieza en Vector Store
            try {
                await vectorStore.deleteVectorsByFilter({ materialId: { "$eq": materialId } });
                context.log(`[DeleteMaterial] Vectores para ${materialId} eliminados.`);
            } catch (vErr) {
                context.error(`[DeleteMaterial] Error eliminando vectores de ${materialId}:`, vErr);
            }

            try {
                await deleteMaterialStateById(materialId);
            } catch (tableErr) {
                context.error(`[StateStore] Error eliminando material ${materialId} de tablas:`, tableErr);
            }

            await deleteBlob(CONTAINER_PROCESSED, `${materialId}.json`);
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
        } catch (err) {
            context.error(err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `No se pudo borrar el material: ${err.message}` }) };
        }
    }
});

// ── POST /api/materials/{materialId}/reprocess ─────────────────────────
// Re-intenta procesar un material que falló
app.http('reprocess-material', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'materials/{materialId}/reprocess',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const principal = parseClientPrincipal(request);
        const isAuthorized = !principal
            || principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role))
            || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
        }

        const materialId = request.params.materialId;
        if (!materialId || typeof materialId !== 'string' || !materialId.trim()) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'materialId es requerido' }) };
        }
        const subjectId = request.query.get('subjectId');
        if (!subjectId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'subjectId es requerido' }) };
        }

        try {
            const material = await getMaterialState(subjectId, materialId);
            if (!material) {
                return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Material no encontrado' }) };
            }

            if (material.status !== 'error') {
                return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Solo se pueden reprocesar materiales con estado "error"' }) };
            }

            // 1. Eliminar vectores existentes en Pinecone
            try {
                await vectorStore.deleteVectorsByMaterialId(materialId);
                context.log(`[Reprocess] Vectores eliminados para ${materialId}`);
            } catch (vErr) {
                context.error(`[Reprocess] Error eliminando vectores de ${materialId}:`, vErr);
            }

            // 2. Eliminar blob de procesado anterior
            try {
                await deleteBlob(CONTAINER_PROCESSED, `${materialId}.json`);
            } catch (bErr) {
                context.error(`[Reprocess] Error eliminando blob procesado para ${materialId}:`, bErr);
            }

            // 3. Re-subir blob original para re-triggerear el pipeline
            const containerName = process.env.AZURE_STORAGE_CONTAINER_MATERIALS || 'class-materials';
            const classId = Array.isArray(material.classIds) && material.classIds.length > 0 ? material.classIds[0] : 'unknown';
            const blobName = `${classId}/${materialId}-${material.filename || 'file'}`;
            const originalBlobUrl = material.blobUrl;

            if (originalBlobUrl) {
                try {
                    const response = await fetch(originalBlobUrl);
                    if (response.ok) {
                        const buffer = Buffer.from(await response.arrayBuffer());
                        const contentType = response.headers.get('content-type') || 'application/octet-stream';
                        await uploadFile(containerName, blobName, buffer, contentType);
                        context.log(`[Reprocess] Blob re-subido para ${materialId}`);
                    }
                } catch (fetchErr) {
                    context.error(`[Reprocess] Error re-subiendo blob para ${materialId}:`, fetchErr);
                }
            }

            // 4. Resetear estado
            delete material.processedAt;
            const updated = await upsertMaterialState({
                ...material,
                status: 'pending',
                errorMessage: '',
            }, 'Merge');

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, material: updated }),
            };
        } catch (err) {
            context.error(err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `No se pudo reprocesar el material: ${err.message}` }) };
        }
    },
});

// ── PATCH /api/materials/{materialId} ────────────────────────────────────
// Actualiza metadatos de un material (type, classIds, reviewed)
app.http('update-material', {
    methods: ['PATCH'],
    authLevel: 'anonymous',
    route: 'materials/{materialId}',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden' }) };
        const principal = parseClientPrincipal(request);
        const isAuthorized = !principal
            || principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role))
            || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
        }

        const materialId = request.params.materialId;
        let body;
        try {
            body = await request.json();
        } catch {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Body JSON inválido' }) };
        }

        const subjectId = body.subjectId;
        if (!subjectId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'subjectId es requerido' }) };
        }

        try {
            const existing = await getMaterialState(subjectId, materialId);
            if (!existing) {
                return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Material no encontrado' }) };
            }

            const updates = {};
            if (body.type) updates.type = body.type;
            if (body.classIds) updates.classIds = body.classIds;
            if (body.filename) updates.filename = body.filename;
            if (typeof body.reviewed === 'boolean') updates.reviewed = body.reviewed;
            if (body.priority === 'primary' || body.priority === 'secondary') updates.priority = body.priority;

            const updated = await upsertMaterialState({
                ...existing,
                materialId: existing.materialId || existing.id,
                subjectId,
                ...updates,
            }, 'Merge');

            context.log(`[UpdateMaterial] ${materialId} updated:`, JSON.stringify(updates));
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, material: updated }) };
        } catch (err) {
            context.error(`[UpdateMaterial] Error updating ${materialId}:`, err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Error al actualizar: ${err.message}` }) };
        }
    }
});

// ── GET /api/materials/{materialId}/text ──────────────────────────────
// Devuelve el texto extraído de un material desde el blob processed/{id}.json
app.http('get-material-text', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'materials/{materialId}/text',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden' }) };

        const materialId = request.params.materialId;
        const subjectId = request.query.get('subjectId');

        try {
            const processed = await loadJson(CONTAINER_PROCESSED, `${materialId}.json`);
            if (!processed) {
                return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '', error: 'No se encontró texto procesado' }) };
            }

            const text = processed.extractedText || processed.text || '';
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, chunkCount: processed.chunks?.length || 0, filename: processed.filename || '' })
            };
        } catch (err) {
            context.error(`[GetMaterialText] Error for ${materialId}:`, err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '', error: err.message }) };
        }
    }
});

// ── PUT /api/materials/{materialId}/text ──────────────────────────────
// Actualiza texto extraído y re-genera embeddings
app.http('update-material-text', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'materials/{materialId}/text',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden' }) };
        const principal = parseClientPrincipal(request);
        const isAuthorized = !principal
            || principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role))
            || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden' }) };
        }

        const materialId = request.params.materialId;
        let body;
        try {
            body = await request.json();
        } catch {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Body JSON inválido' }) };
        }

        const { subjectId, text } = body;
        if (!subjectId || typeof text !== 'string') {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'subjectId y text son requeridos' }) };
        }

        try {
            // 1. Load existing processed blob
            const processed = await loadJson(CONTAINER_PROCESSED, `${materialId}.json`) || {};
            const materialState = await getMaterialState(subjectId, materialId);

            // 2. Delete old vectors
            try {
                await vectorStore.deleteVectorsByFilter({ materialId: { '$eq': materialId } });
                context.log(`[UpdateMaterialText] Deleted old vectors for ${materialId}`);
            } catch (vErr) {
                context.error(`[UpdateMaterialText] Error deleting vectors:`, vErr);
            }

            // 3. Re-chunk and re-embed
            const { chunkText } = await import('../services/parser.js');
            const chunks = chunkText(text);

            const { generateEmbeddingsBatch } = await import('../services/ai.js');
            const chunkTexts = chunks.map(c => c.text);
            const { embeddings } = await generateEmbeddingsBatch(chunkTexts);

            // 4. Upsert to Pinecone
            const classIds = materialState?.classIds || processed.classIds || [];
            const vectors = embeddings.map((embedding, i) => ({
                id: `${materialId}-chunk-${i}`,
                values: embedding,
                metadata: {
                    subjectId,
                    classId: classIds[0] || '',
                    classIds: JSON.stringify(classIds),
                    materialId,
                    materialType: materialState?.type || processed.materialType || 'notes',
                    chunkIndex: i,
                    sourceFilename: materialState?.filename || processed.filename || '',
                    text: chunkTexts[i]?.substring(0, 1000) || '',
                }
            }));

            await vectorStore.upsertVectors(vectors);

            // 5. Update processed blob
            processed.extractedText = text;
            processed.text = text;
            processed.chunks = chunks;
            processed.chunkCount = chunks.length;
            processed.processedAt = new Date().toISOString();
            await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, processed);

            // 6. Update state
            if (materialState) {
                await upsertMaterialState({
                    ...materialState,
                    materialId,
                    subjectId,
                    status: 'ready',
                    chunkCount: chunks.length,
                    processedAt: new Date().toISOString(),
                }, 'Merge');
            }

            context.log(`[UpdateMaterialText] ${materialId}: re-indexed ${chunks.length} chunks.`);
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, chunkCount: chunks.length })
            };
        } catch (err) {
            context.error(`[UpdateMaterialText] Error for ${materialId}:`, err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
        }
    }
});

// ── GET /api/director/session-metrics-history ─────────────────────────
// Devuelve el histórico de sesiones con paginación por cursor.
// Acepta subjectId, limit y continuationToken opcionales.
app.http('get-director-session-metrics-history', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'director/session-metrics-history',
    handler: async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const principal = parseClientPrincipal(request);
        const isAuthorized = principal?.userRoles?.some(role => ['Director'].includes(role)) || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
        if (!isAuthorized) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
        }

        const subjectId = (request.query.get('subjectId') || '').trim();
        const limit = normalizeLimit(request.query.get('limit'), 1000);
        const rawToken = request.query.get('continuationToken') || '';
        let continuationToken = null;
        if (rawToken) {
            try {
                const decoded = Buffer.from(rawToken, 'base64').toString('utf-8');
                const parsed = JSON.parse(decoded);
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                    throw new Error('token must be an object');
                }
                continuationToken = parsed;
            } catch {
                return {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Invalid continuation token' }),
                };
            }
        }

        const result = await loadSessionMetricsRowsPaginated(context, {
            limit,
            continuationToken,
            subjectId: subjectId || undefined,
        });

        const history = result.rows
            .filter(row => String(row?.eventType || '').trim() !== 'material-upload')
            .map(row => ({
            timestamp: row.timestamp || row.Timestamp || '',
            subjectId: row.subjectId || '',
            classId: row.classId || '',
            promptTokens: Number(row.promptTokens || 0),
            completionTokens: Number(row.completionTokens || 0),
            totalTokens: Number(row.totalTokens || 0),
            sessionId: row.sessionId || '',
        }));

        const nextToken = result.continuationToken
            ? Buffer.from(JSON.stringify(result.continuationToken)).toString('base64')
            : null;

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                history,
                total: history.length,
                continuationToken: nextToken,
                hasMore: nextToken !== null,
            }),
        };
    }
});
