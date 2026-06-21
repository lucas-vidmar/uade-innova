export const MOCK_CLASSES = [
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

export const MOCK_DIRECTOR_STATS = {
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

export const MOCK_TEACHER_ANALYTICS = {
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

export const MOCK_TEACHER_ALERTS = [
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

export const MOCK_DEADLINES = [
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

export const MOCK_NOTIFICATIONS = [
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

export const MOCK_GLOBAL_SEARCH_RESULTS = [
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

export const MOCK_RAG_RESPONSES = [
    {
        question: ['arquitectura hexagonal', 'hexagonal', 'puertos y adaptadores'],
        answer: 'La arquitectura hexagonal, también conocida como puertos y adaptadores, es un patrón de diseño que organiza el código alrededor del dominio de la aplicación, aislándolo de los detalles técnicos como bases de datos, APIs o interfaces de usuario. El dominio se comunica con el exterior a través de puertos (interfaces) que son implementados por adaptadores concretos. Esto permite cambiar detalles de infraestructura sin afectar la lógica de negocio.',
        sources: [{ materialType: 'transcript', classId: 'class-03', chunkIndex: 0, sourceFilename: 'clase3_transcript.txt' }],
        verified: true,
    },
    {
        question: ['microservicios', 'monolito', 'diferencia'],
        answer: 'La principal diferencia entre microservicios y monolitos es el nivel de acoplamiento. En una arquitectura monolítica, todas las funcionalidades se despliegan como una sola unidad, lo que simplifica el desarrollo inicial pero dificulta el escalado y mantenimiento a largo plazo. En microservicios, cada funcionalidad es un servicio independiente con su propia base de datos, comunicándose mediante APIs. Esto permite escalar, desplegar y mantener cada servicio de forma independiente, aunque introduce complejidad en la comunicación y coordinación entre servicios.',
        sources: [{ materialType: 'presentation', classId: 'class-02', chunkIndex: 3, sourceFilename: 'clase2_estilos.pptx' }],
        verified: false,
    },
    {
        question: ['saga', 'saga pattern', 'transacciones distribuidas'],
        answer: 'El patrón SAGA gestiona transacciones distribuidas en sistemas de microservicios mediante una secuencia de transacciones locales. Cada servicio ejecuta su propia transacción y publica un evento. Si un paso falla, la SAGA ejecuta transacciones compensatorias para deshacer los cambios realizados en pasos anteriores. Existen dos implementaciones principales: coreografía (cada servicio escucha y responde a eventos) y orquestación (un coordinador central dirige las transacciones).',
        sources: [{ materialType: 'transcript', classId: 'class-04', chunkIndex: 0, sourceFilename: 'clase4_transcript.txt' }],
        verified: false,
    },
];

export const MOCK_TASKS = [
    { id: 't-01', studentId: '', title: 'TP1: Diagrama de Arquitectura C4', dueDate: '2026-03-28', weight: 25, status: 'pending', classIds: ['class-01', 'class-02'], grade: null, subjectId: 'arq-software-2026' },
    { id: 't-02', studentId: '', title: 'Quiz Online — Estilos Arquitectónicos', dueDate: '2026-03-20', weight: 10, status: 'completed', classIds: ['class-02'], grade: 8.5, subjectId: 'arq-software-2026' },
    { id: 't-03', studentId: '', title: 'Parcial 1 — Arquitectura y Patrones', dueDate: '2026-04-16', weight: 35, status: 'pending', classIds: ['class-01', 'class-02', 'class-03', 'class-04'], grade: null, subjectId: 'arq-software-2026' },
    { id: 't-04', studentId: '', title: 'Lectura: "Clean Architecture" (caps 1-5)', dueDate: '2026-03-19', weight: 5, status: 'completed', classIds: ['class-01'], grade: 10, subjectId: 'arq-software-2026' },
];

export const MOCK_EARLY_ALERTS = [
    { id: 'alu-012', studentId: 'alu-012', name: 'Tomás García', subjectId: 'arq-software-2026', subject: 'Arq. de Software', risk: 'high', interventionFlag: 'at_risk', attendance: '45%', avgGrade: 4.2 },
    { id: 'alu-031', studentId: 'alu-031', name: 'Lucía Martínez', subjectId: 'diseno-sistemas-2026', subject: 'Sistemas Dist.', risk: 'medium', interventionFlag: 'watchlist', attendance: '62%', avgGrade: 5.1 },
    { id: 'alu-008', studentId: 'alu-008', name: 'Nicolás Peralta', subjectId: 'arq-software-2026', subject: 'Arq. de Software', risk: 'medium', interventionFlag: 'watchlist', attendance: '70%', avgGrade: 5.8 },
];
