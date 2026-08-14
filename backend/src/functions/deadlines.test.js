import { test, mock } from 'node:test';
import assert from 'node:assert';

const storageMocks = {
    loadJson: mock.fn(async () => []),
    saveJson: mock.fn(async () => true),
    getTableClient: mock.fn(() => ({
        createTable: mock.fn(async () => {}),
        listEntities: mock.fn(() => ({
            [Symbol.asyncIterator]: async function* () { yield* []; }
        })),
        upsertEntity: mock.fn(async () => {}),
        getEntity: mock.fn(async () => ({})),
        deleteEntity: mock.fn(async () => {})
    })),
};

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ userRoles: ['Docente'], userDetails: 'teacher@uade.edu' })),
};

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'teacher' })),
};

mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });

let savedHandler;
let remindersHandler;
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                if (name === 'save-deadline') savedHandler = options.handler;
                if (name === 'get-deadline-reminders') remindersHandler = options.handler;
            },
        },
    },
});

await import('./deadlines.js');

test('save-deadline should persist a class-linked deadline', async () => {
    const response = await savedHandler(
        {
            json: async () => ({
                title: 'Final Project',
                description: 'Entrega final',
                subjectId: 'arq-software-2026',
                classId: 'class-14',
                dueDate: '2026-04-30',
            }),
        },
        { log: mock.fn(), warn: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.title, 'Final Project');
    assert.strictEqual(body.classId, 'class-14');
    assert.ok(storageMocks.saveJson.mock.callCount() > 0);
});

test('get-deadline-reminders should return day-before and day-of reminders', async () => {
    storageMocks.loadJson.mock.mockImplementation(async () => [
        {
            id: 'd1',
            title: 'Final Project',
            subjectId: 'arq-software-2026',
            classId: 'class-14',
            dueDate: '2026-04-30',
            notifyOnDayBefore: true,
            notifyOnDayOf: true,
        },
    ]);

    const dayBefore = await remindersHandler(
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', today: '2026-04-29' }) },
        {}
    );
    const dayOf = await remindersHandler(
        { query: new URLSearchParams({ subjectId: 'arq-software-2026', today: '2026-04-30' }) },
        {}
    );

    assert.strictEqual(JSON.parse(dayBefore.body).length, 1);
    assert.strictEqual(JSON.parse(dayOf.body).length, 1);
});
