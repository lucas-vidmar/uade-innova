import { test, mock } from 'node:test';
import assert from 'node:assert';

const storageMocks = {
  listBlobs: mock.fn(async () => []),
  loadJson: mock.fn(async () => []),
};

const notificationStoreMocks = {
  listNotificationsBySubject: mock.fn(async () => []),
  upsertNotificationForSubject: mock.fn(async () => true),
};

mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/notification-store.js', { namedExports: notificationStoreMocks });

let timerHandler;
mock.module('@azure/functions', {
  namedExports: {
    app: {
      timer: (name, options) => {
        if (name === 'deadline-proximity-dispatcher') timerHandler = options.handler;
      },
    },
  },
});

const dispatcher = await import('./deadline-proximity-dispatcher.js');

test('deadline-proximity-dispatcher should emit 24h remaining reminder', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-24h',
      title: 'TP Arquitectura Hexagonal',
      subjectId: 'arq-software-2026',
      classId: 'class-03',
      dueDate: '2026-04-12T12:00:00.000Z',
    },
  ]));

  const now = new Date('2026-04-11T12:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  assert.ok(notificationStoreMocks.upsertNotificationForSubject.mock.callCount() >= 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.type, 'deadline');
  assert.strictEqual(payload.title, 'Deadline en 24 horas');
  assert.ok(payload.id.endsWith('-24h'));
});

test('deadline-proximity-dispatcher should emit 48h remaining reminder', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-48h',
      title: 'Entrega parcial',
      subjectId: 'arq-software-2026',
      classId: 'class-04',
      dueDate: '2026-04-13T09:00:00.000Z',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);

  const now = new Date('2026-04-11T09:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.title, 'Deadline en 48 horas');
  assert.ok(payload.id.endsWith('-48h'));
});

test('deadline-proximity-dispatcher should skip duplicate reminder ids', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-24h-dup',
      title: 'TP Integrador',
      subjectId: 'arq-software-2026',
      classId: 'class-05',
      dueDate: '2026-04-12T12:00:00.000Z',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
    { id: 'notif-deadline-arq-software-2026-deadline-24h-dup-24h' },
  ]));

  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
  const now = new Date('2026-04-11T12:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);
  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();

  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(after, before);
});

test('timer handler should execute dispatcher without throwing', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => []);
  await timerHandler({}, { log: () => {}, error: () => {} });
  assert.ok(true);
});
