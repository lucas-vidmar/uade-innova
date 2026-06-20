/* ============================================================
   API Service — HTTP client with rich mock data fallback
   Contracts follow AGENTS.md section 10
   ============================================================ */

const USE_MOCK = true;
const configuredBaseUrl = (typeof import.meta !== 'undefined' && import.meta.env)
    ? String(import.meta.env.VITE_API_BASE_URL || '').trim()
    : '';

const isLocalRuntime = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const isLocalApiUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(configuredBaseUrl);

if (!isLocalRuntime && configuredBaseUrl && isLocalApiUrl) {
    console.warn('[API] Ignoring local VITE_API_BASE_URL in remote runtime:', configuredBaseUrl);
}

const BASE_URL = (!isLocalRuntime && isLocalApiUrl)
    ? '/api'
    : (configuredBaseUrl
        || (isLocalRuntime
            ? 'http://localhost:7071/api'
            : '/api'));

const CORRELATION_HEADER = 'x-correlation-id';
const TRACEPARENT_HEADER = 'traceparent';
const TRACESTATE_HEADER = 'tracestate';

function nextCorrelationId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function generateSpanId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function generateTraceParent() {
    const traceId = nextCorrelationId().replace(/-/g, '').toLowerCase().padEnd(32, '0').slice(0, 32);
    const spanId = generateSpanId();
    return `00-${traceId}-${spanId}-01`;
}

function withCorrelationHeaders(headers = {}) {
    const normalized = new Headers(headers || {});
    if (!normalized.has(CORRELATION_HEADER)) {
        normalized.set(CORRELATION_HEADER, nextCorrelationId());
    }
    if (!normalized.has(TRACEPARENT_HEADER)) {
        const stored = window.sessionStorage.getItem('w3c_traceparent');
        normalized.set(TRACEPARENT_HEADER, stored || generateTraceParent());
    }

    // Only send mock role header in local development (no real SWA auth)
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalDev) {
        const mockRole = sessionStorage.getItem('edu_role') || 'student';
        normalized.set('x-mock-role', mockRole);
    }
    
    return normalized;
}

async function apiFetch(resource, options = {}) {
    return fetch(resource, {
        ...options,
        headers: withCorrelationHeaders(options.headers),
    });
}

const LOCAL_SUBJECTS_KEY = 'uade.local.subjects';
const LOCAL_CLASSES_KEY = 'uade.local.classes-by-subject';

function seedDemoData() {
    const demoSubjects = [
        { id: 'arq-soft-2026', name: 'Arquitectura de Software 2026', track: 'Tecnicatura', professors: ['Dr. García'] },
        { id: 'ing-datos-2026', name: 'Ingeniería de Datos 2026', track: 'Tecnicatura', professors: ['Ing. López'] },
    ];
    setLocalSubjects(demoSubjects);
    const now = new Date();
    const demoClasses = [
        { id: 'class-01', title: 'Clase 1 - Introducción', date: new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0], topics: ['Fundamentos', 'Historia'], materials: [] },
        { id: 'class-02', title: 'Clase 2 - Patrones de Diseño', date: new Date(now.getTime() - 3 * 86400000).toISOString().split('T')[0], topics: ['Patrones GoF', 'Arquitectura'], materials: [] },
        { id: 'class-03', title: 'Clase 3 - Hexagonal', date: now.toISOString().split('T')[0], topics: ['Puertos y Adaptadores', 'Dominio'], materials: [] },
    ];
    demoSubjects.forEach(s => setLocalClasses(s.id, demoClasses));
}

function readLocalJson(key, fallbackValue) {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallbackValue;
        const parsed = JSON.parse(raw);
        return parsed ?? fallbackValue;
    } catch {
        return fallbackValue;
    }
}

function writeLocalJson(key, value) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ignore localStorage quota/privacy mode errors
    }
}

function getLocalSubjects() {
    const subjects = readLocalJson(LOCAL_SUBJECTS_KEY, []);
    return Array.isArray(subjects) ? subjects : [];
}

function setLocalSubjects(subjects) {
    writeLocalJson(LOCAL_SUBJECTS_KEY, Array.isArray(subjects) ? subjects : []);
}

function upsertLocalSubject(subject) {
    const localSubjects = getLocalSubjects();
    const next = [...localSubjects];
    const idx = next.findIndex((item) => item.id === subject.id);
    if (idx >= 0) {
        next[idx] = { ...next[idx], ...subject };
    } else {
        next.push(subject);
    }
    setLocalSubjects(next);
}

function removeLocalSubject(subjectId) {
    const localSubjects = getLocalSubjects().filter((item) => item.id !== subjectId);
    setLocalSubjects(localSubjects);

    const classesBySubject = readLocalJson(LOCAL_CLASSES_KEY, {});
    if (classesBySubject && typeof classesBySubject === 'object') {
        delete classesBySubject[subjectId];
        writeLocalJson(LOCAL_CLASSES_KEY, classesBySubject);
    }
}

function getLocalClasses(subjectId) {
    const classesBySubject = readLocalJson(LOCAL_CLASSES_KEY, {});
    if (!classesBySubject || typeof classesBySubject !== 'object') return [];
    const classes = classesBySubject[subjectId];
    return Array.isArray(classes) ? classes : [];
}

function setLocalClasses(subjectId, classesArray) {
    const classesBySubject = readLocalJson(LOCAL_CLASSES_KEY, {});
    const safeMap = classesBySubject && typeof classesBySubject === 'object' ? classesBySubject : {};
    safeMap[subjectId] = Array.isArray(classesArray) ? classesArray : [];
    writeLocalJson(LOCAL_CLASSES_KEY, safeMap);
}

function mergeSubjectsWithLocal(defaultSubjects) {
    const base = Array.isArray(defaultSubjects) ? defaultSubjects : [];
    const local = getLocalSubjects();
    const map = new Map();

    base.forEach((subject) => {
        if (subject?.id) map.set(subject.id, subject);
    });
    local.forEach((subject) => {
        if (subject?.id) map.set(subject.id, { ...(map.get(subject.id) || {}), ...subject });
    });

    return Array.from(map.values());
}

/* ── Mock Data ───────────────────────────────────────────── */
const MOCK_CLASSES = [
    {
        id: 'class-01',
        subjectId: 'arq-software-2026',
        title: 'Clase 1 — Introducción a Arquitecturas de Software',
        date: '2026-03-05',
        topics: ['Definición de arquitectura', 'Patrones arquitectónicos', 'Atributos de calidad'],
        summaryReady: true,
        professorIds: ['u-01'],
        studentIds: ['u-02', 'u-03'],
        materials: [
            { id: 'm-01', classId: 'class-01', type: 'transcript', filename: 'clase1_transcripcion.txt', status: 'ready', uploadedAt: '2026-03-05T10:00:00Z', mimeType: 'text/plain' },
            { id: 'm-02', classId: 'class-01', type: 'presentation', filename: 'clase1_slides.pdf', status: 'ready', uploadedAt: '2026-03-05T10:05:00Z', mimeType: 'application/pdf' },
        ],
    },
    {
        id: 'class-02',
        subjectId: 'arq-software-2026',
        title: 'Clase 2 — Estilos Arquitectónicos',
        date: '2026-03-12',
        topics: ['Arquitectura en capas', 'Cliente-Servidor', 'Microservicios', 'Event-Driven'],
        summaryReady: true,
        materials: [
            { id: 'm-03', classId: 'class-02', type: 'transcript', filename: 'clase2_transcripcion.vtt', status: 'ready', uploadedAt: '2026-03-12T10:00:00Z', mimeType: 'text/vtt' },
            { id: 'm-04', classId: 'class-02', type: 'presentation', filename: 'clase2_estilos.pptx', status: 'ready', uploadedAt: '2026-03-12T10:02:00Z', mimeType: 'application/vnd.ms-powerpoint' },
            { id: 'm-05', classId: 'class-02', type: 'notes', filename: 'apuntes_clase2.docx', status: 'ready', uploadedAt: '2026-03-12T11:00:00Z', mimeType: 'application/docx' },
        ],
    },
    {
        id: 'class-03',
        subjectId: 'arq-software-2026',
        title: 'Clase 3 — Arquitectura Hexagonal y DDD',
        date: '2026-03-19',
        topics: ['Puertos y adaptadores', 'Domain-Driven Design', 'Bounded Contexts', 'Aggregates'],
        summaryReady: false,
        materials: [
            { id: 'm-06', classId: 'class-03', type: 'transcript', filename: 'clase3_transcript.txt', status: 'processing', uploadedAt: '2026-03-19T10:00:00Z', mimeType: 'text/plain' },
        ],
    },
    {
        id: 'class-04',
        subjectId: 'arq-software-2026',
        title: 'Clase 4 — Patrones SAGA y CQRS',
        date: '2026-03-26',
        topics: ['SAGA pattern', 'CQRS', 'Event Sourcing', 'Consistencia eventual'],
        summaryReady: false,
        materials: [],
    },
    {
        id: 'class-05',
        subjectId: 'arq-software-2026',
        title: 'Clase 5 — API Design & REST',
        date: '2026-04-02',
        topics: ['REST constraints', 'OpenAPI', 'Versionado', 'HATEOAS'],
        summaryReady: false,
        materials: [],
    },
    {
        id: 'class-06',
        subjectId: 'arq-software-2026',
        title: 'Clase 6 — Seguridad en Arquitecturas',
        date: '2026-04-09',
        topics: ['Zero Trust', 'OAuth 2.0', 'mTLS', 'Defense in depth'],
        summaryReady: false,
        materials: [],
    },
];

