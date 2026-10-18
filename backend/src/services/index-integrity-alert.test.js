import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * index-integrity-alert.test.js — #328: cuando una consulta descarta fragmentos
 * porque su metadata no cierra contra el registro de la unidad, el docente y la
 * dirección tienen que enterarse por el canal de avisos del producto, sin que el
 * aviso se multiplique en cada consulta.
 */

let enrollments = [];
let users = [];
let notifications = [];
let upserts = [];
let fallaElCanal = false;

mock.module('./state-store.js', {
    namedExports: {
        getEnrollmentsBySubject: async (subjectId) => enrollments.filter((e) => e.subjectId === subjectId),
    },
});
mock.module('./users-store.js', {
    namedExports: {
        listUsers: async () => users,
    },
});
mock.module('./notification-store.js', {
    namedExports: {
        listNotificationsBySubject: async (subjectId) => {
            if (fallaElCanal) throw new Error('almacenamiento caído');
            return notifications.filter((n) => n.subjectId === subjectId);
        },
        upsertNotificationForSubject: async (subjectId, notification) => {
            upserts.push({ subjectId, notification });
            const idx = notifications.findIndex((n) => n.id === notification.id);
            if (idx === -1) notifications.push({ ...notification, subjectId });
            else notifications[idx] = { ...notification, subjectId };
            return notification;
        },
    },
});

const {
    alertIndexIntegrity,
    resolveIndexIntegrityRecipients,
    indexIntegrityNotificationId,
    INDEX_INTEGRITY_COOLDOWN_MS,
} = await import('./index-integrity-alert.js');

beforeEach(() => {
    enrollments = [];
    users = [];
    notifications = [];
    upserts = [];
    fallaElCanal = false;
});

test('los destinatarios son los docentes activos de la unidad más dirección y administración', async () => {
    enrollments = [
        { subjectId: 'arq-software-2026', userId: 'prof-001', role: 'teacher', status: 'active' },
        { subjectId: 'arq-software-2026', userId: 'prof-baja', role: 'teacher', status: 'inactive' },
        { subjectId: 'arq-software-2026', userId: 'alu-003', role: 'student', status: 'active' },
        { subjectId: 'otra-materia', userId: 'prof-otra', role: 'teacher', status: 'active' },
    ];
    users = [
        { userId: 'dir-001', role: 'director', status: 'active' },
        { userId: 'adm-001', role: 'admin', status: 'active' },
        { userId: 'dir-baja', role: 'director', status: 'inactive' },
        { userId: 'alu-004', role: 'student', status: 'active' },
    ];

    const recipients = await resolveIndexIntegrityRecipients('arq-software-2026');

    assert.deepStrictEqual(recipients.sort(), ['adm-001', 'dir-001', 'prof-001']);
});

test('deja el aviso con identificador determinista y lo direcciona a docentes y dirección', async () => {
    enrollments = [{ subjectId: 'arq-software-2026', userId: 'prof-001', role: 'teacher', status: 'active' }];
    users = [{ userId: 'dir-001', role: 'director', status: 'active' }];

    const result = await alertIndexIntegrity({
        subjectId: 'arq-software-2026',
        droppedMaterialIds: ['b619ef64-huerfano'],
        droppedClassIds: ['class-07', 'class-08'],
        now: '2026-10-18T12:00:00.000Z',
    });

    assert.strictEqual(result.notified, true);
    assert.strictEqual(result.recipients, 2);
    assert.strictEqual(upserts.length, 1);

    const { notification } = upserts[0];
    assert.strictEqual(notification.id, indexIntegrityNotificationId('arq-software-2026'));
    assert.strictEqual(notification.type, 'integrity');
    assert.deepStrictEqual(notification.recipientUserIds.sort(), ['dir-001', 'prof-001']);
    // El aviso dice qué se descartó y por qué señal, para que se pueda accionar.
    assert.match(notification.message, /no figuran en la unidad/);
    assert.match(notification.message, /class-07/);
    assert.match(notification.message, /No se citan en las respuestas/);
});

