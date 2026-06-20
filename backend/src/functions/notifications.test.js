import { test, mock } from 'node:test';
import assert from 'node:assert';

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({ userId: 'alu-001', userRoles: ['Alumno'] })),
};

const notificationStoreMocks = {
    listNotificationsBySubject: mock.fn(async () => []),
    listNotificationsSince: mock.fn(async () => []),
    markNotificationReadForUser: mock.fn(async () => ({ success: true, retryAttempts: 0, deadLetterWrites: 0 })),
};

const telemetryMocks = {
    trackNotificationInteraction: mock.fn(async () => {}),
};

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'student' })),
};

mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/notification-store.js', { namedExports: notificationStoreMocks });
mock.module('../services/telemetry.js', { namedExports: telemetryMocks });
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

await import('./notifications.js');

test('get-notifications should filter by subject and honor limit', async () => {
    const response = await handlers['get-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', limit: '2' }) },
        { log: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 2);
    assert.ok(body.every((item) => item.subjectId === 'arq-software-2026'));
    assert.ok(new Date(body[0].createdAt) >= new Date(body[1].createdAt));
});

test('get-notifications should merge persisted notifications and filter by userId', async () => {
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
        {
            id: 'notif-auto-summary-arq-software-2026-class-03',
            type: 'summary',
            title: 'Resumen validado por docente',
            message: 'Clase 3 ya tiene resumen validado.',
            createdAt: '2026-04-10T18:00:00Z',
            unread: true,
            targetHash: '#/student/class/class-03',
            subjectId: 'arq-software-2026',
            recipientUserIds: ['alu-001'],
            origin: 'post-class-summary-timer',
        },
    ]));

    const response = await handlers['get-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', userId: 'alu-001', limit: '5' }) },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.ok(body.some((item) => item.id === 'notif-auto-summary-arq-software-2026-class-03'));
    assert.ok(body.every((item) => !Array.isArray(item.recipientUserIds) || item.recipientUserIds.length === 0 || item.recipientUserIds.includes('alu-001')));
});

test('get-notifications should exclude targeted notifications for other users', async () => {
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
        {
            id: 'notif-targeted',
            type: 'summary',
            createdAt: '2026-04-10T18:00:00Z',
            subjectId: 'arq-software-2026',
            recipientUserIds: ['alu-999'],
        },
    ]));

    const response = await handlers['get-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', userId: 'alu-001', limit: '10' }) },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.ok(!body.some((item) => item.id === 'notif-targeted'));
});

test('get-notifications should clamp invalid limit values', async () => {
    const response = await handlers['get-notifications'](
        { query: new URLSearchParams({ limit: '0' }) },
        { log: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 1);
});

test('mark-notification-read should persist read state and emit telemetry', async () => {
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
        {
            id: 'notif-1',
            subjectId: 'arq-software-2026',
            recipientUserIds: ['alu-001'],
            unread: true,
        },
    ]));

    const markReadTelemetryBefore = telemetryMocks.trackNotificationInteraction.mock.callCount();
    const response = await handlers['mark-notification-read'](
        {
            params: { id: 'notif-1' },
            json: async () => ({ subjectId: 'arq-software-2026', userId: 'alu-001' }),
        },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(notificationStoreMocks.markNotificationReadForUser.mock.callCount(), 1);
    assert.strictEqual(telemetryMocks.trackNotificationInteraction.mock.callCount(), markReadTelemetryBefore + 1);
});

test('mark-notifications-read should persist all provided notification ids', async () => {
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
        { id: 'notif-1', subjectId: 'arq-software-2026', recipientUserIds: ['alu-001'], unread: true },
        { id: 'notif-2', subjectId: 'arq-software-2026', recipientUserIds: ['alu-001'], unread: true },
    ]));

    const response = await handlers['mark-notifications-read'](
        {
            json: async () => ({ subjectId: 'arq-software-2026', userId: 'alu-001', notificationIds: ['notif-1', 'notif-2'] }),
        },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.updated, 2);
});

test('mark-notification-read should reject unauthorized student updates', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'alu-999', userRoles: ['Alumno'] }));

    const response = await handlers['mark-notification-read'](
        {
            params: { id: 'notif-1' },
            json: async () => ({ subjectId: 'arq-software-2026', userId: 'alu-001' }),
        },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 403);

    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'alu-001', userRoles: ['Alumno'] }));
});

test('stream-notifications should return 401 without auth', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => null);
    authMocks.validateFrontDoorId.mock.mockImplementation(() => true);

    const response = await handlers['stream-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
        { log: () => {} }
    );

    assert.strictEqual(response.status, 401);

    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'alu-001', userRoles: ['Alumno'] }));
});