const MOCK_DIRECTOR_STATS = {
    dau: 52,
    dauDelta: '+8%',
    classesProcessed: 14,
    ragInteractions: 734,
    ragDelta: '+23%',
    adoptionRate: 68,
    subjectAdoption: [
        { name: 'Arq. de Software', rate: 82 },
        { name: 'Diseño de BD', rate: 71 },
        { name: 'Ing. de Software I', rate: 63 },
        { name: 'Sistemas Distribuidos', rate: 44 },
    ],
    costBySubject: [
        { subjectId: 'arq-software-2026', subjectName: 'Arq. de Software', dailyCost: [{ date: '2026-05-25', cost: 0.0023, ragInteractions: 12 }, { date: '2026-05-26', cost: 0.0018, ragInteractions: 9 }] },
        { subjectId: 'diseno-bd-2026', subjectName: 'Diseño de BD', dailyCost: [{ date: '2026-05-25', cost: 0.0015, ragInteractions: 8 }, { date: '2026-05-26', cost: 0.0020, ragInteractions: 11 }] },
    ],
    wausBySubject: [
        { subjectId: 'arq-software-2026', subjectName: 'Arq. de Software', currentWeek: 24, previousWeek: 20 },
        { subjectId: 'diseno-bd-2026', subjectName: 'Diseño de BD', currentWeek: 18, previousWeek: 22 },
    ],
    materialUploads: {
        byTeacher: [
            { teacherId: 'doc-001', transcripts: 4, presentations: 3, notes: 2, bibliography: 1, total: 10 },
            { teacherId: 'doc-002', transcripts: 2, presentations: 5, notes: 1, bibliography: 0, total: 8 },
        ],
    },
    budget: { monthlyLimit: 97.50, currentSpend: 45.32, projectedEndOfMonth: 82.15, remainingBudget: 52.18, percentUsed: 84.3, warningLevel: 'warning' },
    spikeAlert: null,
    costPerActiveStudent: 0.87,
};

const MOCK_TEACHER_ANALYTICS = {
    topQuestions: [
        { text: 'arquitectura hexagonal', count: 42 },
        { text: 'diferencia microservicios monolito', count: 38 },
        { text: 'SAGA pattern', count: 31 },
        { text: 'bounded context DDD', count: 27 },
        { text: 'event sourcing vs CQRS', count: 24 },
        { text: 'atributos de calidad', count: 19 },
        { text: 'REST vs GraphQL', count: 17 },
        { text: 'consistencia eventual', count: 15 },
    ],
    frictionTopics: [
        { topic: 'SAGA & Compensating Transactions', queries: 31, unresolved: 9 },
        { topic: 'Bounded Contexts', queries: 27, unresolved: 7 },
        { topic: 'Event Sourcing', queries: 18, unresolved: 5 },
        { topic: 'mTLS & Zero Trust', queries: 12, unresolved: 4 },
    ],
};

const MOCK_TEACHER_ALERTS = [
    {
        id: 'teacher-alert-engagement-alu-012',
        type: 'low_engagement',
        severity: 'high',
        subjectId: 'arq-software-2026',
        classId: 'class-03',
        studentId: 'alu-012',
        studentName: 'Tomás García',
        title: 'Baja participación sostenida',
        description: 'El alumno acumula 2 semanas con asistencia menor al 50% y sin interacción en consultas.',
        attendance: '45%',
        avgGrade: 4.2,
        createdAt: '2026-04-09T11:30:00Z',
        recommendedAction: 'Contactar al alumno y reforzar contenidos de Clase 3.',
    },
    {
        id: 'teacher-alert-material-class-03',
        type: 'material_report',
        severity: 'medium',
        subjectId: 'arq-software-2026',
        classId: 'class-03',
        materialId: 'm-06',
        materialType: 'transcript',
        title: 'Reporte de material: calidad de transcripción',
        description: '3 estudiantes reportaron baja claridad en la transcripción de la clase.',
        reportCount: 3,
        createdAt: '2026-04-08T12:00:00Z',
        recommendedAction: 'Revisar la transcripción y volver a procesar el archivo si corresponde.',
    },
];

function normalizeTeacherAlert(item = {}, idx = 0) {
    const type = item.type === 'material_report' ? 'material_report' : 'low_engagement';
    const severity = item.severity === 'high' ? 'high' : 'medium';
    return {
        id: item.id || `teacher-alert-${idx}`,
        type,
        severity,
        subjectId: item.subjectId || null,
        classId: item.classId || null,
        studentId: item.studentId || null,
        studentName: item.studentName || null,
        materialId: item.materialId || null,
        materialType: item.materialType || null,
        title: String(item.title || (type === 'low_engagement' ? 'Alerta de baja participación' : 'Alerta de material reportado')),
        description: String(item.description || ''),
        attendance: item.attendance || null,
        avgGrade: typeof item.avgGrade === 'number' ? item.avgGrade : null,
        reportCount: typeof item.reportCount === 'number' ? item.reportCount : 0,
        createdAt: item.createdAt || new Date().toISOString(),
        recommendedAction: String(item.recommendedAction || ''),
    };
}

const MOCK_DEADLINES = [
    {
        id: 'deadline-001',
        title: 'Final Project',
        description: 'Entrega final del proyecto integrador.',
        subjectId: 'arq-software-2026',
        classId: 'class-14',
        dueDate: '2026-04-30',
        notifyOnDayBefore: true,
        notifyOnDayOf: true,
        createdAt: '2026-03-24T10:00:00Z',
    },
];

const MOCK_NOTIFICATIONS = [
    {
        id: 'notif-grade-001',
        type: 'grade',
        title: 'Nueva nota publicada',
        message: 'Quiz Online — Estilos Arquitectónicos: 8.5',
        createdAt: '2026-03-20T11:10:00Z',
        unread: true,
        targetHash: '#/student/tasks',
        subjectId: 'arq-software-2026',
    },
    {
        id: 'notif-summary-001',
        type: 'summary',
        title: 'Resumen validado por docente',
        message: 'Clase 2 — Estilos Arquitectónicos ya tiene resumen validado.',
        createdAt: '2026-03-18T09:00:00Z',
        unread: true,
        targetHash: '#/student/dashboard',
        subjectId: 'arq-software-2026',
    },
    {
        id: 'notif-material-001',
        type: 'material',
        title: 'Nuevo material disponible',
        message: 'Se cargó clase2_estilos.pptx en Clase 2.',
        createdAt: '2026-03-17T18:45:00Z',
        unread: false,
        targetHash: '#/student/class/class-02',
        subjectId: 'arq-software-2026',
    },
];

function normalizeNotification(item = {}, idx = 0) {
    const fallbackId = item.id || `notif-${Date.now()}-${idx}`;
    const type = ['grade', 'summary', 'material', 'deadline'].includes(item.type) ? item.type : 'material';
    return {
        id: fallbackId,
        type,
        title: String(item.title || 'Nueva notificación'),
        message: String(item.message || 'Tienes una actualización académica.'),
        createdAt: item.createdAt || new Date().toISOString(),
        unread: item.unread !== false,
        targetHash: item.targetHash || '#/student/dashboard',
        subjectId: item.subjectId || null,
    };
}

function buildFallbackNotifications(subjectId, limit = 10) {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const scoped = MOCK_NOTIFICATIONS
        .filter((item) => !subjectId || item.subjectId === subjectId)
        .map((item, idx) => normalizeNotification(item, idx));

    return scoped
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, safeLimit);
}

const MOCK_GLOBAL_SEARCH_RESULTS = [
    {
        materialId: 'm-01',
        classIds: ['class-01'],
        materialType: 'transcript',
        sourceFilename: 'clase1_transcripcion.txt',
        chunkIndex: 0,
        snippet: 'En la arquitectura de software, las decisiones de diseno impactan en escalabilidad y mantenibilidad.',
        score: 0.91,
    },
    {
        materialId: 'm-08',
        classIds: ['class-03'],
        materialType: 'bibliography',
        sourceFilename: 'clean-architecture-cap1.pdf',
        chunkIndex: 2,
        snippet: 'La arquitectura hexagonal propone separar el dominio de los detalles de infraestructura.',
        score: 0.87,
    },
    {
        materialId: 'm-04',
        classIds: ['class-02'],
        materialType: 'transcript',
        sourceFilename: 'clase2_transcripcion.vtt',
        chunkIndex: 4,
        snippet: 'Comparacion de estilos de arquitectura: monolitica, capas y microservicios.',
        score: 0.82,
    },
];

/* ── Helpers ─────────────────────────────────────────────── */
function delay(ms = 600) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 5000 } = options;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const response = await apiFetch(resource, {
        ...options,
        signal: controller.signal
    });
    clearTimeout(id);
    return response;
}

