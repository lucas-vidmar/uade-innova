import { test, mock } from 'node:test';
import assert from 'node:assert';

let principalMock = { userRoles: ['Docente'], oid: 'teacher-oid' };

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
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