test('stream-notifications should start with stream headers and snapshot event', async () => {
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
        { id: 'n1', type: 'material', title: 'New material', message: 'Test', createdAt: '2026-06-19T12:00:00Z', unread: true, targetHash: '#/student/dashboard', subjectId: 'arq-software-2026', recipientUserIds: [], readByUserIds: [] },
    ]));

    const response = await handlers['stream-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', userId: 'alu-001' }) },
        { log: () => {} }
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers['Content-Type'], 'text/event-stream');
    assert.strictEqual(response.headers['Cache-Control'], 'no-cache');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const chunk = decoder.decode(value, { stream: true });

    assert.ok(chunk.includes('event: snapshot'));
    assert.ok(chunk.includes('"notifications"'));
    reader.cancel('test done');

    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([]));
});

test('stream-notifications sends notification event for new items', async () => {
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([]));
    notificationStoreMocks.listNotificationsSince.mock.mockImplementation(async () => ([
        { id: 'n2', type: 'deadline', title: 'Deadline approaching', message: 'Test deadline', createdAt: '2026-06-19T13:00:00Z', unread: true, targetHash: '#/student/calendar', subjectId: 'arq-software-2026', recipientUserIds: [], readByUserIds: [] },
    ]));

    const response = await handlers['stream-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', userId: 'alu-001', since: '2026-06-19T12:00:00Z' }) },
        { log: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const chunk = decoder.decode(value, { stream: true });

    assert.ok(chunk.includes('event: snapshot'));

    // Wait for poll cycle to send notification event
    await new Promise((r) => setTimeout(r, 5100));
    const { value: v2 } = await reader.read();
    const chunk2 = decoder.decode(v2, { stream: true });
    assert.ok(chunk2.includes('event: notification'));

    reader.cancel('test done');
    notificationStoreMocks.listNotificationsSince.mock.mockImplementation(async () => ([]));
});

test('get-notifications should deduplicate persisted notifications over MOCK_NOTIFICATIONS with same ID', async () => {
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
        {
            id: 'notif-grade-001',
            type: 'grade',
            title: 'Nueva nota publicada',
            message: 'Quiz Online — Estilos Arquitectónicos: 8.5',
            createdAt: '2026-03-20T11:10:00Z',
            unread: true,
            targetHash: '#/student/tasks',
            subjectId: 'arq-software-2026',
            readByUserIds: ['alu-001'],
            recipientUserIds: [],
            origin: 'manual',
        },
    ]));

    const response = await handlers['get-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', userId: 'alu-001', limit: '10' }) },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    const gradeNotifs = body.filter((item) => item.id === 'notif-grade-001');
    assert.strictEqual(gradeNotifs.length, 1, 'should only return one copy of the deduplicated notification');
    assert.strictEqual(gradeNotifs[0].unread, false, 'persisted copy with readByUserIds should be authoritative');
});

test('get-notifications should return only MOCK_NOTIFICATIONS when no persisted data exists', async () => {
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([]));

    const response = await handlers['get-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', limit: '10' }) },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.length > 0, 'should return mock notifications when no persisted data exists');
    assert.ok(body.some((item) => item.id === 'notif-grade-001'), 'should include mock notification grade-001');
});

test('get-notifications should handle partial overlap correctly', async () => {
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
        {
            id: 'notif-grade-001',
            type: 'grade',
            title: 'Nueva nota publicada',
            message: 'Quiz Online — Estilos Arquitectónicos: 8.5',
            createdAt: '2026-03-20T11:10:00Z',
            unread: true,
            targetHash: '#/student/tasks',
            subjectId: 'arq-software-2026',
            readByUserIds: ['alu-001'],
            recipientUserIds: [],
            origin: 'manual',
        },
    ]));

    const response = await handlers['get-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', limit: '10' }) },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    const gradeNotifs = body.filter((item) => item.id === 'notif-grade-001');
    assert.strictEqual(gradeNotifs.length, 1, 'deduped entry');
    assert.ok(body.some((item) => item.id === 'notif-summary-001'), 'non-overlapping mock should still appear');
});

test('get-notifications after seed-and-mark-read should return deduped notification with correct unread state', async () => {
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
        {
            id: 'notif-grade-001',
            type: 'grade',
            title: 'Nueva nota publicada',
            message: 'Quiz Online — Estilos Arquitectónicos: 8.5',
            createdAt: '2026-03-20T11:10:00Z',
            unread: true,
            targetHash: '#/student/tasks',
            subjectId: 'arq-software-2026',
            readByUserIds: ['alu-001'],
            recipientUserIds: [],
            origin: 'manual',
        },
    ]));

    const response = await handlers['get-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', userId: 'alu-001', limit: '10' }) },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    const gradeNotifs = body.filter((item) => item.id === 'notif-grade-001');
    assert.strictEqual(gradeNotifs.length, 1, 'deduped — mock copy suppressed');
    assert.strictEqual(gradeNotifs[0].unread, false, 'readByUserIds from persisted copy is authoritative');
    assert.strictEqual(gradeNotifs[0].readByUserIds, undefined, 'readByUserIds stripped from public response');
    assert.ok(body.some((item) => item.id === 'notif-summary-001'), 'non-overlapping mock items still appear');
    const mockMaterial = body.find((item) => item.id === 'notif-material-001');
    assert.strictEqual(mockMaterial.unread, false, 'mock notification with unread:false preserves its read state');
});