/* ── API Client ──────────────────────────────────────────── */
export const api = {
    async getMaterialStatusBatch(subjectId, materialIds = []) {
        if (!subjectId || !Array.isArray(materialIds) || materialIds.length === 0) {
            return { subjectId, results: [] };
        }

        const deduped = Array.from(new Set(materialIds.map((item) => String(item || '').trim()).filter(Boolean)));
        if (deduped.length === 0) {
            return { subjectId, results: [] };
        }

        try {
            const res = await fetchWithTimeout(
                `${BASE_URL}/material-status/batch`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subjectId, materialIds: deduped }),
                    timeout: 5000,
                }
            );

            if (!res.ok) {
                if (res.status === 404) {
                    return await this._getMaterialStatusBatchGet(subjectId, deduped);
                }
                throw new Error(`Error ${res.status}: material-status-batch`);
            }

            const data = await res.json();
            const results = Array.isArray(data?.results) ? data.results : [];
            return { subjectId, results };
        } catch (err) {
            console.error('[API] getMaterialStatusBatch failed, falling back to GET:', err);
            try {
                return await this._getMaterialStatusBatchGet(subjectId, deduped);
            } catch (fallbackErr) {
                console.error('[API] getMaterialStatusBatch GET fallback also failed:', fallbackErr);
                throw fallbackErr;
            }
        }
    },

    async _getMaterialStatusBatchGet(subjectId, materialIds) {
        const params = new URLSearchParams({
            subjectId,
            materialIds: materialIds.join(','),
        });
        const res = await fetchWithTimeout(
            `${BASE_URL}/material-status?${params.toString()}`,
            { timeout: 3500 }
        );

        if (!res.ok) throw new Error(`Error ${res.status}: material-status-batch-get`);

        const data = await res.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        return { subjectId, results };
    },

    async getMaterialStatus(subjectId, materialId) {
        if (!subjectId || !materialId) return null;

        try {
            const res = await fetchWithTimeout(
                `${BASE_URL}/material-status/${encodeURIComponent(materialId)}?subjectId=${encodeURIComponent(subjectId)}`,
                { timeout: 3500 }
            );

            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`Error ${res.status}: material-status`);

            const data = await res.json();
            return data && typeof data === 'object' ? data : null;
        } catch (err) {
            console.error('[API] getMaterialStatus failed:', err);
            throw err;
        }
    },


    async getDeadlines(subjectId) {
        if (USE_MOCK) {
            await delay(350);
            return MOCK_DEADLINES.filter(item => item.subjectId === subjectId);
        }

        try {
            const res = await fetchWithTimeout(`${BASE_URL}/deadlines?subjectId=${subjectId}`, { timeout: 3000 });
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('[API] getDeadlines failed:', err);
            return MOCK_DEADLINES.filter(item => item.subjectId === subjectId);
        }
    },

    async saveDeadline(payload) {
        if (USE_MOCK) {
            return {
                ...payload,
                id: payload.id || `deadline-${Date.now()}`,
                createdAt: payload.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
        }

        const res = await apiFetch(`${BASE_URL}/deadlines`, {
            method: payload.id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            throw new Error(`Error ${res.status}: No se pudo guardar el deadline`);
        }

        return res.json();
    },

    async getDeadlineReminders(subjectId, today) {
        if (USE_MOCK) {
            const target = today || new Date().toISOString().slice(0, 10);
            const dayBefore = target === '2026-04-29';
            const dayOf = target === '2026-04-30';
            return MOCK_DEADLINES.filter(d => d.subjectId === subjectId && ((dayBefore && d.notifyOnDayBefore) || (dayOf && d.notifyOnDayOf)));
        }

        try {
            const params = new URLSearchParams({ subjectId });
            if (today) params.set('today', today);
            const res = await apiFetch(`${BASE_URL}/deadline-reminders?${params.toString()}`);
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('[API] getDeadlineReminders failed:', err);
            return [];
        }
    },

    async globalSearch({ query, subjectId }) {
        if (USE_MOCK) {
            await delay(450);
            const needle = String(query || '').toLowerCase();
            const results = MOCK_GLOBAL_SEARCH_RESULTS.filter(item =>
                item.snippet.toLowerCase().includes(needle) || item.sourceFilename.toLowerCase().includes(needle)
            );
            return { query, subjectId, total: results.length, results };
        }

        const res = await apiFetch(`${BASE_URL}/global-search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, subjectId }),
        });

        if (!res.ok) {
            let errorMessage = 'Error en búsqueda global';
            let errorCategory = null;
            try {
                const errorData = await res.json();
                if (errorData && errorData.error) errorMessage = errorData.error;
                if (errorData && errorData.errorCategory) errorCategory = errorData.errorCategory;
            } catch { /* ignore parse errors */ }
            const apiError = new Error(`Error ${res.status}: ${errorMessage}`);
            apiError.status = res.status;
            apiError.errorCategory = errorCategory;
            throw apiError;
        }

        const data = await res.json();
        return data && Array.isArray(data.results) ? data : { query, subjectId, total: 0, results: [] };
    },

    async getNotifications({ userId, subjectId, limit = 10, skip = 0, type } = {}) {
        if (USE_MOCK) {
            await delay(250);
            return buildFallbackNotifications(subjectId, limit);
        }

        try {
            const params = new URLSearchParams();
            if (userId) params.set('userId', userId);
            if (subjectId) params.set('subjectId', subjectId);
            if (limit) params.set('limit', String(limit));
            if (skip > 0) params.set('skip', String(skip));
            if (type) params.set('type', type);

            const query = params.toString();
            const res = await fetchWithTimeout(`${BASE_URL}/notifications${query ? `?${query}` : ''}`, { timeout: 3500 });

            if (!res.ok) {
                return buildFallbackNotifications(subjectId, limit);
            }

            const data = await res.json();
            if (!Array.isArray(data)) {
                return buildFallbackNotifications(subjectId, limit);
            }

            return data
                .map((item, idx) => normalizeNotification(item, idx))
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, Math.min(Math.max(Number(limit) || 10, 1), 50));
        } catch (err) {
            console.error('[API] getNotifications failed:', err);
            return buildFallbackNotifications(subjectId, limit);
        }
    },

    async markNotificationRead({ notificationId, userId, subjectId } = {}) {
        if (!notificationId || !userId || !subjectId) {
            throw new Error('Missing required fields: notificationId, userId, subjectId');
        }

        const res = await apiFetch(`${BASE_URL}/notifications/${encodeURIComponent(notificationId)}/read`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, subjectId }),
        });

        if (!res.ok) {
            let message = `Error ${res.status}: No se pudo marcar la notificación como leída`;
            try {
                const payload = await res.json();
                if (payload?.error) message = payload.error;
            } catch {
                // no-op
            }
            throw new Error(message);
        }

        return res.json();
    },

    async markNotificationsRead({ notificationIds = [], userId, subjectId } = {}) {
        if (!userId || !subjectId) {
            throw new Error('Missing required fields: userId, subjectId');
        }

        const ids = Array.isArray(notificationIds)
            ? Array.from(new Set(notificationIds.map((item) => String(item || '').trim()).filter(Boolean)))
            : [];

        const res = await apiFetch(`${BASE_URL}/notifications/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, subjectId, notificationIds: ids }),
        });

        if (!res.ok) {
            let message = `Error ${res.status}: No se pudieron marcar las notificaciones como leídas`;
            try {
                const payload = await res.json();
                if (payload?.error) message = payload.error;
            } catch {
                // no-op
            }
            throw new Error(message);
        }

        return res.json();
    },

    /**
     * Subscribes to the SSE notification stream.
     * @param {Object} opts - { userId, subjectId }
     * @param {Function} onEvent - Callback (eventType, data) => void
     * @returns {Promise<Response>} The fetch Response object (caller should read the body stream)
     */
    async subscribeNotificationStream({ userId, subjectId, signal } = {}, onEvent) {
        if (USE_MOCK) {
            onEvent('snapshot', { notifications: buildFallbackNotifications(subjectId, 10), userId });
            return;
        }

        const params = new URLSearchParams();
        if (userId) params.set('userId', userId);
        if (subjectId) params.set('subjectId', subjectId);

        const query = params.toString();
        const response = await apiFetch(`${BASE_URL}/notifications/stream${query ? `?${query}` : ''}`);

        if (!response.ok) {
            const body = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(body.error || `Stream connection failed (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                if (signal?.aborted) break;
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop();

                if (buffer.length > 50000) {
                    buffer = '';
                }

                for (const part of parts) {
                    if (!part.trim()) continue;
                    const lines = part.split('\n');
                    let eventType = 'message';
                    let data = null;

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            eventType = line.slice(7).trim();
                        } else if (line.startsWith('data: ')) {
                            try {
                                data = JSON.parse(line.slice(6));
                            } catch {
                                // skip unparseable data
                            }
                        }
                    }

                    if (data && typeof onEvent === 'function') {
                        onEvent(eventType, data);
                    }
                }
            }
        } catch (err) {
            if (signal?.aborted) return;
            throw err;
        }
    },

    async getSubjects() {
        if (USE_MOCK) {
            await delay(400);
            const existing = getLocalSubjects();
            if (existing.length === 0) {
                seedDemoData();
            }
            return mergeSubjectsWithLocal([]);
        }
        try {
            const res = await apiFetch(`${BASE_URL}/subjects`);
            if (!res.ok) {
                return mergeSubjectsWithLocal([]);
            }
            const data = await res.json();
            const subjects = Array.isArray(data) ? data : [];
            return mergeSubjectsWithLocal(subjects);
        } catch (err) {
            console.error('[API] getSubjects failed:', err);
            return mergeSubjectsWithLocal([]);
        }
    },

    async saveSubject(subject) {
        if (USE_MOCK) {
            await delay(250);
            const mockSubject = { 
                ...subject, 
                id: subject.id || `subject-${Date.now()}`,
                name: subject.name || 'Nueva Materia'
            };
            upsertLocalSubject(mockSubject);
            return mockSubject;
        }

        const method = subject?.id ? 'PUT' : 'POST';
        try {
            const res = await apiFetch(`${BASE_URL}/subjects`, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(subject),
            });

            if (!res.ok) {
                let message = `Error ${res.status}: No se pudo guardar la materia`;
                try {
                    const err = await res.json();
                    if (err?.error) message = err.error;
                } catch {
                    // no-op
                }

                if (res.status >= 500 || res.status === 404) {
                    const fallbackSubject = {
                        id: subject.id || `subject-${Date.now()}`,
                        name: subject.name,
                        oneLiner: subject.oneLiner || '',
                        comment: subject.comment || subject.oneLiner || '',
                    };
                    upsertLocalSubject(fallbackSubject);
                    return fallbackSubject;
                }

                throw new Error(message);
            }

            const data = await res.json();
            if (data?.id) upsertLocalSubject({ ...subject, ...data });
            return data;
        } catch (err) {
            console.error('[API] saveSubject failed:', err);
            throw err;
        }
    },

    async getClasses(subjectId) {
        const localClassesBySubject = readLocalJson(LOCAL_CLASSES_KEY, {});
        const localClasses = Array.isArray(localClassesBySubject[subjectId]) ? localClassesBySubject[subjectId] : [];

        if (USE_MOCK) {
            await delay(400);
            return localClasses;
        }

        try {
            const res = await apiFetch(`${BASE_URL}/classes?subjectId=${subjectId}`);
            if (!res.ok) return localClasses;
            const data = await res.json();
            const classes = Array.isArray(data) ? data : [];
            setLocalClasses(subjectId, classes);
            return classes;
        } catch (err) {
            console.error('[API] getClasses failed:', err);
            return localClasses;
        }
    },

    /**
     * Elimina una materia.
     * @param {string} subjectId 
     * @param {boolean} cascade - Si es true, elimina también clases y materiales asociados.
     */
    async deleteSubject(subjectId, cascade = false) {
        if (USE_MOCK) {
            await delay(250);
            return { success: true };
        }

        try {
            const url = new URL(`${BASE_URL}/subjects/${encodeURIComponent(subjectId)}`);
            if (cascade) url.searchParams.set('cascade', 'true');

            const res = await apiFetch(url.toString(), {
                method: 'DELETE',
            });

            if (!res.ok) {
                // Si el servidor dice que no existe, lo removemos de local igualmente para sincronizar
                if (res.status === 404) {
                    removeLocalSubject(subjectId);
                }
                
                let message = `Error ${res.status}: No se pudo eliminar la materia`;
                try {
                    const err = await res.json();
                    if (err?.error) message = err.error;
                } catch {
                    // no-op
                }
                throw new Error(message);
            }

            // Éxito: limpiar de local storage
            removeLocalSubject(subjectId);
            return res.json();
        } catch (err) {
            console.error('[API] deleteSubject failed:', err);
            throw err;
        }
    },

    async saveClasses(subjectId, classesArray) {
        if (USE_MOCK) return;
        try {
            const res = await apiFetch(`${BASE_URL}/classes?subjectId=${subjectId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(classesArray)
            });
            if (!res.ok) {
                if (res.status >= 500 || res.status === 404) {
                    setLocalClasses(subjectId, classesArray);
                    return { success: true, classes: classesArray, fallback: true };
                }
                throw new Error(`Error ${res.status}: Falló el guardado en el servidor`);
            }
            const data = await res.json();
            setLocalClasses(subjectId, classesArray);
            return data;
        } catch (err) {
            setLocalClasses(subjectId, classesArray);
            return { success: true, classes: classesArray, fallback: true };
        }
    },

    async deleteMaterial(materialId) {
        if (USE_MOCK) return;
        const res = await apiFetch(`${BASE_URL}/materials/${materialId}`, { method: 'DELETE' });

        if (!res.ok) {
            let message = `Error ${res.status}: no se pudo eliminar el material`;
            try {
                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const err = await res.json();
                    if (err?.error) message = err.error;
                } else {
                    const text = await res.text();
                    if (text) message = text;
                }
            } catch {
                // no-op
            }
            throw new Error(message);
        }

        return res.json();
    },

    async reprocessMaterial(materialId, subjectId) {
        if (!materialId) throw new Error('materialId es requerido');
        if (!subjectId) throw new Error('subjectId es requerido');
        if (USE_MOCK) {
            await delay(600);
            return { success: true };
        }
        const res = await apiFetch(`${BASE_URL}/materials/${encodeURIComponent(materialId)}/reprocess?subjectId=${encodeURIComponent(subjectId)}`, {
            method: 'POST',
        });

        if (!res.ok) {
            let message = `Error ${res.status}: no se pudo reprocesar el material`;
            try {
                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const err = await res.json();
                    if (err?.error) message = err.error;
                } else {
                    const text = await res.text();
                    if (text) message = text;
                }
            } catch {
                // no-op
            }
            throw new Error(message);
        }

        return res.json();
    },

    async ragQuery({ question, classIds, subjectId, conversationHistory = [], historyWindowSize = 4, transcriptFocus = null }) {
        if (USE_MOCK) {
            await delay(1200);
            const q = question.toLowerCase();
            const match = MOCK_RAG_RESPONSES.find(r => r.question.some(kw => q.includes(kw)));
            const response = match || {
                answer: `Basándome en las clases seleccionadas (${classIds.length} clase${classIds.length !== 1 ? 's' : ''}), no encontré una respuesta específica para tu consulta sobre "${question}". Sin embargo, te recomiendo revisar los apuntes de las clases sobre patrones arquitectónicos y el resumen de la Clase 1.`,
                sources: [],
            };
            return { ...response, verified: response.verified || false };
        }
        try {
            const res = await apiFetch(`${BASE_URL}/rag-query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, classIds, subjectId, stream: false, conversationHistory, historyWindowSize, transcriptFocus }),
            });

            if (res.status === 429) {
                throw new Error('The AI tutor is resting, please try again in a few minutes');
            }

            if (!res.ok) {
                return { answer: 'Lo siento, no pude obtener una respuesta de la IA en este momento.', sources: [] };
            }

            return res.json();
        } catch (err) {
            console.error('[API] ragQuery failed:', err);
            return { answer: 'Error de conexión con el servicio de IA.', sources: [] };
        }
    },

    /**
     * Realiza una consulta RAG con streaming (SSE).
     * @param {Object} params - { question, classIds, subjectId }
     * @param {Function} onEvent - Callback para cada evento del stream: (type, data) => void
     */
    async ragQueryStream({ question, classIds, subjectId, sessionId, conversationHistory =[], historyWindowSize = 4, transcriptFocus = null }, onEvent) {
            if (USE_MOCK) {
                // Simular streaming para mocks
                await delay(400);
                onEvent('metadata', {
                    interactionId: 'mock-id-' + Date.now(),
                    sources: [
                        { materialType: 'transcript', sourceFilename: 'clase3_transcript.txt', classId: 'class-03' },
                        { materialType: 'presentation', sourceFilename: 'clase3_slides.pdf', classId: 'class-03' }
                    ],
                    verified: false,
                });
                const mockText = "Esta es una respuesta simulada por stream. La arquitectura hexagonal permite desacoplar la lógica de negocio de los detalles técnicos.";
                const words = mockText.split(' ');
                for (const word of words) {
                    await delay(50);
                    onEvent('delta', { content: word + ' ' });
                }
                onEvent('done', { answer: mockText });
                return;
            }

            const response = await apiFetch(`${BASE_URL}/rag-query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, classIds, subjectId, sessionId, stream: true, conversationHistory, historyWindowSize, transcriptFocus }),
            });

            if (response.status === 429) {
                const rateLimitError = new Error('The AI tutor is resting, please try again in a few minutes');
                rateLimitError.errorCategory = 'LLM';
                throw rateLimitError;
            }

            if (!response.ok) {
                let errorMessage = `No se pudo iniciar el stream de respuesta`;
                let errorCategory = null;
                try {
                    const errorData = await response.json();
                    if (errorData && errorData.error) {
                        errorMessage = errorData.error;
                    }
                    if (errorData && errorData.errorCategory) {
                        errorCategory = errorData.errorCategory;
                    }
                } catch (e) {
                    // Si no es JSON, usamos el statusText o el mensaje por defecto
                    errorMessage = response.statusText || errorMessage;
                }
                const apiError = new Error(`Error ${response.status}: ${errorMessage}`);
                apiError.status = response.status;
                if (errorCategory) apiError.errorCategory = errorCategory;
                throw apiError;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const parts = buffer.split('\n\n');
                    buffer = parts.pop(); // El último puede estar incompleto

                    for (const part of parts) {
                        if (!part.trim()) continue;

                        const lines = part.split('\n');
                        let eventType = 'message';
                        let data = null;

                        for (const line of lines) {
                            if (line.startsWith('event: ')) {
                                eventType = line.slice(7).trim();
                            } else if (line.startsWith('data: ')) {
                                try {
                                    data = JSON.parse(line.slice(6));
                                } catch (e) {
                                    console.error('Error parseando SSE data:', line);
                                }
                            }
                        }

                        if (data) {
                            onEvent(eventType, data);
                        }
                    }
                }
            } catch (err) {
                console.error('[API] Stream interrupted:', err);
                throw err;
            }
        },

    async ingestMaterial(formData) {
            if (USE_MOCK) {
                await delay(800);
                return { materialId: `m-${Date.now()}`, status: 'processing' };
            }
            try {
                const res = await apiFetch(`${BASE_URL}/ingest-material`, { method: 'POST', body: formData });

                if (!res.ok) {
                    if (USE_MOCK || (res.status === 404 && window.location.hostname === 'localhost')) {
                        return {
                            materialId: `m-local-${Date.now()}`,
                            status: 'processing',
                            fallback: true,
                        };
                    }

                    let message = `Error ${res.status}: no se pudo subir el material`;
                    let errorCategory = null;
                    try {
                        const contentType = res.headers.get('content-type') || '';
                        if (contentType.includes('application/json')) {
                            const err = await res.json();
                            if (err?.error) message = err.error;
                            if (err?.errorCategory) errorCategory = err.errorCategory;
                        } else {
                            const text = await res.text();
                            if (text) message = text;
                        }
                    } catch { /* ignore parse errors */ }

                    const apiError = new Error(message);
                    apiError.status = res.status;
                    apiError.errorCategory = errorCategory;
                    throw apiError;
                }

                return res.json();
            } catch (err) {
                if (err instanceof Error) {
                    const lowered = err.message.toLowerCase();
                    if (lowered.includes('failed to fetch') || lowered.includes('networkerror')) {
                        return {
                            materialId: `m-local-${Date.now()}`,
                            status: 'processing',
                            fallback: true,
                        };
                    }
                }

                throw err;
            }
        },

    async getDirectorStats() {
        if (USE_MOCK) { await delay(500); return MOCK_DIRECTOR_STATS; }
        try {
            const res = await fetchWithTimeout(`${BASE_URL}/director/stats`, { timeout: 4000 });
            if (!res.ok) return MOCK_DIRECTOR_STATS;
            const text = await res.text();
            if (!text) return MOCK_DIRECTOR_STATS;
            return JSON.parse(text);
        } catch (err) {
            console.error('[API] getDirectorStats failed:', err);
            return MOCK_DIRECTOR_STATS;
        }
    },

    async getDirectorKpiExport(format) {
      const qs = `?format=${encodeURIComponent(format)}`;
      const url = `${BASE_URL}/director/kpi-export${qs}`;
      if (USE_MOCK) {
        await delay(500);
        const stats = MOCK_DIRECTOR_STATS;
        if (format === 'csv') {
          const lines = [
            'seccion,metrica,valor',
            `General,Usuarios activos (hoy),${stats.dau}`,
            `General,Clases procesadas,${stats.classesProcessed}`,
            `General,Interacciones RAG,${stats.ragInteractions}`,
            `General,Adopcion global,${stats.adoptionRate}%`,
            '',
            'seccion,materia,costo_usd',
            ...(stats.costBySubject || []).map(s => {
              const total = (s.dailyCost || []).reduce((sum, d) => sum + (d.cost || 0), 0);
              return `Costo por materia,${s.subjectName || s.subjectId},${total.toFixed(6)}`;
            }),
            '',
            'seccion,materia,usuarios_semana_actual',
            ...(stats.wausBySubject || []).map(s => `WAUS,${s.subjectName || s.subjectId},${s.currentWeek || 0}`),
          ];
          return new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
        }
        return new Blob([JSON.stringify({ export: 'kpi-snapshot', generatedAt: new Date().toISOString(), data: stats }, null, 2)], { type: 'application/json' });
      }
      try {
        const res = await fetchWithTimeout(url, { timeout: 8000 });
        if (!res.ok) return null;
        if (format === 'csv') return res.blob();
        return res.blob();
      } catch (err) {
        console.error('[API] getDirectorKpiExport failed:', err);
        return null;
      }
    },

    async getDirectorPowerBiMetrics(days = 14) {
        if (USE_MOCK) {
            await delay(400);
            return {
                source: { mode: 'mock', storage: 'local', table: 'SessionMetrics' },
                updatedAt: new Date().toISOString(),
                windowDays: days,
                daily: [],
            };
        }

        try {
            const res = await fetchWithTimeout(`${BASE_URL}/director/powerbi-metrics?days=${encodeURIComponent(days)}`, { timeout: 4000 });
            if (!res.ok) {
                return {
                    source: { mode: 'fallback', storage: 'Azure Table Storage', table: 'SessionMetrics' },
                    updatedAt: null,
                    windowDays: days,
                    daily: [],
                };
            }
            return await res.json();
        } catch (err) {
            console.error('[API] getDirectorPowerBiMetrics failed:', err);
            return {
                source: { mode: 'fallback', storage: 'Azure Table Storage', table: 'SessionMetrics' },
                updatedAt: null,
                windowDays: days,
                daily: [],
            };
        }
    },

    async getVectorHealth() {
        if (USE_MOCK) {
            await delay(250);
            return {
                provider: 'pinecone',
                indexName: 'dashboard-edu-pilot',
                stats: {
                    totalVectorCount: 0,
                    indexFullness: 0,
                    namespaces: {},
                },
                latencyMs: { p50: 95, p95: 280 },
                failureRatio: 0.02,
                metricsWindow: 5,
                metricsSampleCount: 85,
                timestamp: new Date().toISOString(),
            };
        }

        try {
            const res = await fetchWithTimeout(`${BASE_URL}/vector-health`, { timeout: 3500 });
            if (!res.ok) return null;
            const data = await res.json();
            if (!data || typeof data !== 'object') return null;
            return data;
        } catch (err) {
            console.error('[API] getVectorHealth failed:', err);
            return null;
        }
    },

    async getAdminUsers() {
            if (USE_MOCK) {
                await delay(400);
                return [
                    { id: 'alu-001', name: 'Valentina Rodríguez', email: 'valentina.rodriguez@uade.edu.ar', role: 'student', theme: 'light', language: 'es', consentAccepted: true, lastActive: '2026-03-17T12:00:00Z' },
                    { id: 'doc-001', name: 'Dr. Martín Ferreiro', email: 'mferreiro@uade.edu.ar', role: 'teacher', theme: 'dark', language: 'es', consentAccepted: true, lastActive: '2026-03-17T11:45:00Z' },
                    { id: 'alu-new', name: 'Alumno Nuevo', email: 'nuevo@uade.edu.ar', role: 'student', theme: 'light', language: 'es', consentAccepted: false, lastActive: '2026-03-17T10:30:00Z' }
                ];
            }
            try {
                const res = await fetchWithTimeout(`${BASE_URL}/manage/users`, { timeout: 4000 });
                if (!res.ok) {
                    console.warn(`[API] getAdminUsers returned ${res.status}. Falling back to empty list.`);
                    return [];
                }
                const data = await res.json();
                return Array.isArray(data) ? data : [];
            } catch (err) {
                console.error('[API] getAdminUsers failed:', err);
                return [];
            }
        },

    async saveClass(subjectId, classData) {
            const classes = await this.getClasses(subjectId);
            const index = classes.findIndex(c => c.id === classData.id);

            const newClasses = [...classes];
            if (index >= 0) {
                newClasses[index] = { ...newClasses[index], ...classData };
            } else {
                newClasses.push(classData);
            }

            return this.saveClasses(subjectId, newClasses);
        },

    async deleteClass(subjectId, classId) {
            const classes = await this.getClasses(subjectId);
            const newClasses = classes.filter(c => c.id !== classId);
            return this.saveClasses(subjectId, newClasses);
        },

    async getTeacherAnalytics(subjectId) {
            if (USE_MOCK) { await delay(400); return MOCK_TEACHER_ANALYTICS; }
            const res = await apiFetch(`${BASE_URL}/analytics?subjectId=${subjectId}`);
            return res.json();
        },

    async getTeacherAlerts(subjectId) {
            if (!subjectId) return [];
            if (USE_MOCK) {
                await delay(300);
                return MOCK_TEACHER_ALERTS.filter((item) => item.subjectId === subjectId).map(normalizeTeacherAlert);
            }

            try {
                const res = await fetchWithTimeout(`${BASE_URL}/sga/teacher-alerts?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
                if (!res.ok) return [];
                const data = await res.json();
                if (!Array.isArray(data)) return [];
                return data.map((item, idx) => normalizeTeacherAlert(item, idx));
            } catch (err) {
                console.error('[API] getTeacherAlerts failed:', err);
                return [];
            }
        },
    
    async getProfile() {
            if (USE_MOCK) {
                await delay(300);
                return { theme: 'light', language: 'es', consentAccepted: false };
            }
            const res = await apiFetch(`${BASE_URL}/get-profile`);
            return res.json();
        },

    async saveProfile(data) {
            if (USE_MOCK) return;
            const res = await apiFetch(`${BASE_URL}/save-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return res.json();
        },

    async getClassSummary(classId) {
            if (USE_MOCK) {
                await delay(800);
                return { classId, summary: "Resumen simulado para la clase " + classId, validated: false };
            }
            const res = await apiFetch(`${BASE_URL}/class-summary/${classId}`);
            if (!res.ok) return null;
            return res.json();
        },

    async saveClassSummary(classId, data) {
            if (USE_MOCK) return;
            const res = await apiFetch(`${BASE_URL}/class-summary/${classId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return res.json();
        },

    getClassAudioUrl(classId, subjectId) {
            const params = new URLSearchParams();
            if (subjectId) params.set('subjectId', subjectId);
            const query = params.toString();
            return `${BASE_URL}/class-audio/${classId}${query ? `?${query}` : ''}`;
        },

    async getClassMap(classId) {
            if (USE_MOCK) {
                await delay(600);
                return {
                    classId,
                    mapCode: "graph TD\nA[Arquitectura] --> B[Patrones]\nA --> C[Atributos]\nB --> D[Microservicios]\nB --> E[Monolito]"
                };
            }
            const res = await apiFetch(`${BASE_URL}/class-map/${classId}`);
            if (!res.ok) return null;
            return res.json();
        },

    async getClassTimeline(classId) {
            if (USE_MOCK) {
                await delay(400);
                return {
                    classId,
                    sections: [
                        { id: 'm-01-sec-001', startSecond: 0, endSecond: 60, timestampLabel: '00:00:00', text: 'Introduccion a arquitectura de software.' },
                        { id: 'm-01-sec-002', startSecond: 60, endSecond: 120, timestampLabel: '00:01:00', text: 'Pregunta sobre atributos de calidad.' },
                    ],
                    markers: [
                        { id: 'm-01-mk-001', sectionId: 'm-01-sec-001', startSecond: 0, endSecond: 60, iconType: 'question', label: 'Introduccion y contexto' },
                        { id: 'm-01-mk-002', sectionId: 'm-01-sec-002', startSecond: 60, endSecond: 120, iconType: 'assignment', label: 'Ejercicio de atributos' },
                    ],
                };
            }
            const res = await apiFetch(`${BASE_URL}/class-timeline/${classId}`);
            if (!res.ok) return { classId, sections: [], markers: [] };
            return res.json();
        },

    async saveClassTimeline(classId, payload) {
            if (USE_MOCK) return payload;
            const res = await apiFetch(`${BASE_URL}/class-timeline/${classId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                throw new Error(`Error ${res.status}: No se pudo guardar la linea de tiempo`);
            }
            return res.json();
        },

    async saveClassMap(classId, data) {
            if (USE_MOCK) return;
            const res = await apiFetch(`${BASE_URL}/class-map/${classId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return res.json();
        },

    // ── Academic SGA Methods (Moved from academic.js) ───────
    async getTasks(studentId) {
            if (USE_MOCK) {
                const MOCK_TASKS = [
                    { id: 't-01', studentId, title: 'TP1: Diagrama de Arquitectura C4', dueDate: '2026-03-28', weight: 25, status: 'pending', classIds: ['class-01', 'class-02'], grade: null, subjectId: 'arq-software-2026' },
                    { id: 't-02', studentId, title: 'Quiz Online — Estilos Arquitectónicos', dueDate: '2026-03-20', weight: 10, status: 'completed', classIds: ['class-02'], grade: 8.5, subjectId: 'arq-software-2026' },
                    { id: 't-03', studentId, title: 'Parcial 1 — Arquitectura y Patrones', dueDate: '2026-04-16', weight: 35, status: 'pending', classIds: ['class-01', 'class-02', 'class-03', 'class-04'], grade: null, subjectId: 'arq-software-2026' },
                    { id: 't-04', studentId, title: 'Lectura: "Clean Architecture" (caps 1-5)', dueDate: '2026-03-19', weight: 5, status: 'completed', classIds: ['class-01'], grade: 10, subjectId: 'arq-software-2026' },
                ];
                await delay(400);
                return MOCK_TASKS;
            }

            try {
                const res = await fetchWithTimeout(`${BASE_URL}/sga/tasks?studentId=${encodeURIComponent(studentId)}`, { timeout: 4000 });
                if (!res.ok) return [];
                const data = await res.json();
                return Array.isArray(data) ? data : [];
            } catch (err) {
                console.error('[API] getTasks failed:', err);
                return [];
            }
        },

    async getEarlyAlerts(subjectId, options = {}) {
            const resolvedSubjectId = typeof subjectId === 'string' ? subjectId : (subjectId && typeof subjectId === 'object' ? subjectId.subjectId : undefined);
            const interventionOnly = typeof subjectId === 'object' && subjectId !== null
                ? Boolean(subjectId.interventionOnly)
                : Boolean(options.interventionOnly);

            const normalizeRisk = (value) => (['low', 'medium', 'high'].includes(value) ? value : 'medium');
            const normalizeInterventionFlag = (value, risk) => {
                if (['stable', 'watchlist', 'at_risk'].includes(value)) return value;
                if (risk === 'high') return 'at_risk';
                if (risk === 'medium') return 'watchlist';
                return 'stable';
            };

            const normalizeEarlyAlert = (item = {}) => {
                const risk = normalizeRisk(item.risk);
                return {
                    id: String(item.id || ''),
                    studentId: String(item.studentId || ''),
                    name: String(item.name || 'Alumno sin nombre'),
                    subjectId: String(item.subjectId || ''),
                    subject: String(item.subject || 'Materia no informada'),
                    risk,
                    interventionFlag: normalizeInterventionFlag(item.interventionFlag, risk),
                    attendance: String(item.attendance || '0%'),
                    avgGrade: typeof item.avgGrade === 'number' ? item.avgGrade : 0,
                };
            };

            if (USE_MOCK) {
                const MOCK_EARLY_ALERTS = [
                    { id: 'alu-012', studentId: 'alu-012', name: 'Tomás García', subjectId: 'arq-software-2026', subject: 'Arq. de Software', risk: 'high', interventionFlag: 'at_risk', attendance: '45%', avgGrade: 4.2 },
                    { id: 'alu-031', studentId: 'alu-031', name: 'Lucía Martínez', subjectId: 'diseno-sistemas-2026', subject: 'Sistemas Dist.', risk: 'medium', interventionFlag: 'watchlist', attendance: '62%', avgGrade: 5.1 },
                    { id: 'alu-008', studentId: 'alu-008', name: 'Nicolás Peralta', subjectId: 'arq-software-2026', subject: 'Arq. de Software', risk: 'medium', interventionFlag: 'watchlist', attendance: '70%', avgGrade: 5.8 },
                ];
                await delay(400);
                const bySubject = resolvedSubjectId ? MOCK_EARLY_ALERTS.filter(a => a.subjectId === resolvedSubjectId) : MOCK_EARLY_ALERTS;
                const filtered = interventionOnly ? bySubject.filter((a) => a.interventionFlag === 'at_risk') : bySubject;
                return filtered.map(normalizeEarlyAlert);
            }

            try {
                const params = new URLSearchParams();
                if (resolvedSubjectId) params.set('subjectId', resolvedSubjectId);
                if (interventionOnly) params.set('interventionOnly', 'true');
                const query = params.toString() ? `?${params.toString()}` : '';
                const res = await fetchWithTimeout(`${BASE_URL}/sga/early-alerts${query}`, { timeout: 4000 });
                if (!res.ok) return [];
                const data = await res.json();
                return Array.isArray(data) ? data.map(normalizeEarlyAlert) : [];
            } catch (err) {
                console.error('[API] getEarlyAlerts failed:', err);
                return [];
            }
        },

    async getAttendanceStats(subjectId) {
            if (USE_MOCK) {
                await delay(400);
                return { average: 78, critical: 3, trend: 'stable', subjectId, updatedAt: new Date().toISOString() };
            }

            try {
                const res = await fetchWithTimeout(`${BASE_URL}/sga/attendance?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
                if (!res.ok) return { average: 0, critical: 0, trend: 'stable', subjectId, updatedAt: new Date().toISOString() };
                return await res.json();
            } catch (err) {
                console.error('[API] getAttendanceStats failed:', err);
                return { average: 0, critical: 0, trend: 'stable', subjectId, updatedAt: new Date().toISOString() };
            }
        },

    async getChatHistory(subjectId) {
            if (USE_MOCK) {
                await delay(600);
                return [
                    { id: 'h1', question: '¿Qué es la arquitectura hexagonal?', answer: 'La arquitectura hexagonal...', createdAt: '2026-04-10T10:00:00Z' },
                    { id: 'h2', question: 'Diferencia entre CQRS y Event Sourcing', answer: 'CQRS separa lectura de escritura...', createdAt: '2026-04-11T11:00:00Z' },
                    { id: 'h3', question: '¿Cómo funciona SAGA pattern?', answer: 'El patrón SAGA gestiona transacciones...', createdAt: '2026-04-12T12:00:00Z' },
                    { id: 'h4', question: '¿Para qué sirve DDD?', answer: 'DDD organiza el dominio en modelos...', createdAt: '2026-04-13T09:30:00Z' },
                    { id: 'h5', question: '¿Qué es el bounded context?', answer: 'Es un limite semantico del modelo...', createdAt: '2026-04-14T15:20:00Z' }
                ];
            }
            try {
                const res = await fetchWithTimeout(`${BASE_URL}/chat-history?subjectId=${subjectId}`, { timeout: 4000 });
                if (!res.ok) return [];
                const data = await res.json();
                return Array.isArray(data) ? data : [];
            } catch (err) {
                console.error('[API] getChatHistory failed:', err);
                return []; // Chat history is less critical, can be empty
            }
        },

    async clearChatHistory(subjectId) {
            if (USE_MOCK) return { success: true, count: 0 };
            try {
                const res = await apiFetch(`${BASE_URL}/chat-history?subjectId=${subjectId}`, {
                    method: 'DELETE'
                });
                if (!res.ok) throw new Error(`Error ${res.status}: clearChatHistory`);
                return res.json();
            } catch (err) {
                console.error('[API] clearChatHistory failed:', err);
                throw err;
            }
        },

    async sendChatFeedback({ messageId, subjectId, isPositive }) {
            if (USE_MOCK) return { success: true };
            const res = await apiFetch(`${BASE_URL}/chat-feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messageId, subjectId, isPositive })
            });
            return res.json();
        },

    async sendChatRating({ sessionId, messageId, subjectId, classId, rating, comment }) {
            if (USE_MOCK) return { success: true };
            const res = await apiFetch(`${BASE_URL}/chat-rate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, messageId, subjectId, classId, rating, comment: comment || '' })
            });
            return res.json();
        },

    async getSatAnalytics({ subjectId, classId, days }) {
            if (USE_MOCK) {
                await delay(300);
                const segments = [
                    { promptVersion: 'v1', rated: 12, positive: 9, satScore: 0.75 },
                    { promptVersion: 'v2', rated: 8, positive: 7, satScore: 0.875 },
                ];
                const filtered = classId ? segments.filter(() => false) : [];
                return { segments: filtered, total: filtered.reduce((s, x) => s + x.rated, 0), filter: { subjectId, classId: classId || null, windowDays: days || 30 } };
            }
            let url = `${BASE_URL}/sat-analytics?subjectId=${encodeURIComponent(subjectId)}`;
            if (classId) url += `&classId=${encodeURIComponent(classId)}`;
            if (days) url += `&days=${Number(days)}`;
            const res = await apiFetch(url);
            return res.json();
        },

    async reportChatIssue({ messageId, subjectId, issueDetail }) {
            if (USE_MOCK) return { success: true, alertId: `ai-issue-${messageId || Date.now()}` };
            const res = await apiFetch(`${BASE_URL}/chat-report-issue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messageId, subjectId, issueDetail: String(issueDetail || '').trim() })
            });
            if (!res.ok) {
                let message = `Error ${res.status}: no se pudo reportar el problema`;
                try {
                    const err = await res.json();
                    if (err?.error) message = err.error;
                } catch {
                    // no-op
                }
                throw new Error(message);
            }
            return res.json();
        },

    async saveConversation({ conversationId, subjectId, messages }) {
            if (USE_MOCK) {
                await delay(300);
                return { success: true, conversationId };
            }
            const res = await apiFetch(`${BASE_URL}/conversations/${encodeURIComponent(conversationId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subjectId, messages }),
            });
            if (!res.ok) {
                let message = `Error ${res.status}: no se pudo guardar la conversación`;
                try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
                throw new Error(message);
            }
            return res.json();
        },

    async listConversations(subjectId) {
            if (USE_MOCK) { await delay(300); return []; }
            try {
                const res = await fetchWithTimeout(`${BASE_URL}/conversations?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
                if (!res.ok) return [];
                const data = await res.json();
                return Array.isArray(data) ? data : [];
            } catch (err) {
                console.error('[API] listConversations failed:', err);
                return [];
            }
        },

    async getConversation(conversationId, subjectId) {
            if (USE_MOCK) { await delay(300); return null; }
            try {
                const res = await fetchWithTimeout(`${BASE_URL}/conversations/${encodeURIComponent(conversationId)}?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
                if (!res.ok) return null;
                return res.json();
            } catch (err) {
                console.error('[API] getConversation failed:', err);
                return null;
            }
        },

    async deleteConversation(conversationId, subjectId) {
            if (USE_MOCK) { await delay(200); return { success: true }; }
            const res = await apiFetch(`${BASE_URL}/conversations/${encodeURIComponent(conversationId)}?subjectId=${encodeURIComponent(subjectId)}`, {
                method: 'DELETE',
            });
            if (!res.ok) {
                let message = `Error ${res.status}: no se pudo eliminar la conversación`;
                try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
                throw new Error(message);
            }
            return res.json();
        },

    async updateMaterial(subjectId, materialId, updates) {
            if (!subjectId || !materialId) throw new Error('subjectId y materialId son requeridos');
            const res = await apiFetch(`${BASE_URL}/materials/${encodeURIComponent(materialId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subjectId, ...updates }),
            });
            if (!res.ok) {
                let message = `Error ${res.status}: no se pudo actualizar el material`;
                try {
                    const contentType = res.headers.get('content-type') || '';
                    if (contentType.includes('application/json')) {
                        const err = await res.json();
                        if (err?.error) message = err.error;
                    }
                } catch { /* no-op */ }
                throw new Error(message);
            }
            return res.json();
        },

    async getMaterialText(subjectId, materialId) {
            if (!subjectId || !materialId) return { text: '' };
            try {
                const res = await fetchWithTimeout(
                    `${BASE_URL}/materials/${encodeURIComponent(materialId)}/text?subjectId=${encodeURIComponent(subjectId)}`,
                    { timeout: 8000 }
                );
                if (!res.ok) return { text: '' };
                const data = await res.json();
                return data && typeof data === 'object' ? data : { text: '' };
            } catch (err) {
                console.error('[API] getMaterialText failed:', err);
                return { text: '' };
            }
        },

    async updateMaterialText(subjectId, materialId, text) {
            if (!subjectId || !materialId) throw new Error('subjectId y materialId son requeridos');
            const res = await apiFetch(`${BASE_URL}/materials/${encodeURIComponent(materialId)}/text`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subjectId, text }),
            });
            if (!res.ok) {
                let message = `Error ${res.status}: no se pudo actualizar el texto`;
                try {
                    const contentType = res.headers.get('content-type') || '';
                    if (contentType.includes('application/json')) {
                        const err = await res.json();
                        if (err?.error) message = err.error;
                    }
                } catch { /* no-op */ }
                throw new Error(message);
            }
            return res.json();
        },

async getTeacherAiFeedbackAlerts(subjectId, limit = 10) {
             if (!subjectId) return [];
             if (USE_MOCK) {
                 await delay(250);
                 return [];
             }

             try {
                 const params = new URLSearchParams({
                     subjectId,
                     limit: String(Math.min(Math.max(Number(limit) || 10, 1), 50)),
                 });
                 const res = await fetchWithTimeout(`${BASE_URL}/teacher/ai-feedback-alerts?${params.toString()}`, { timeout: 3500 });
                 if (!res.ok) return [];
                 const data = await res.json();
                 return Array.isArray(data) ? data : [];
             } catch (err) {
                 console.error('[API] getTeacherAiFeedbackAlerts failed:', err);
                 return [];
             }
         },

    async getCorrectionsPending(subjectId, classId, status) {
            if (!subjectId) return [];
            if (USE_MOCK) {
                await delay(250);
                return [];
            }
            try {
                const params = new URLSearchParams({ subjectId });
                if (classId) params.append('classId', classId);
                if (status) params.append('status', status);
                const res = await fetchWithTimeout(`${BASE_URL}/corrections-pending?${params.toString()}`, { timeout: 4000 });
                if (!res.ok) {
                    throw new Error(`Error del servidor (${res.status}) al cargar correcciones.`);
                }
                const json = await res.json();
                return json.data || [];
            } catch (err) {
                console.error('[API] getCorrectionsPending failed:', err);
                throw err;
            }
         },

     async verifyAnswer(payload) {
             if (USE_MOCK) {
                 await delay(500);
                 return { success: true, data: { correctionId: payload.correctionId, status: 'verified' } };
             }
             const res = await apiFetch(`${BASE_URL}/corrections-verify`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify(payload),
             });
             if (!res.ok) {
                 let message = 'Error al publicar corrección';
                 try { const err = await res.json(); if (err?.error?.message) message = err.error.message; } catch {}
                 throw new Error(message);
             }
             return res.json();
         },

     async updateCorrectionStatus(subjectId, correctionId, status) {
              if (USE_MOCK) {
                  await delay(300);
                  return { success: true, data: { correctionId, status } };
              }
              const res = await apiFetch(`${BASE_URL}/corrections-status`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ correctionId, subjectId, status }),
              });
              if (!res.ok) {
                  let message = 'Error al actualizar estado';
                  try { const err = await res.json(); if (err?.error?.message) message = err.error.message; } catch {}
                  throw new Error(message);
              }
              return res.json();
          },

     async getCorrection(subjectId, correctionId) {
             if (USE_MOCK) {
                 await delay(300);
                 return {
                     correctionId,
                     studentId: 'J.P.',
                     question: '¿Qué es la arquitectura hexagonal?',
                     originalAnswer: 'La arquitectura hexagonal es un patrón de diseño de software que separa el dominio de la infraestructura...',
                     issueDetail: 'La respuesta no menciona puertos y adaptadores',
                     classId: 'class-03',
                     status: 'pending',
                     createdAt: '2026-05-31T10:00:00Z',
                 };
             }
             const params = new URLSearchParams({ subjectId });
             if (correctionId) params.append('correctionId', correctionId);
             const res = await fetchWithTimeout(`${BASE_URL}/corrections-pending?${params}`, { timeout: 4000 });
             if (!res.ok) throw new Error('Error cargando corrección');
             const json = await res.json();
             const data = json.data || [];
             return correctionId ? data.find(c => c.correctionId === correctionId) || null : data;
         },

     async getEnrollments(userId) {
         if (!userId) return [];
         if (USE_MOCK) {
             await delay(200);
             return [
                 { subjectId: 'arq-soft-2026', role: 'student', status: 'active' },
                 { subjectId: 'ing-datos-2026', role: 'student', status: 'active' },
             ];
         }
         try {
             const res = await fetchWithTimeout(`${BASE_URL}/enrollments?userId=${encodeURIComponent(userId)}`, { timeout: 4000 });
             if (!res.ok) return [];
             const data = await res.json();
             if (data?.success && Array.isArray(data.data)) return data.data;
             if (Array.isArray(data)) return data;
             return [];
         } catch (err) {
             console.error('[API] getEnrollments failed:', err);
             return [];
         }
     },

     async checkEnrollment(userId, subjectId) {
          if (!userId || !subjectId) return { enrolled: false, role: null, status: null };
          try {
              const res = await fetchWithTimeout(
                  `${BASE_URL}/enrollments/check?userId=${encodeURIComponent(userId)}&subjectId=${encodeURIComponent(subjectId)}`,
                  { timeout: 3500 }
              );
              if (!res.ok) return { enrolled: false, role: null, status: null };
              const data = await res.json();
              if (data?.success && data.data) return data.data;
              return data || { enrolled: false, role: null, status: null };
          } catch (err) {
              console.error('[API] checkEnrollment failed:', err);
              return { enrolled: false, role: null, status: null };
          }
      },

    async getTerms() {
            if (USE_MOCK) {
                await delay(300);
                return { content: '# Términos de Uso\n\nTexto de ejemplo para consentimiento.', version: 'v1' };
            }
            try {
                const res = await apiFetch(`${BASE_URL}/terms`);
                if (!res.ok) return null;
                const data = await res.json();
                if (data?.success && data.data) return data.data;
                return null;
            } catch (err) {
                console.error('[API] getTerms failed:', err);
                return null;
            }
        },

    async getConsent() {
            if (USE_MOCK) {
                await delay(200);
                return { accepted: false, acceptedAt: null, version: null };
            }
            try {
                const res = await apiFetch(`${BASE_URL}/consent`);
                if (!res.ok) return { accepted: false, acceptedAt: null, version: null };
                const data = await res.json();
                if (data?.success && data.data) return data.data;
                return { accepted: false, acceptedAt: null, version: null };
            } catch (err) {
                console.error('[API] getConsent failed:', err);
                return { accepted: false, acceptedAt: null, version: null };
            }
        },

    async saveConsent() {
            if (USE_MOCK) return { saved: true };
            try {
                const res = await apiFetch(`${BASE_URL}/consent`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accepted: true }),
                });
                if (!res.ok) return null;
                const data = await res.json();
                if (data?.success && data.data) return data.data;
                return null;
            } catch (err) {
                console.error('[API] saveConsent failed:', err);
                return null;
            }
        },

    // ── Reminder Preferences (Issue #140) ──────────────────────
    async getReminderPreferences() {
            if (USE_MOCK) {
                await delay(200);
                return { enabled: true, cadence: 'both' };
            }
            try {
                const res = await apiFetch(`${BASE_URL}/reminder-preferences`);
                if (!res.ok) return { enabled: true, cadence: 'both' };
                return await res.json();
            } catch (err) {
                console.error('[API] getReminderPreferences failed:', err);
                return { enabled: true, cadence: 'both' };
            }
        },

    async saveReminderPreferences(data) {
            if (USE_MOCK) return { saved: true };
            try {
                const res = await apiFetch(`${BASE_URL}/reminder-preferences`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                });
                if (!res.ok) return null;
                return await res.json();
            } catch (err) {
                console.error('[API] saveReminderPreferences failed:', err);
                return null;
            }
        },

    // ── Glossary (Story 2.186) ────────────────────────────────
    async getGlossary(subjectId) {
            if (!subjectId) return null;
            try {
                const res = await fetchWithTimeout(`${BASE_URL}/glossary?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
                if (!res.ok) return null;
                const json = await res.json();
                return json?.data || null;
            } catch (err) {
                console.error('[API] getGlossary failed:', err);
                return null;
            }
        },

    async updateGlossary(subjectId, terms) {
            if (!subjectId) throw new Error('subjectId is required');
            const res = await apiFetch(`${BASE_URL}/glossary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subjectId, terms }),
            });
            if (!res.ok) {
                let message = 'Error al actualizar el glosario';
                try { const err = await res.json(); if (err?.error?.message) message = err.error.message; } catch {}
                throw new Error(message);
            }
            const json = await res.json();
            return json?.data || null;
        },

    // ── Transcription Corrections (Story 2.186) ───────────────
    async getTranscriptionSuggestions(subjectId, status = 'pending') {
            if (!subjectId) return [];
            try {
                const params = new URLSearchParams({ subjectId });
                if (status) params.set('status', status);
                const res = await fetchWithTimeout(`${BASE_URL}/corrections-transcription?${params.toString()}`, { timeout: 4000 });
                if (!res.ok) return [];
                const json = await res.json();
                return json?.data || [];
            } catch (err) {
                console.error('[API] getTranscriptionSuggestions failed:', err);
                return [];
            }
        },

    async applyTranscriptionCorrection(suggestionId, subjectId) {
            if (!suggestionId || !subjectId) throw new Error('suggestionId and subjectId are required');
            const res = await apiFetch(`${BASE_URL}/corrections-transcription/apply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ suggestionId, subjectId }),
            });
            if (!res.ok) {
                let message = 'Error al aplicar corrección';
                try { const err = await res.json(); if (err?.error?.message) message = err.error.message; } catch {}
                throw new Error(message);
            }
            return res.json();
        },

    async rejectTranscriptionSuggestion(suggestionId, subjectId) {
            if (!suggestionId || !subjectId) throw new Error('suggestionId and subjectId are required');
            const res = await apiFetch(`${BASE_URL}/corrections-transcription/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ suggestionId, subjectId }),
            });
            if (!res.ok) {
                let message = 'Error al rechazar sugerencia';
                try { const err = await res.json(); if (err?.error?.message) message = err.error.message; } catch {}
                throw new Error(message);
            }
            return res.json();
        },

    async getMaterialDownloadUrl(subjectId, materialId) {
            if (!subjectId || !materialId) throw new Error('subjectId and materialId are required');
            const res = await apiFetch(`${BASE_URL}/material-download?subjectId=${encodeURIComponent(subjectId)}&materialId=${encodeURIComponent(materialId)}`);
            if (!res.ok) {
                let message = 'Error al obtener URL de descarga';
                try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
                throw new Error(message);
            }
            return res.json();
        },

    // ── Interventions (Story 6.2) ──────────────────────────────
    async getInterventions({ subjectId, state, risk } = {}) {
            if (USE_MOCK) {
                await delay(400);
                return [
                    { id: 'int-001', subjectId: 'arq-software-2026', studentId: 'alu-012', risk: 'high', score: 8, reason: 'Sin login en 21 días; sin actividad', state: 'assigned', notes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
                    { id: 'int-002', subjectId: 'arq-software-2026', studentId: 'alu-008', risk: 'medium', score: 5, reason: 'Sin login en 14 días; menos de 2 consultas en 7 días', state: 'assigned', notes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
                ];
            }
            const params = new URLSearchParams();
            if (subjectId) params.set('subjectId', subjectId);
            if (state) params.set('state', state);
            if (risk) params.set('risk', risk);
            const qs = params.toString() ? `?${params.toString()}` : '';
            const res = await fetchWithTimeout(`${BASE_URL}/interventions${qs}`, { timeout: 4000 });
            if (!res.ok) return [];
            const json = await res.json();
            return json?.data || [];
        },

    async updateIntervention(id, subjectId, state, note = '') {
            if (USE_MOCK) {
                await delay(300);
                return { success: true, data: { id, subjectId, state, updatedAt: new Date().toISOString() } };
            }
            const res = await apiFetch(`${BASE_URL}/interventions`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, subjectId, state, note }),
            });
            return res.json();
        },

    async computeInterventions(subjectId) {
            if (USE_MOCK) {
                await delay(800);
                return { success: true, data: { computed: 2, interventions: [] } };
            }
            const qs = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
            const res = await apiFetch(`${BASE_URL}/interventions/compute${qs}`, { method: 'POST' });
            return res.json();
        },

    async getRiskThresholds(subjectId) {
            if (USE_MOCK) {
                await delay(300);
                return { success: true, data: { subjectId: subjectId || 'default', thresholds: { attendanceWarning: 70, attendanceCritical: 50, engagementWarning: 60, engagementCritical: 40, gradeWarning: 6, noLoginDaysLow: 7, noLoginDaysMedium: 14, noLoginDaysHigh: 21, minQueriesMedium: 2, minQueriesHigh: 5, queryWindowDays: 7, queryWindowHighDays: 14 }, source: 'default' } };
            }
            const qs = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
            const res = await fetchWithTimeout(`${BASE_URL}/risk-thresholds${qs}`, { timeout: 4000 });
            if (!res.ok) return { success: false, error: 'Error' };
            return res.json();
        },

    async getRetentionPolicy() {
            if (USE_MOCK) {
                await delay(300);
                return { rules: [{ name: 'DeleteArchiveAfter2Years', enabled: true, action: 'delete', retentionDays: 730, prefixes: ['class-materials/', 'processed/'] }, { name: 'ArchiveOldSemesterMaterials', enabled: true, action: 'tierToArchive', retentionDays: 180, prefixes: ['class-materials/semester-', 'processed/semester-'] }], softDeleteDays: 7, evaluatedAt: new Date().toISOString() };
            }
            const res = await fetchWithTimeout(`${BASE_URL}/compliance/retention-policy`, { timeout: 4000 });
            if (!res.ok) return null;
            return res.json();
        },

    async getRetentionExport(format) {
            const qs = `?format=${encodeURIComponent(format)}`;
            const url = `${BASE_URL}/compliance/retention-export${qs}`;
            if (USE_MOCK) {
                await delay(500);
                const policy = await this.getRetentionPolicy();
                if (format === 'csv') {
                    const header = 'rule_name,enabled,action,retention_days,prefixes';
                    const rows = policy.rules.map(r => `${r.name},${r.enabled},${r.action},${r.retentionDays},"${r.prefixes.join(';')}"`);
                    const footer = `generated_at,${new Date().toISOString()}`;
                    return new Blob([header + '\n' + rows.join('\n') + '\n' + footer], { type: 'text/csv' });
                }
                return new Blob([JSON.stringify({ export: { rules: policy.rules, softDeletePolicy: { enabled: true, days: policy.softDeleteDays }, generatedAt: new Date().toISOString() } }, null, 2)], { type: 'application/json' });
            }
            const res = await fetchWithTimeout(url, { timeout: 8000 });
            if (!res.ok) return null;
            const blob = await res.blob();
            return blob;
        },

    async updateRiskThresholds(subjectId, thresholds) {
            if (USE_MOCK) {
                await delay(300);
                return { success: true, data: { subjectId, thresholds } };
            }
            const res = await apiFetch(`${BASE_URL}/risk-thresholds`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subjectId, thresholds }),
            });
            return res.json();
        },

    // ── Subject Source Weights (Issue #127) ─────────────────────
    async getSubjectWeights(subjectId) {
            if (!subjectId) return { data: { notes: 1.35, bibliography: 1.1, transcript: 1.0, presentation: 0.95 }, defaults: true };
            try {
                const res = await fetchWithTimeout(`${BASE_URL}/subject-weights/${encodeURIComponent(subjectId)}`, { timeout: 4000 });
                if (!res.ok) return null;
                const json = await res.json();
                return { data: json?.data, defaults: json?.defaults };
            } catch (err) {
                console.error('[API] getSubjectWeights failed:', err);
                return null;
            }
        },

    async saveSubjectWeights(subjectId, weights) {
            if (!subjectId) throw new Error('subjectId is required');
            const res = await apiFetch(`${BASE_URL}/subject-weights/${encodeURIComponent(subjectId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ weights }),
            });
            if (!res.ok) {
                let message = 'Error al guardar la ponderación de fuentes';
                try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
                throw new Error(message);
            }
            return res.json();
        },
      };
