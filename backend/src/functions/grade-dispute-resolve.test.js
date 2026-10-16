import { test, mock } from 'node:test';
import assert from 'node:assert';

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ userId: 'doc-001', userRoles: ['Docente'] })),
    getAuthenticatedUser: mock.fn(() => ({ userId: 'doc-001', sanitizedId: 'doc_001' })),
};

const storageState = {
    disputes: { 'arq-software-2026.json': [] },
    tasks: { 'alu_001': [] },
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

await import('./grade-dispute-resolve.js');

function makeRequest({ query = {}, body, params = {}, method = 'GET' }) {
    return {
        query: new URLSearchParams(query),
        method,
        params,
        headers: new Map(),
        json: async () => body,
    };
}

function makeContext() {
    return { log() {}, error() {}, warn() {} };
}

test('grade-disputes-list returns 403 for non-teacher', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'alu-001', userRoles: ['Alumno'] }));
    const prev = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const res = await handlers['grade-disputes-list'](makeRequest({ query: { subjectId: 'arq-software-2026' } }), makeContext());
    assert.equal(res.status, 403);
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prev;
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'doc-001', userRoles: ['Docente'] }));
});

test('grade-disputes-list requires subjectId', async () => {
    const res = await handlers['grade-disputes-list'](makeRequest({ query: {} }), makeContext());
    assert.equal(res.status, 400);
});

test('grade-disputes-list returns open disputes', async () => {
    storageState.disputes['arq-software-2026.json'] = [
        { disputeId: 'd-1', status: 'open', taskId: 't-1' },
        { disputeId: 'd-2', status: 'resolved', taskId: 't-2' },
    ];
    const res = await handlers['grade-disputes-list'](makeRequest({ query: { subjectId: 'arq-software-2026' } }), makeContext());
    assert.equal(res.status, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].disputeId, 'd-1');
});

test('grade-dispute-resolve requires decision', async () => {
    const res = await handlers['grade-dispute-resolve'](
        makeRequest({ method: 'POST', body: { disputeId: 'd-1', subjectId: 'arq-software-2026', decision: 'bogus' } }),
        makeContext()
    );
    assert.equal(res.status, 400);
});

test('grade-dispute-resolve 404 when dispute not found', async () => {
    storageState.disputes['arq-software-2026.json'] = [];
    const res = await handlers['grade-dispute-resolve'](
        makeRequest({ method: 'POST', body: { disputeId: 'nope', subjectId: 'arq-software-2026', decision: 'resolved', newGrade: 9 } }),
        makeContext()
    );
    assert.equal(res.status, 404);
});

test('grade-dispute-resolve resolves a dispute and updates the student task', async () => {
    storageState.disputes['arq-software-2026.json'] = [
        { disputeId: 'd-1', status: 'open', taskId: 't-1', studentId: 'alu-001', taskTitle: 'Quiz Online', reason: 'razon' },
    ];
    storageState.tasks['alu_001.json'] = [{ id: 't-1', title: 'Quiz Online', grade: 6, status: 'disputed', weight: 10 }];

    const res = await handlers['grade-dispute-resolve'](
        makeRequest({ method: 'POST', body: { disputeId: 'd-1', subjectId: 'arq-software-2026', decision: 'resolved', newGrade: 9 } }),
        makeContext()
    );
    assert.equal(res.status, 200);
    assert.equal(storageState.disputes['arq-software-2026.json'][0].status, 'resolved');
    assert.equal(storageState.tasks['alu_001.json'][0].status, 'completed');
    assert.equal(storageState.tasks['alu_001.json'][0].grade, 9);

    // Student notification emitted with the right message
    const notif = notificationMocks.upsertNotificationForSubject.mock.calls[notificationMocks.upsertNotificationForSubject.mock.calls.length - 1].arguments[1];
    assert.match(notif.message, /fue resuelta/);
});

test('grade-disputes-list with status=all returns open and closed disputes (UJ-41)', async () => {
    storageState.disputes['arq-software-2026.json'] = [
        { disputeId: 'd-1', status: 'open', taskId: 't-1' },
        { disputeId: 'd-2', status: 'resolved', taskId: 't-2', resolvedBy: 'doc_001' },
    ];
    const res = await handlers['grade-disputes-list'](makeRequest({ query: { subjectId: 'arq-software-2026', status: 'all' } }), makeContext());
    assert.equal(res.status, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.length, 2);
});

test('grade-dispute-resolve records the rationale and who resolved (UJ-41)', async () => {
    storageState.disputes['arq-software-2026.json'] = [
        { disputeId: 'd-9', status: 'open', taskId: 't-9', studentId: 'alu-001', taskTitle: 'TP 2', reason: 'razon' },
    ];
    storageState.tasks['alu_001.json'] = [{ id: 't-9', title: 'TP 2', grade: 5, status: 'disputed', weight: 20 }];

    const res = await handlers['grade-dispute-resolve'](
        makeRequest({ method: 'POST', body: { disputeId: 'd-9', subjectId: 'arq-software-2026', decision: 'resolved', newGrade: 8, reason: 'El ejercicio 3 cumple el criterio del material de la Clase 1.' } }),
        makeContext()
    );
    assert.equal(res.status, 200);
    const stored = storageState.disputes['arq-software-2026.json'][0];
    assert.equal(stored.resolutionNote, 'El ejercicio 3 cumple el criterio del material de la Clase 1.');
    assert.equal(stored.resolvedBy, 'doc_001');
    assert.ok(stored.resolvedAt);

    const notif = notificationMocks.upsertNotificationForSubject.mock.calls[notificationMocks.upsertNotificationForSubject.mock.calls.length - 1].arguments[1];
    assert.match(notif.message, /Clase 1/);
});

test('grade-dispute-resolve rejects and keeps original grade', async () => {
    storageState.disputes['arq-software-2026.json'] = [
        { disputeId: 'd-2', status: 'open', taskId: 't-2', studentId: 'alu-001', taskTitle: 'Parcial 1', reason: 'razon' },
    ];
    storageState.tasks['alu_001.json'] = [{ id: 't-2', title: 'Parcial 1', grade: 6, status: 'disputed', weight: 10 }];

    const res = await handlers['grade-dispute-resolve'](
        makeRequest({ method: 'POST', body: { disputeId: 'd-2', subjectId: 'arq-software-2026', decision: 'rejected' } }),
        makeContext()
    );
    assert.equal(res.status, 200);
    assert.equal(storageState.tasks['alu_001.json'][0].status, 'completed');
    assert.equal(storageState.tasks['alu_001.json'][0].grade, 6);

    const notif = notificationMocks.upsertNotificationForSubject.mock.calls[notificationMocks.upsertNotificationForSubject.mock.calls.length - 1].arguments[1];
    assert.match(notif.message, /fue rechazada/);
});
