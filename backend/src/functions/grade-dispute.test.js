import { test, mock } from 'node:test';
import assert from 'node:assert';

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ userId: 'alu-001', userRoles: ['Alumno'] })),
    getAuthenticatedUser: mock.fn(() => ({ userId: 'alu-001', sanitizedId: 'alu_001', id: 'alu-001' })),
};

const storageState = {
    disputes: { 'arq-software-2026.json': [] },
    tasks: { 'alu_001.json': [{ id: 't-02', title: 'Quiz Online', grade: 8.5, status: 'completed', weight: 10 }] },
};

const storageMocks = {
    loadJson: mock.fn(async (container, name) => {
        if (container === 'disputes-config') return storageState.disputes[name] || [];
        if (container === 'tasks-config') return storageState.tasks[name] || [];
        return null;
    }),
    saveJson: mock.fn(async (container, name, data) => {
        if (container === 'disputes-config') storageState.disputes[name] = data;
        if (container === 'tasks-config') storageState.tasks[name] = data;
    }),
};

const notificationMocks = {
    upsertNotificationForSubject: mock.fn(async () => ({ success: true, retryAttempts: 0, deadLetterWrites: 0 })),
};

const stateStoreMocks = {
    getEnrollmentsBySubject: mock.fn(async () => [
        { subjectId: 'arq-software-2026', userId: 'doc-001', role: 'teacher', status: 'active' },
    ]),
};

const handlers = {};
mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/notification-store.js', { namedExports: notificationMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../middleware/with-auth.js', {
    namedExports: {
        withAuth: (handler) => async (request, context) => handler(request, context),
    },
});
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
            },
        },
    },
});

await import('./grade-dispute.js');

function makeRequest(body) {
    return { method: 'POST', query: new URLSearchParams(), params: {}, headers: new Map(), json: async () => body };
}
function makeContext() {
    return { log() {}, error() {}, warn() {} };
}

test('grade-dispute rejects reason shorter than 20 chars', async () => {
    const res = await handlers['grade-dispute'](makeRequest({ taskId: 't-02', reason: 'corto' }), makeContext());
    assert.equal(res.status, 400);
});

test('grade-dispute persists disputed status and notifies teacher with Name/TaskName', async () => {
    const res = await handlers['grade-dispute'](
        makeRequest({
            taskId: 't-02',
            reason: 'El ejercicio 3 esta correcto segun lo visto en clase, revisar por favor',
            taskTitle: 'Quiz Online',
            studentName: 'Lucas Vidmar',
            subjectId: 'arq-software-2026',
            originalGrade: 8.5,
        }),
        makeContext()
    );
    assert.equal(res.status, 200);
    // Task status persisted as disputed
    assert.equal(storageState.tasks['alu_001.json'][0].status, 'disputed');
    // Dispute record persisted
    assert.equal(storageState.disputes['arq-software-2026.json'].length, 1);
    assert.equal(storageState.disputes['arq-software-2026.json'][0].status, 'open');
    // Teacher notification with Name/TaskName
    const notif = notificationMocks.upsertNotificationForSubject.mock.calls[notificationMocks.upsertNotificationForSubject.mock.calls.length - 1].arguments[1];
    assert.match(notif.message, /El alumno Lucas Vidmar disputó la nota de Quiz Online/);
    assert.equal(notif.recipientUserIds[0], 'doc-001');
});
