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
            body: JSON.stringify({ question, classIds, subjectId, stream: false }),
        });
        
        if (res.status === 429) {
            throw new Error('The AI tutor is resting, please try again in a few minutes');
        }
        
        if (!res.ok) {
            throw new Error(`Error ${res.status}: No se pudo obtener respuesta de la IA`);
        }
        
        return res.json();
    },

    /**
     * Realiza una consulta RAG con streaming (SSE).
     * @param {Object} params - { question, classIds, subjectId }
     * @param {Function} onEvent - Callback para cada evento del stream: (type, data) => void
     */
    async ragQueryStream({ question, classIds, subjectId }, onEvent) {
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

        const response = await fetch(`${BASE_URL}/rag-query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, classIds, subjectId, stream: true }),
        });

        if (response.status === 429) {
            throw new Error('The AI tutor is resting, please try again in a few minutes');
        }

        if (!response.ok) {
            throw new Error(`Error ${response.status}: No se pudo iniciar el stream de respuesta`);
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

    async getClassSummary(classId) {
        if (USE_MOCK) {
            await delay(800);
            return { classId, summary: "Resumen simulado para la clase " + classId, validated: false };
        }
        const res = await fetch(`${BASE_URL}/class-summary/${classId}`);
        if (!res.ok) return null;
        return res.json();
    },

    async saveClassSummary(classId, data) {
        if (USE_MOCK) return;
        const res = await fetch(`${BASE_URL}/class-summary/${classId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },

    async getClassMap(classId) {
        if (USE_MOCK) {
            await delay(600);
            return {
                classId,
                mapCode: "graph TD\nA[Arquitectura] --> B[Patrones]\nA --> C[Atributos]\nB --> D[Microservicios]\nB --> E[Monolito]"
            };
        }
        const res = await fetch(`${BASE_URL}/class-map/${classId}`);
        if (!res.ok) return null;
        return res.json();
    },

    async saveClassMap(classId, data) {
        if (USE_MOCK) return;
        const res = await fetch(`${BASE_URL}/class-map/${classId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },

    // ── Academic SGA Methods (Moved from academic.js) ───────
    async getTasks(studentId) {
        // Mock data as defined in academic.js
        const MOCK_TASKS = [
            { id: 't-01', title: 'TP1: Diagrama de Arquitectura C4', dueDate: '2026-03-28', weight: 25, status: 'pending', classIds: ['class-01', 'class-02'], grade: null, subjectId: 'arq-software-2026' },
            { id: 't-02', title: 'Quiz Online — Estilos Arquitectónicos', dueDate: '2026-03-20', weight: 10, status: 'completed', classIds: ['class-02'], grade: 8.5, subjectId: 'arq-software-2026' },
            { id: 't-03', title: 'Parcial 1 — Arquitectura y Patrones', dueDate: '2026-04-16', weight: 35, status: 'pending', classIds: ['class-01', 'class-02', 'class-03', 'class-04'], grade: null, subjectId: 'arq-software-2026' },
            { id: 't-04', title: 'Lectura: "Clean Architecture" (caps 1-5)', dueDate: '2026-03-19', weight: 5, status: 'completed', classIds: ['class-01'], grade: 10, subjectId: 'arq-software-2026' },
            { id: 't-05', title: 'Entrega: Documento de Visión', dueDate: '2026-03-24', weight: 15, status: 'pending', classIds: ['class-01'], grade: null, subjectId: 'arq-software-2026' },
            { id: 't-06', title: 'Repaso: Atributos de Calidad', dueDate: '2026-03-22', weight: 4, status: 'pending', classIds: ['class-01'], grade: null, subjectId: 'arq-software-2026' },
        ];
        await delay(400);
        return MOCK_TASKS;
    },

    async getEarlyAlerts(subjectId) {
        const MOCK_EARLY_ALERTS = [
            { id: 'alu-012', name: 'Tomás García', subjectId: 'arq-software-2026', subject: 'Arq. de Software', risk: 'high', attendance: '45%', avgGrade: 4.2 },
            { id: 'alu-031', name: 'Lucía Martínez', subjectId: 'diseno-sistemas-2026', subject: 'Sistemas Dist.', risk: 'medium', attendance: '62%', avgGrade: 5.1 },
            { id: 'alu-008', name: 'Nicolás Peralta', subjectId: 'arq-software-2026', subject: 'Arq. de Software', risk: 'medium', attendance: '70%', avgGrade: 5.8 },
        ];
        await delay(400);
        return subjectId ? MOCK_EARLY_ALERTS.filter(a => a.subjectId === subjectId) : MOCK_EARLY_ALERTS;
    },

    async getAttendanceStats(subjectId) {
        await delay(400);
        return { average: 78, critical: 3, trend: 'stable' };
    },

    async getChatHistory(subjectId) {
        if (USE_MOCK) {
            await delay(600);
            return [];
        }
        const res = await fetch(`${BASE_URL}/chat-history?subjectId=${subjectId}`);
        if (!res.ok) return [];
        return res.json();
    },

    async sendChatFeedback({ messageId, subjectId, isPositive }) {
        if (USE_MOCK) return { success: true };
        const res = await fetch(`${BASE_URL}/chat-feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId, subjectId, isPositive })
        });
        return res.json();
    }
};
