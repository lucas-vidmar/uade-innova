import { test, mock } from 'node:test';
import assert from 'node:assert';

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
};

mock.module('../services/auth-utils.js', { namedExports: authMocks });

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
