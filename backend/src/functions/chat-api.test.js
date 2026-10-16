import { test, mock } from 'node:test';
import assert from 'node:assert';

let principalMock = { userRoles: ['Docente'], oid: 'teacher-oid' };

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => principalMock),
    getAuthenticatedUser: mock.fn(() => ({ 
        userId: principalMock.oid, 
        sanitizedId: String(principalMock.oid).replace(/[^a-zA-Z0-9]/g, '_'),
        roles: principalMock.userRoles 
    })),
};

const storageState = {
    chatLogs: new Map(),
    alerts: new Map(),
    classes: new Map(),
};

const storageMocks = {
    saveJson: mock.fn(async (container, blobName, data) => {
        if (container === 'chat-logs') {
            storageState.chatLogs.set(blobName, JSON.parse(JSON.stringify(data)));
            return;
        }
        if (container === 'teacher-alerts') {
            storageState.alerts.set(blobName, JSON.parse(JSON.stringify(data)));
            return;
        }
    }),
    loadJson: mock.fn(async (container, blobName) => {
        if (container === 'chat-logs') {
            return storageState.chatLogs.get(blobName) || null;
        }
        if (container === 'teacher-alerts') {
            return storageState.alerts.get(blobName) || null;
        }
        if (container === 'classes-config') {
            return storageState.classes.get(blobName) || null;
        }
        return null;
    }),
    listBlobs: mock.fn(async (container, prefix) => {
        if (container === 'teacher-alerts') return Array.from(storageState.alerts.keys()).filter((key) => key.startsWith(prefix));
        if (container === 'chat-logs') return Array.from(storageState.chatLogs.keys()).filter((key) => key.startsWith(prefix));
        return [];
    }),
    deleteBlob: mock.fn(async () => {}),
    getTableClient: mock.fn(() => ({})),
};

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'teacher' })),
    upsertCorrection: mock.fn(async () => true),
    listCorrections: mock.fn(async () => []),
    getCorrection: mock.fn(async () => null),
    getConversation: mock.fn(async () => null),
    listConversationsByUser: mock.fn(async () => []),
    deleteConversation: mock.fn(async () => true),
    RATINGS_TABLE: 'ConversationRatings',
};

mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });

const handlers = {};
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
            },
        },
    },
});

await import('./chat-api.js');

function resetState() {
    storageState.chatLogs.clear();
    storageState.alerts.clear();
    storageState.classes.clear();
    principalMock = { userRoles: ['Docente'], oid: 'teacher-oid' };
}

test('chat-report-issue should persist report and create teacher alert', async () => {
    resetState();
    const chatBlobPath = 'student_1/arq-software-2026/msg-123.json';
    storageState.chatLogs.set(chatBlobPath, {
        id: 'msg-123',
        question: '¿Qué es CQRS?',
        answer: 'CQRS separa comandos de consultas.',
    });

    principalMock = { userRoles: ['Alumno'], oid: 'student-1' };

    const response = await handlers['chat-report-issue'](
        {
            json: async () => ({
                messageId: 'msg-123',
                subjectId: 'arq-software-2026',
                issueDetail: 'La respuesta es demasiado superficial.',
            }),
        },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.alertId, 'ai-issue-msg-123');

    const updatedLog = storageState.chatLogs.get(chatBlobPath);
    assert.ok(updatedLog.reportedIssue);
    assert.strictEqual(updatedLog.reportedIssue.detail, 'La respuesta es demasiado superficial.');

    const alertPath = 'arq-software-2026/ai-issue-msg-123.json';
    const alert = storageState.alerts.get(alertPath);
    assert.ok(alert);
    assert.strictEqual(alert.subjectId, 'arq-software-2026');
    assert.strictEqual(alert.messageId, 'msg-123');
    assert.strictEqual(alert.status, 'open');
});

