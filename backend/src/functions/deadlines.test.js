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
    getEnrollmentsBySubject: mock.fn(async () => []),
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

test('mover la fecha conserva la anterior y el aviso nombra ambas (UJ-36)', async () => {
    storageMocks.saveJson.mock.resetCalls();
    storageMocks.loadJson.mock.mockImplementation(async (container) => {
        if (container === 'deadlines') {
            return [{
                id: 'd-move',
                title: 'TP Final',
                subjectId: 'arq-software-2026',
                classId: 'class-14',
                dueDate: '2026-04-30',
            }];
        }
        return [];
    });

    const response = await savedHandler(
        {
            json: async () => ({
                id: 'd-move',
                title: 'TP Final',
                subjectId: 'arq-software-2026',
                classId: 'class-14',
                dueDate: '2026-05-15',
                changeReason: 'se superpone con el parcial',
            }),
        },
        { log: mock.fn(), warn: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.previousDueDate, '2026-04-30');
    assert.strictEqual(body.changeReason, 'se superpone con el parcial');

    const notifWrites = storageMocks.saveJson.mock.calls.filter((c) => c.arguments[0] === 'notifications');
    assert.ok(notifWrites.length > 0, 'debe persistir el aviso del cambio');

    const notifications = notifWrites[notifWrites.length - 1].arguments[2];
    const notif = notifications.find((n) => n.id === 'notif-deadline-change-d-move');
    assert.ok(notif, 'debe existir el aviso del cambio de fecha');

    const fmt = (d) => new Date(d).toLocaleDateString('es-AR');
    assert.ok(notif.message.includes(fmt('2026-04-30')), 'el aviso debe nombrar la fecha anterior');
    assert.ok(notif.message.includes(fmt('2026-05-15')), 'el aviso debe nombrar la fecha nueva');
    assert.ok(notif.message.includes('se superpone con el parcial'), 'el aviso debe incluir el motivo');
});

// Regresión introducida por el fix de UJ-36 (#421): el aviso de "cambio de fecha"
// se construía siempre, y en un alta `existingDeadline` es undefined, así que
// `${fmt(existingDeadline.dueDate)}` lanzaba un TypeError que el try/catch
// silenciaba. Resultado: crear una fecha no generaba NINGÚN aviso. Este test
// falla con el código anterior (no hay escritura de 'notifications').
test('crear una fecha genera el aviso "Nueva tarea" (regresión #421)', async () => {
    storageMocks.saveJson.mock.resetCalls();
    storageMocks.loadJson.mock.mockImplementation(async () => []);

    const response = await savedHandler(
        {
            json: async () => ({
                id: 'd-new',
                title: 'TP Nuevo',
                subjectId: 'arq-software-2026',
                classId: 'class-14',
                dueDate: '2026-06-01',
            }),
        },
        { log: mock.fn(), warn: mock.fn(), error: mock.fn() }
    );

    assert.strictEqual(response.status, 200);

    const notifWrites = storageMocks.saveJson.mock.calls.filter((c) => c.arguments[0] === 'notifications');
    assert.ok(notifWrites.length > 0, 'crear una fecha debe persistir su aviso');

    const notifications = notifWrites[notifWrites.length - 1].arguments[2];
    const notif = notifications.find((n) => n.id === 'notif-deadline-change-d-new');
    assert.ok(notif, 'debe existir el aviso de la tarea nueva');
    assert.strictEqual(notif.title, 'Nueva tarea: TP Nuevo');
    assert.ok(notif.message.includes('TP Nuevo'), 'el aviso debe nombrar la tarea');
});
