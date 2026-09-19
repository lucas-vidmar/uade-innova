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
        if (container !== 'teacher-alerts') return [];
        return Array.from(storageState.alerts.keys()).filter((key) => key.startsWith(prefix));
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