test('chat-report-issue derives classId from the chat-log classIds array (UJ-39)', async () => {
    resetState();
    // The stored chat-log uses `classIds` (array) — see rag-query.js. Reading
    // `classId`/`classes` left every student report with classId 'unknown'.
    const chatBlobPath = 'student_1/arq-software-2026/msg-777.json';
    storageState.chatLogs.set(chatBlobPath, {
        id: 'msg-777',
        question: '¿Qué es SAGA?',
        answer: 'SAGA es un patrón de transacciones distribuidas.',
        classIds: ['class-01'],
    });
    stateStoreMocks.upsertCorrection.mock.resetCalls();

    principalMock = { userRoles: ['Alumno'], oid: 'student-1' };

    const response = await handlers['chat-report-issue'](
        {
            json: async () => ({
                messageId: 'msg-777',
                subjectId: 'arq-software-2026',
                issueDetail: 'La respuesta contradice el material de la Clase 1.',
            }),
        },
        { log: () => {}, error: () => {}, warn: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const alert = storageState.alerts.get('arq-software-2026/ai-issue-msg-777.json');
    assert.ok(alert);
    assert.strictEqual(alert.classId, 'class-01');

    const correctionArg = stateStoreMocks.upsertCorrection.mock.calls.at(-1)?.arguments?.[0];
    assert.ok(correctionArg, 'upsertCorrection should be called');
    assert.strictEqual(correctionArg.classId, 'class-01');
});

test('teacher-ai-feedback-alerts should require teacher or director role', async () => {
    resetState();
    principalMock = { userRoles: ['Alumno'], oid: 'student-2' };

    const response = await handlers['teacher-ai-feedback-alerts'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 403);
});

test('chat-report-issue missing-keyword should log type and notify teacher with class name', async () => {
    resetState();
    storageState.classes.set('arq-software-2026.json', [
        { id: 'class-03', title: 'Clase 3 — Arquitectura Hexagonal y DDD' },
        { id: 'class-04', title: 'Clase 4 — Patrones de Diseño' },
    ]);

    principalMock = { userRoles: ['Alumno'], oid: 'student-1' };

    const response = await handlers['chat-report-issue'](
        {
            json: async () => ({
                messageId: 'msg-900',
                subjectId: 'arq-software-2026',
                issueDetail: 'Patrón Observer',
                question: '¿Qué es el patrón Observer?',
                answer: 'No encontré información sobre ese patrón.',
                type: 'missing-keyword',
                classId: 'class-03',
            }),
        },
        { log: () => {}, error: () => {}, warn: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);

    const alertPath = 'arq-software-2026/missing-kw-msg-900.json';
    const alert = storageState.alerts.get(alertPath);
    assert.ok(alert);
    assert.strictEqual(alert.type, 'missing-keyword');
    assert.strictEqual(alert.keyword, 'Patrón Observer');
    assert.strictEqual(alert.issueDetail, 'Patrón Observer');
    assert.strictEqual(alert.classId, 'class-03');
    assert.strictEqual(alert.message, "Un alumno reportó que el concepto 'Patrón Observer' no aparece en los materiales de Clase 3 — Arquitectura Hexagonal y DDD");
});

test('chat-report-issue missing-keyword without class falls back to materia label', async () => {
    resetState();
    principalMock = { userRoles: ['Alumno'], oid: 'student-1' };

    const response = await handlers['chat-report-issue'](
        {
            json: async () => ({
                messageId: 'msg-901',
                subjectId: 'arq-software-2026',
                issueDetail: 'Microservicios',
                type: 'missing-keyword',
            }),
        },
        { log: () => {}, error: () => {}, warn: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const alert = storageState.alerts.get('arq-software-2026/missing-kw-msg-901.json');
    assert.ok(alert);
    assert.strictEqual(alert.type, 'missing-keyword');
    assert.strictEqual(alert.message, "Un alumno reportó que el concepto 'Microservicios' no aparece en los materiales de la materia");
});

test('chat-report-issue missing-keyword rejects empty keyword', async () => {
    resetState();
    principalMock = { userRoles: ['Alumno'], oid: 'student-1' };

    const response = await handlers['chat-report-issue'](
        {
            json: async () => ({
                messageId: 'msg-902',
                subjectId: 'arq-software-2026',
                issueDetail: '   ',
                type: 'missing-keyword',
            }),
        },
        { log: () => {}, error: () => {}, warn: () => {} }
    );

    assert.strictEqual(response.status, 400);
});

test('teacher-ai-feedback-alerts should return sorted alerts by subject', async () => {
    resetState();

    storageState.alerts.set('arq-software-2026/ai-issue-1.json', {
        id: 'ai-issue-1',
        subjectId: 'arq-software-2026',
        createdAt: '2026-04-10T10:00:00.000Z',
        status: 'open',
    });
    storageState.alerts.set('arq-software-2026/ai-issue-2.json', {
        id: 'ai-issue-2',
        subjectId: 'arq-software-2026',
        createdAt: '2026-04-10T11:00:00.000Z',
        status: 'open',
    });
    storageState.alerts.set('diseno-sistemas-2026/ai-issue-3.json', {
        id: 'ai-issue-3',
        subjectId: 'diseno-sistemas-2026',
        createdAt: '2026-04-10T12:00:00.000Z',
        status: 'open',
    });

    const response = await handlers['teacher-ai-feedback-alerts'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', limit: '5' }) },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 2);
    assert.strictEqual(body[0].id, 'ai-issue-2');
    assert.strictEqual(body[1].id, 'ai-issue-1');
});

test('#330: chat-feedback persists positive feedback and returns JSON', async () => {
    resetState();
    storageState.chatLogs.set('teacher_oid/arq-software-2026/msg-1.json', {
        id: 'msg-1',
        question: '¿Qué es hexagonal?',
        answer: 'Es un estilo.',
    });
    principalMock = { userRoles: ['Docente'], oid: 'teacher-oid' };

    const response = await handlers['chat-feedback'](
        {
            json: async () => ({ messageId: 'msg-1', subjectId: 'arq-software-2026', isPositive: true }),
        },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers['Content-Type'], 'application/json');
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.feedback, 'positive');
    assert.strictEqual(storageState.chatLogs.get('teacher_oid/arq-software-2026/msg-1.json').feedback, 'positive');
});

test('#330: chat-feedback returns JSON 404 (not plain text) when the message is missing', async () => {
    resetState();
    principalMock = { userRoles: ['Docente'], oid: 'teacher-oid' };

    const response = await handlers['chat-feedback'](
        {
            json: async () => ({ messageId: 'missing', subjectId: 'arq-software-2026', isPositive: false }),
        },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.headers['Content-Type'], 'application/json');
    const body = JSON.parse(response.body);
    assert.strictEqual(body.code, 'MESSAGE_NOT_FOUND');
});

test('#330: chat-feedback returns JSON 400 on missing fields and invalid JSON', async () => {
    resetState();
    principalMock = { userRoles: ['Docente'], oid: 'teacher-oid' };

    const missing = await handlers['chat-feedback'](
        { json: async () => ({ messageId: '', subjectId: '' }) },
        { log: () => {}, error: () => {} }
    );
    assert.strictEqual(missing.status, 400);
    assert.doesNotThrow(() => JSON.parse(missing.body));

    const invalid = await handlers['chat-feedback'](
        { json: async () => { throw new Error('bad json'); } },
        { log: () => {}, error: () => {} }
    );
    assert.strictEqual(invalid.status, 400);
    assert.doesNotThrow(() => JSON.parse(invalid.body));
});
// ── #331 regression: Conversations-table entries surface in chat-history ──
// Chats saved via PUT /api/conversations/{id} (ChatWidget auto-save) live in
// the Conversations table, not chat-logs blobs. GET /api/chat-history must
// merge them so just-created conversations appear in Chats recientes.
test('get-chat-history merges Conversations-table entries (#331)', async () => {
    resetState();
    principalMock = { userRoles: ['Alumno'], oid: 'student-1' };
    stateStoreMocks.listConversationsByUser.mock.mockImplementation(async () => ([
        {
            conversationId: 'conv-new-1',
            subjectId: 'arq-software-2026',
            firstQuestion: '¿Qué es un microservicio?',
            messages: [
                { role: 'user', content: '¿Qué es un microservicio?' },
                { role: 'assistant', content: 'Es un estilo de arquitectura...' },
            ],
            messageCount: 2,
            createdAt: '2026-09-18T10:00:00.000Z',
            lastMessageAt: '2026-09-18T10:01:00.000Z',
        },
    ]));

    try {
        const response = await handlers['get-chat-history'](
            { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
            { log: () => {}, error: () => {}, warn: () => {} }
        );

        assert.strictEqual(response.status, 200);
        const body = JSON.parse(response.body);
        const sessions = body.map((item) => item.sessionId || item.id);
        assert.ok(sessions.includes('conv-new-1'), 'new conversation must surface in chat-history');
        const merged = body.find((item) => (item.sessionId || item.id) === 'conv-new-1');
        assert.strictEqual(merged.question, '¿Qué es un microservicio?');
    } finally {
        stateStoreMocks.listConversationsByUser.mock.mockImplementation(async () => []);
    }
});

test('get-chat-history dedupes sessions present in both stores (#331)', async () => {
    resetState();
    principalMock = { userRoles: ['Alumno'], oid: 'student-1' };
    storageState.chatLogs.set('student_1/arq-software-2026/inter-1.json', {
        id: 'inter-1',
        sessionId: 'conv-dup',
        subjectId: 'arq-software-2026',
        question: '¿Qué es CQRS?',
        answer: 'Separación de comandos y consultas.',
        timestamp: '2026-09-18T10:00:00.000Z',
    });
    stateStoreMocks.listConversationsByUser.mock.mockImplementation(async () => ([
        {
            conversationId: 'conv-dup',
            subjectId: 'arq-software-2026',
            firstQuestion: '¿Qué es CQRS?',
            messages: [{ role: 'user', content: '¿Qué es CQRS?' }],
            messageCount: 1,
            createdAt: '2026-09-18T10:00:00.000Z',
            lastMessageAt: '2026-09-18T10:00:00.000Z',
        },
    ]));

    try {
        const response = await handlers['get-chat-history'](
            { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
            { log: () => {}, error: () => {}, warn: () => {} }
        );

        assert.strictEqual(response.status, 200);
        const body = JSON.parse(response.body);
        const dupes = body.filter((item) => (item.sessionId || item.id) === 'conv-dup');
        assert.strictEqual(dupes.length, 1, 'session present in both stores must appear once');
        assert.strictEqual(dupes[0].answer, 'Separación de comandos y consultas.', 'chat-log (richer) entry wins');
    } finally {
        stateStoreMocks.listConversationsByUser.mock.mockImplementation(async () => []);
    }
});

// UJ-25: el listado de "Chats recientes" se arma con los blobs de chat-logs.
// Borrar sólo la conversación guardada dejaba el hilo reaparecer y accesible
// por enlace directo, así que el borrado de un hilo tiene que alcanzar los dos
// almacenes.
test('delete-chat-history con sessionId borra sólo ese hilo (turnos + conversación)', async () => {
    resetState();
    principalMock = { userRoles: ['Alumno'], oid: 'student-1' };
    storageState.chatLogs.set('student_1/arq-software-2026/i1.json', { id: 'i1', sessionId: 'sess-1', question: 'q1', answer: 'a1' });
    storageState.chatLogs.set('student_1/arq-software-2026/i2.json', { id: 'i2', sessionId: 'sess-1', question: 'q2', answer: 'a2' });
    storageState.chatLogs.set('student_1/arq-software-2026/i3.json', { id: 'i3', sessionId: 'sess-otro', question: 'q3', answer: 'a3' });

    const response = await handlers['delete-chat-history'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', sessionId: 'sess-1' }) },
        { log: () => {}, error: () => {}, warn: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.count, 2, 'borra los dos turnos del hilo pedido');
    assert.strictEqual(body.conversationsDeleted, 1);

    const borrados = storageMocks.deleteBlob.mock.calls
        .map((call) => call.arguments[1])
        .filter((name) => typeof name === 'string' && name.includes('/arq-software-2026/i'));
    assert.deepStrictEqual(borrados.sort(), [
        'student_1/arq-software-2026/i1.json',
        'student_1/arq-software-2026/i2.json',
    ], 'no debe tocar los turnos de otros hilos');

    const conversaciones = stateStoreMocks.deleteConversation.mock.calls.map((call) => call.arguments);
    assert.ok(
        conversaciones.some(([userId, conversationId]) => userId === 'student-1' && conversationId === 'sess-1'),
        'borra también la conversación guardada del hilo'
    );
});

test('delete-chat-history sin sessionId borra todo el historial y sus conversaciones', async () => {
    resetState();
    principalMock = { userRoles: ['Alumno'], oid: 'student-1' };
    storageState.chatLogs.set('student_1/arq-software-2026/j1.json', { id: 'j1', sessionId: 'sess-a' });
    storageState.chatLogs.set('student_1/arq-software-2026/j2.json', { id: 'j2', sessionId: 'sess-b' });
    stateStoreMocks.listConversationsByUser.mock.mockImplementation(async () => ([
        { conversationId: 'sess-a' },
        { conversationId: 'sess-b' },
    ]));

    try {
        const response = await handlers['delete-chat-history'](
            { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
            { log: () => {}, error: () => {}, warn: () => {} }
        );

        assert.strictEqual(response.status, 200);
        const body = JSON.parse(response.body);
        assert.strictEqual(body.count, 2);
        assert.strictEqual(body.conversationsDeleted, 2, 'borra también las conversaciones guardadas espejadas');
    } finally {
        stateStoreMocks.listConversationsByUser.mock.mockImplementation(async () => []);
    }
});
