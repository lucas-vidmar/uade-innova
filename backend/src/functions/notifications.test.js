import { test, mock } from 'node:test';
import assert from 'node:assert';

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ userId: 'alu-001', userRoles: ['Alumno'] })),
};

const notificationStoreMocks = {
    listNotificationsBySubject: mock.fn(async () => []),
    listNotificationsSince: mock.fn(async () => []),
    markNotificationReadForUser: mock.fn(async () => ({ success: true, retryAttempts: 0, deadLetterWrites: 0 })),
    dispatchClassSummaryNotification: mock.fn(async () => ({ success: true, retryAttempts: 0, deadLetterWrites: 0, dispatched: 1, recipientCount: 2 })),
    notificationIdForClass: (subjectId, classId) => `notif-auto-summary-${subjectId}-${classId}`,
};

const storageMocks = {
    loadJson: mock.fn(async () => []),
};

const telemetryMocks = {
    trackNotificationInteraction: mock.fn(async () => {}),
};

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'student' })),
};

mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/notification-store.js', { namedExports: notificationStoreMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
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
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
        { id: 'n1', type: 'material', title: 'A', message: 'm', createdAt: '2026-06-19T12:00:00Z', unread: true, targetHash: '#/student/dashboard', subjectId: 'arq-software-2026', recipientUserIds: [] },
        { id: 'n2', type: 'summary', title: 'B', message: 'm', createdAt: '2026-06-19T13:00:00Z', unread: true, targetHash: '#/student/dashboard', subjectId: 'arq-software-2026', recipientUserIds: [] },
        { id: 'n3', type: 'deadline', title: 'C', message: 'm', createdAt: '2026-06-19T14:00:00Z', unread: true, targetHash: '#/student/dashboard', subjectId: 'arq-software-2026', recipientUserIds: [] },
    ]));

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
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
        { id: 'n1', type: 'material', createdAt: '2026-06-19T12:00:00Z', subjectId: 'arq-software-2026', recipientUserIds: [] },
    ]));

    const response = await handlers['get-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', limit: '0' }) },
        { log: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 1);

    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([]));
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

test('get-notifications should return persisted notification with correct read state', async () => {
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
    assert.strictEqual(gradeNotifs.length, 1, 'should return the persisted notification once');
    assert.strictEqual(gradeNotifs[0].unread, false, 'persisted copy with readByUserIds should be authoritative');
});

test('get-notifications should return empty array when no persisted data exists', async () => {
    notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([]));

    const response = await handlers['get-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', limit: '10' }) },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.length, 0, 'should return empty array when no notifications exist');
});

test('get-notifications should return all persisted notifications', async () => {
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
        {
            id: 'notif-summary-001',
            type: 'summary',
            title: 'Resumen validado',
            message: 'Clase 2 lista.',
            createdAt: '2026-03-18T09:00:00Z',
            unread: true,
            targetHash: '#/student/dashboard',
            subjectId: 'arq-software-2026',
            recipientUserIds: [],
            origin: 'post-class-summary-timer',
        },
    ]));

    const response = await handlers['get-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', limit: '10' }) },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    const gradeNotifs = body.filter((item) => item.id === 'notif-grade-001');
    assert.strictEqual(gradeNotifs.length, 1, 'notification appears once');
    assert.ok(body.some((item) => item.id === 'notif-summary-001'), 'all persisted notifications should appear');
});

test('get-notifications should return unread state correctly and strip readByUserIds from public response', async () => {
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
        {
            id: 'notif-material-001',
            type: 'material',
            title: 'Nuevo material disponible',
            message: 'Nuevo archivo cargado',
            createdAt: '2026-03-17T18:45:00Z',
            unread: false,
            targetHash: '#/student/class/class-02',
            subjectId: 'arq-software-2026',
            recipientUserIds: [],
            origin: 'test',
        },
    ]));

    const response = await handlers['get-notifications'](
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', userId: 'alu-001', limit: '10' }) },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    const gradeNotifs = body.filter((item) => item.id === 'notif-grade-001');
    assert.strictEqual(gradeNotifs.length, 1);
    assert.strictEqual(gradeNotifs[0].unread, false, 'readByUserIds should mark as read');
    assert.strictEqual(gradeNotifs[0].readByUserIds, undefined, 'readByUserIds stripped from public response');
    const materialNotif = body.find((item) => item.id === 'notif-material-001');
    assert.strictEqual(materialNotif.unread, false, 'notification with unread:false preserves its read state');
});

