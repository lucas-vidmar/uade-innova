/* ============================================================
   API Service — HTTP client with rich mock data fallback
   Contracts follow AGENTS.md section 10
   ============================================================ */

const USE_MOCK = false;
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

function nextCorrelationId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function withCorrelationHeaders(headers = {}) {
    const normalized = new Headers(headers || {});
    if (!normalized.has(CORRELATION_HEADER)) {
        normalized.set(CORRELATION_HEADER, nextCorrelationId());
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

    async getClasses(subjectId) {
        if (USE_MOCK) { await delay(); return MOCK_CLASSES.filter(c => c.subjectId === subjectId); }
        const localClasses = getLocalClasses(subjectId);
        try {
            const res = await fetchWithTimeout(`${BASE_URL}/classes?subjectId=${subjectId}`, { timeout: 4000 });
            if (!res.ok) {
                if (localClasses.length > 0) return localClasses;
                return MOCK_CLASSES.filter(c => c.subjectId === subjectId);
            }
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) return data;
            if (localClasses.length > 0) return localClasses;
            if (window.location.hostname === 'localhost') {
                return MOCK_CLASSES.filter(c => c.subjectId === subjectId);
            }
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('[API] getClasses failed:', err);
            if (localClasses.length > 0) return localClasses;
            return MOCK_CLASSES.filter(c => c.subjectId === subjectId);
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
            return { query, subjectId, total: 0, results: [] };
        }

        const data = await res.json();
        return data && Array.isArray(data.results) ? data : { query, subjectId, total: 0, results: [] };
    },

    async getNotifications({ userId, subjectId, limit = 10 } = {}) {
        if (USE_MOCK) {
            await delay(250);
            return buildFallbackNotifications(subjectId, limit);
        }

        try {
            const params = new URLSearchParams();
            if (userId) params.set('userId', userId);
            if (subjectId) params.set('subjectId', subjectId);
            if (limit) params.set('limit', String(limit));

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

    async getSubjects() {
        if (USE_MOCK) {
            await delay(400);
            return [
                { id: 'arq-software-2026', name: 'Arquitectura de Software' },
                { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas' }
            ];
        }
        try {
            const res = await apiFetch(`${BASE_URL}/subjects`);
            if (!res.ok) {
                return mergeSubjectsWithLocal([
                    { id: 'arq-software-2026', name: 'Arquitectura de Software' },
                    { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas' }
                ]);
            }
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) return data;
            if (window.location.hostname === 'localhost') {
                return mergeSubjectsWithLocal([
                    { id: 'arq-software-2026', name: 'Arquitectura de Software' },
                    { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas' }
                ]);
            }
            return mergeSubjectsWithLocal(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('[API] getSubjects failed:', err);
            return mergeSubjectsWithLocal([
                { id: 'arq-software-2026', name: 'Arquitectura de Software' },
                { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas' }
            ]);
        }
    },

    async saveSubject(subject) {
        if (USE_MOCK) {
            await delay(250);
            return { id: subject.id || `subject-${Date.now()}`, name: subject.name };
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
            const fallbackSubject = {
                id: subject.id || `subject-${Date.now()}`,
                name: subject.name,
                oneLiner: subject.oneLiner || '',
                comment: subject.comment || subject.oneLiner || '',
            };
            upsertLocalSubject(fallbackSubject);
            return fallbackSubject;
        }
    },

    async deleteSubject(subjectId) {
        if (USE_MOCK) {
            await delay(250);
            return { success: true };
        }

        try {
            const res = await apiFetch(`${BASE_URL}/subjects/${encodeURIComponent(subjectId)}`, {
                method: 'DELETE',
            });

            if (!res.ok) {
                let message = `Error ${res.status}: No se pudo eliminar la materia`;
                try {
                    const err = await res.json();
                    if (err?.error) message = err.error;
                } catch {
                    // no-op
                }

                if (res.status >= 500 || res.status === 404) {
                    removeLocalSubject(subjectId);
                    return { success: true, fallback: true };
                }

                throw new Error(message);
            }

            removeLocalSubject(subjectId);
            return res.json();
        } catch (err) {
            removeLocalSubject(subjectId);
            return { success: true, fallback: true };
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

    async ragQuery({ question, classIds, subjectId, conversationHistory = [], historyWindowSize = 4, transcriptFocus = null }) {
        if (USE_MOCK) {
            await delay(1200);
            const q = question.toLowerCase();
            const match = MOCK_RAG_RESPONSES.find(r => r.question.some(kw => q.includes(kw)));
            return match || {
                answer: `Basándome en las clases seleccionadas (${classIds.length} clase${classIds.length !== 1 ? 's' : ''}), no encontré una respuesta específica para tu consulta sobre "${question}". Sin embargo, te recomiendo revisar los apuntes de las clases sobre patrones arquitectónicos y el resumen de la Clase 1.`,
                sources: [],
            };
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
    async ragQueryStream({ question, classIds, subjectId, conversationHistory =[], historyWindowSize = 4, transcriptFocus = null }, onEvent) {
            if (USE_MOCK) {
                // Simular streaming para mocks
                await delay(400);
                onEvent('metadata', {
                    interactionId: 'mock-id-' + Date.now(),
                    sources: [
                        { materialType: 'transcript', sourceFilename: 'clase3_transcript.txt', classId: 'class-03' },
                        { materialType: 'presentation', sourceFilename: 'clase3_slides.pdf', classId: 'class-03' }
                    ]
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
                body: JSON.stringify({ question, classIds, subjectId, stream: true, conversationHistory, historyWindowSize, transcriptFocus }),
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
                    if (res.status === 404 || res.status >= 500) {
                        return {
                            materialId: `m-local-${Date.now()}`,
                            status: 'processing',
                            fallback: true,
                        };
                    }

                    let message = `Error ${res.status}: no se pudo subir el material`;
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
                provider: 'azure-ai-search',
                indexName: 'dashboard-edu-pilot',
                stats: {
                    totalVectorCount: 0,
                    indexFullness: 0,
                    namespaces: {},
                },
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

    getClassAudioUrl(classId) {
            return `${BASE_URL}/class-audio/${classId}`;
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
                return [];
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

    async sendChatFeedback({ messageId, subjectId, isPositive }) {
            if (USE_MOCK) return { success: true };
            const res = await apiFetch(`${BASE_URL}/chat-feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messageId, subjectId, isPositive })
            });
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
        }
    };
