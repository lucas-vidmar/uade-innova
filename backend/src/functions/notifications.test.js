import { test, mock } from 'node:test';
import assert from 'node:assert';

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
};

const notificationStoreMocks = {
    listNotificationsBySubject: mock.fn(async () => []),
};

mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/notification-store.js', { namedExports: notificationStoreMocks });

let notificationsHandler;
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                if (name === 'get-notifications') notificationsHandler = options.handler;
            },
        },
    },
});

await import('./notifications.js');

test('get-notifications should filter by subject and honor limit', async () => {
    const response = await notificationsHandler(
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

    const response = await notificationsHandler(
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

    const response = await notificationsHandler(
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', userId: 'alu-001', limit: '10' }) },
        { log: () => {}, error: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.ok(!body.some((item) => item.id === 'notif-targeted'));
});

test('get-notifications should clamp invalid limit values', async () => {
    const response = await notificationsHandler(
        { query: new URLSearchParams({ limit: '0' }) },
        { log: () => {} }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 1);
});