// ── POST /api/notifications — dispatch class publish ────────────

test('dispatch-class-publish-notification should reject non-teacher principals', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'alu-001', userRoles: ['Alumno'] }));

    const response = await handlers['dispatch-class-publish-notification'](
        {
            method: 'POST',
            headers: new Map(),
            json: async () => ({ subjectId: 'arq-software-2026', classId: 'class-03' }),
        },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 403);
    assert.ok(notificationStoreMocks.dispatchClassSummaryNotification.mock.callCount() === 0);
});

test('dispatch-class-publish-notification should return 400 when body fields are missing', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'doc-001', userRoles: ['Docente'] }));
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'teacher' }));

    const response = await handlers['dispatch-class-publish-notification'](
        {
            method: 'POST',
            headers: new Map(),
            json: async () => ({ subjectId: 'arq-software-2026' }),
        },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 400);
    const body = JSON.parse(response.body);
    assert.ok(body.error.includes('subjectId, classId'));
});

test('dispatch-class-publish-notification should return 404 when class is not found', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'doc-001', userRoles: ['Docente'] }));
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'teacher' }));
    storageMocks.loadJson.mock.mockImplementation(async () => ([{ id: 'class-01', title: 'Clase 1' }]));

    const response = await handlers['dispatch-class-publish-notification'](
        {
            method: 'POST',
            headers: new Map(),
            json: async () => ({ subjectId: 'arq-software-2026', classId: 'class-999' }),
        },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 404);
});

test('dispatch-class-publish-notification should dispatch and return notificationId', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'doc-001', userRoles: ['Docente'] }));
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'teacher' }));
    storageMocks.loadJson.mock.mockImplementation(async () => ([{
        id: 'class-03',
        title: 'Clase 3 — Arquitectura Hexagonal',
        date: '2026-04-09',
        studentIds: ['alu-001'],
        summaryReady: true,
    }]));
    notificationStoreMocks.dispatchClassSummaryNotification.mock.mockImplementation(async () => ({ success: true, retryAttempts: 0, deadLetterWrites: 0, dispatched: 1, recipientCount: 2 }));

    const before = notificationStoreMocks.dispatchClassSummaryNotification.mock.callCount();
    const response = await handlers['dispatch-class-publish-notification'](
        {
            method: 'POST',
            headers: new Map(),
            json: async () => ({ subjectId: 'arq-software-2026', classId: 'class-03' }),
        },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.notificationId, 'notif-auto-summary-arq-software-2026-class-03');
    assert.strictEqual(body.recipients, 2);
    assert.strictEqual(notificationStoreMocks.dispatchClassSummaryNotification.mock.callCount(), before + 1);
    const dispatchArg = notificationStoreMocks.dispatchClassSummaryNotification.mock.calls.at(-1).arguments[0];
    assert.strictEqual(dispatchArg.subjectId, 'arq-software-2026');
    assert.strictEqual(dispatchArg.classData.id, 'class-03');
    assert.strictEqual(dispatchArg.origin, 'class-publish');
});

test('dispatch-class-publish-notification should return 500 when persistence fails', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'doc-001', userRoles: ['Docente'] }));
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'teacher' }));
    storageMocks.loadJson.mock.mockImplementation(async () => ([{ id: 'class-03', title: 'Clase 3' }]));
    notificationStoreMocks.dispatchClassSummaryNotification.mock.mockImplementation(async () => ({ success: false, retryAttempts: 3, deadLetterWrites: 1 }));

    const response = await handlers['dispatch-class-publish-notification'](
        {
            method: 'POST',
            headers: new Map(),
            json: async () => ({ subjectId: 'arq-software-2026', classId: 'class-03' }),
        },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 500);
});

test('dispatch-class-publish-notification should reject non-teacher enrollment', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'doc-002', userRoles: ['Docente'] }));
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'student' }));

    const response = await handlers['dispatch-class-publish-notification'](
        {
            method: 'POST',
            headers: new Map(),
            json: async () => ({ subjectId: 'arq-software-2026', classId: 'class-03' }),
        },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 403);
});