test('dentro de la ventana de enfriamiento no vuelve a escribir (el aviso se refresca, no se acumula)', async () => {
    enrollments = [{ subjectId: 'arq-software-2026', userId: 'prof-001', role: 'teacher', status: 'active' }];

    const primero = await alertIndexIntegrity({
        subjectId: 'arq-software-2026',
        droppedMaterialIds: ['huerfano-1'],
        now: '2026-10-18T12:00:00.000Z',
    });
    const segundo = await alertIndexIntegrity({
        subjectId: 'arq-software-2026',
        droppedMaterialIds: ['huerfano-1'],
        now: new Date(Date.parse('2026-10-18T12:00:00.000Z') + INDEX_INTEGRITY_COOLDOWN_MS / 2).toISOString(),
    });

    assert.strictEqual(primero.notified, true);
    assert.strictEqual(segundo.notified, false);
    assert.strictEqual(segundo.reason, 'enfriamiento');
    assert.strictEqual(upserts.length, 1, 'una sola escritura en la ventana');
    assert.strictEqual(notifications.length, 1, 'un solo aviso por unidad');
});

test('pasada la ventana de enfriamiento el aviso se actualiza', async () => {
    enrollments = [{ subjectId: 'arq-software-2026', userId: 'prof-001', role: 'teacher', status: 'active' }];

    await alertIndexIntegrity({ subjectId: 'arq-software-2026', droppedMaterialIds: ['huerfano-1'], now: '2026-10-18T12:00:00.000Z' });
    const despues = await alertIndexIntegrity({
        subjectId: 'arq-software-2026',
        droppedMaterialIds: ['huerfano-1', 'huerfano-2'],
        now: new Date(Date.parse('2026-10-18T12:00:00.000Z') + INDEX_INTEGRITY_COOLDOWN_MS + 1000).toISOString(),
    });

    assert.strictEqual(despues.notified, true);
    assert.strictEqual(upserts.length, 2);
    assert.strictEqual(notifications.length, 1, 'sigue siendo un aviso por unidad');
    assert.match(notifications[0].message, /2 material\/es/);
});

test('un aviso guardado sin el tipo correcto se reescribe aunque la ventana siga abierta', async () => {
    enrollments = [{ subjectId: 'arq-software-2026', userId: 'prof-001', role: 'teacher', status: 'active' }];
    // Registro previo degradado a 'material': asi quedaba guardado el aviso de
    // integridad antes de que el tipo existiera en la lista blanca del almacen.
    notifications = [{
        id: indexIntegrityNotificationId('arq-software-2026'),
        subjectId: 'arq-software-2026',
        type: 'material',
        origin: 'rag-registry-filter',
        createdAt: '2026-10-18T12:00:00.000Z',
    }];

    const result = await alertIndexIntegrity({
        subjectId: 'arq-software-2026',
        droppedMaterialIds: ['huerfano-1'],
        now: '2026-10-18T12:05:00.000Z',
    });

    assert.strictEqual(result.notified, true, 'un registro que no sirve se repara aunque la ventana siga abierta');
    assert.strictEqual(notifications[0].type, 'integrity');
});

test('sin nada descartado no escribe ni consulta destinatarios', async () => {
    users = [{ userId: 'dir-001', role: 'director', status: 'active' }];

    const result = await alertIndexIntegrity({ subjectId: 'arq-software-2026', droppedMaterialIds: [], droppedClassIds: [] });

    assert.strictEqual(result.notified, false);
    assert.strictEqual(result.reason, 'sin-datos');
    assert.strictEqual(upserts.length, 0);
});

test('si el canal de avisos falla, la consulta no se rompe y el fallo queda registrado', async () => {
    fallaElCanal = true;
    const errores = [];

    const result = await alertIndexIntegrity({
        subjectId: 'arq-software-2026',
        droppedMaterialIds: ['huerfano-1'],
        context: { error: (...args) => errores.push(args) },
    });

    assert.strictEqual(result.notified, false);
    assert.strictEqual(result.reason, 'error');
    assert.strictEqual(errores.length, 1, 'el fallo queda registrado');
    assert.strictEqual(upserts.length, 0);
});
