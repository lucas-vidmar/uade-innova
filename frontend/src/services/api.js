/* ============================================================
   API Service — HTTP client with rich mock data fallback
   Contracts follow AGENTS.md section 10
   ============================================================ */

const USE_MOCK = false;
const BASE_URL = 'https://func-dashboard-ingest-q47bia47kk3na.azurewebsites.net/api';

/* ── Mock Data ───────────────────────────────────────────── */
const MOCK_CLASSES = [
    {
        id: 'class-01',
        subjectId: 'arq-software-2026',
        title: 'Clase 1 — Introducción a Arquitecturas de Software',
        date: '2026-03-05',
        topics: ['Definición de arquitectura', 'Patrones arquitectónicos', 'Atributos de calidad'],
        summaryReady: true,
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

const MOCK_TASKS = [
    { id: 't-01', title: 'TP1: Diagrama de Arquitectura C4', dueDate: '2026-03-28', weight: 25, status: 'pending', classIds: ['class-01', 'class-02'], grade: null },
    { id: 't-02', title: 'Quiz Online — Estilos Arquitectónicos', dueDate: '2026-03-20', weight: 10, status: 'completed', classIds: ['class-02'], grade: 8.5 },
    { id: 't-03', title: 'Parcial 1 — Arquitectura y Patrones', dueDate: '2026-04-16', weight: 35, status: 'pending', classIds: ['class-01', 'class-02', 'class-03', 'class-04'], grade: null },
    { id: 't-04', title: 'Lectura: "Clean Architecture" (caps 1-5)', dueDate: '2026-03-19', weight: 5, status: 'completed', classIds: ['class-01'], grade: 10 },
];

const MOCK_RAG_RESPONSES = [
    {
        question: ['hexagonal', 'puerto', 'adaptadores', 'hex'],
        answer: 'La **arquitectura hexagonal** (también llamada de Puertos y Adaptadores) fue propuesta por Alistair Cockburn. Su idea central es aislar el **núcleo de la aplicación** (la lógica de negocio) de los detalles tecnológicos del exterior.\n\nEstructura clave:\n- **Puerto**: una interfaz que define cómo el mundo externo puede interactuar con el core.\n- **Adaptador**: la implementación concreta de un puerto (ej: un controlador REST, un repo de BD).\n\nBeneficios según la Clase 3:\n1. Testabilidad alta: el core es independiente de frameworks\n2. Intercambiabilidad de adaptadores sin modificar la lógica de negocio\n3. Claridad en los límites del sistema',
        sources: [{ materialType: 'transcript', classId: 'class-03', chunkIndex: 4, sourceFilename: 'clase3_transcript.txt' }, { materialType: 'notes', classId: 'class-02', chunkIndex: 12, sourceFilename: 'apuntes_clase2.docx' }],
    },
    {
        question: ['microservicio', 'micro'],
        answer: 'Los **microservicios** son un estilo arquitectónico donde la aplicación se descompone en **servicios pequeños, independientes y desplegables de forma autónoma**, cada uno responsable de una capacidad de negocio específica.\n\nPuntos clave discutidos en Clase 2:\n- Cada servicio tiene su propia base de datos (database per service)\n- Comunicación vía APIs REST o mensajería asíncrona\n- Favorecen el despliegue continuo pero aumentan la complejidad operacional\n- Patrón SAGA recomendado para transacciones distribuidas (ver Clase 4)',
        sources: [{ materialType: 'transcript', classId: 'class-02', chunkIndex: 8, sourceFilename: 'clase2_transcripcion.vtt' }, { materialType: 'presentation', classId: 'class-02', chunkIndex: 2, sourceFilename: 'clase2_estilos.pptx' }],
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
    earlyAlerts: [
        { id: 'alu-012', name: 'Tomás García', subject: 'Arq. de Software', risk: 'high', attendance: '45%', avgGrade: 4.2 },
        { id: 'alu-031', name: 'Lucía Martínez', subject: 'Sistemas Dist.', risk: 'medium', attendance: '62%', avgGrade: 5.1 },
        { id: 'alu-008', name: 'Nicolás Peralta', subject: 'Arq. de Software', risk: 'medium', attendance: '70%', avgGrade: 5.8 },
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

/* ── Helpers ─────────────────────────────────────────────── */
function delay(ms = 600) { return new Promise(r => setTimeout(r, ms)); }

/* ── API Client ──────────────────────────────────────────── */
export const api = {
    async getClasses(subjectId) {
        if (USE_MOCK) { await delay(); return MOCK_CLASSES.filter(c => c.subjectId === subjectId); }
        const res = await fetch(`${BASE_URL}/classes?subjectId=${subjectId}`);
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
        const res = await fetch(`${BASE_URL}/subjects`);
        return res.json();
    },

    async saveClasses(subjectId, classesArray) {
        if (USE_MOCK) return;
        const res = await fetch(`${BASE_URL}/classes?subjectId=${subjectId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(classesArray)
        });
        if (!res.ok) {
            throw new Error(`Error ${res.status}: Falló el guardado en el servidor`);
        }
        return res.json();
    },

    async deleteMaterial(materialId) {
        if (USE_MOCK) return;
        const res = await fetch(`${BASE_URL}/materials/${materialId}`, { method: 'DELETE' });
        return res.json();
    },

    async getTasks(studentId) {
        if (USE_MOCK) { await delay(400); return MOCK_TASKS; }
        const res = await fetch(`${BASE_URL}/tasks?studentId=${studentId}`);
        return res.json();
    },

    async ragQuery({ question, classIds, subjectId }) {
        if (USE_MOCK) {
            await delay(1200);
            const q = question.toLowerCase();
            const match = MOCK_RAG_RESPONSES.find(r => r.question.some(kw => q.includes(kw)));
            return match || {
                answer: `Basándome en las clases seleccionadas (${classIds.length} clase${classIds.length !== 1 ? 's' : ''}), no encontré una respuesta específica para tu consulta sobre "${question}". Sin embargo, te recomiendo revisar los apuntes de las clases sobre patrones arquitectónicos y el resumen de la Clase 1.`,
                sources: [],
            };
        }
        const res = await fetch(`${BASE_URL}/rag-query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, classIds, subjectId }),
        });
        return res.json();
    },

    async ingestMaterial(formData) {
        if (USE_MOCK) {
            await delay(800);
            return { materialId: `m-${Date.now()}`, status: 'processing' };
        }
        const res = await fetch(`${BASE_URL}/ingest-material`, { method: 'POST', body: formData });
        return res.json();
    },

    async getDirectorStats() {
        if (USE_MOCK) { await delay(500); return MOCK_DIRECTOR_STATS; }
        const res = await fetch(`${BASE_URL}/director/stats`);
        return res.json();
    },

    async getAdminUsers() {
        if (USE_MOCK) {
            await delay(400);
            return [
                { id: 'alu-001', theme: 'light', language: 'es', consentAccepted: true, lastActive: '2026-03-17T12:00:00Z' },
                { id: 'doc-001', theme: 'dark', language: 'es', consentAccepted: true, lastActive: '2026-03-17T11:45:00Z' },
                { id: 'alu-new', theme: 'light', language: 'es', consentAccepted: false, lastActive: '2026-03-17T10:30:00Z' }
            ];
        }
        const res = await fetch(`${BASE_URL}/admin/users`);
        if (!res.ok) throw new Error('Unauthorized or Server Error');
        return res.json();
    },

    async getTeacherAnalytics(subjectId) {
        if (USE_MOCK) { await delay(400); return MOCK_TEACHER_ANALYTICS; }
        const res = await fetch(`${BASE_URL}/analytics?subjectId=${subjectId}`);
        return res.json();
    },
    
    async getProfile() {
        if (USE_MOCK) {
            await delay(300);
            return { theme: 'light', language: 'es', consentAccepted: false };
        }
        const res = await fetch(`${BASE_URL}/get-profile`);
        return res.json();
    },

    async saveProfile(data) {
        if (USE_MOCK) return;
        const res = await fetch(`${BASE_URL}/save-profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },
};
