import { test, mock } from 'node:test';
import assert from 'node:assert';

const storageMocks = {
  loadJson: mock.fn(async () => []),
  saveJson: mock.fn(async () => true),
};

const stateStoreMocks = {
  getEnrollmentsBySubject: mock.fn(async () => []),
};

mock.module('./storage.js', { namedExports: storageMocks });
mock.module('./state-store.js', { namedExports: stateStoreMocks });

const store = await import('./notification-store.js');

// UJ-58, paso 8: el aviso que ya se leyó no puede volver a quedar pendiente porque
// el mismo aviso se actualice (p. ej. la fecha de una entrega que se mueve).
test('upsertNotificationForSubject preserves the read state of an updated notification (UJ-58)', async () => {
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'notif-deadline-change-deadline-1',
      type: 'deadline',
      title: 'Nueva tarea: TP 1',
      message: 'TP 1 — Fecha: 15/3/2027',
      createdAt: '2027-03-01T08:00:00.000Z',
      unread: true,
      subjectId: 'arq-software-2026',
      origin: 'deadline-save',
      readByUserIds: ['alu-001', 'alu-003'],
    },
  ]));
  storageMocks.saveJson.mock.mockImplementation(async () => true);

  const result = await store.upsertNotificationForSubject('arq-software-2026', {
    id: 'notif-deadline-change-deadline-1',
    type: 'deadline',
    title: 'Fecha actualizada: TP 1',
    message: 'TP 1 ahora vence el 22/3/2027',
    createdAt: '2027-03-02T08:00:00.000Z',
    unread: true,
    origin: 'deadline-save',
  });

  assert.strictEqual(result.success, true);
  const [, , payload] = storageMocks.saveJson.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.length, 1);
  assert.ok(payload[0].message.includes('ahora vence el 22/3/2027'));
  assert.deepStrictEqual([...payload[0].readByUserIds].sort(), ['alu-001', 'alu-003']);
});

test('upsertNotificationForSubject should replace existing notification by id', async () => {
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'notif-auto-summary-arq-software-2026-class-03',
      type: 'summary',
      title: 'Resumen validado por docente',
      message: 'Clase 3 ya tiene resumen validado.',
      createdAt: '2026-04-10T08:00:00Z',
      unread: true,
      subjectId: 'arq-software-2026',
      origin: 'post-class-summary-timer',
    },
  ]));

  const result = await store.upsertNotificationForSubject('arq-software-2026', {
    id: 'notif-auto-summary-arq-software-2026-class-03',
    type: 'summary',
    title: 'Resumen validado por docente',
    message: 'Clase 3 — Arquitectura Hexagonal ya tiene resumen validado.',
    createdAt: '2026-04-10T09:00:00Z',
    unread: true,
    origin: 'post-class-summary-timer',
  });

  assert.ok(storageMocks.saveJson.mock.callCount() >= 1);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.retryAttempts, 0);
  const [, , payload] = storageMocks.saveJson.mock.calls.at(-1).arguments;
  assert.strictEqual(Array.isArray(payload), true);
  assert.strictEqual(payload.length, 1);
  assert.strictEqual(payload[0].id, 'notif-auto-summary-arq-software-2026-class-03');
  assert.ok(payload[0].message.includes('Arquitectura Hexagonal'));
});
