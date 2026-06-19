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

test('deadline-proximity-dispatcher should emit notification with dueDateTimezone in payload', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-tz-payload',
      title: 'TP con timezone',
      subjectId: 'arq-software-2026',
      classId: 'class-06',
      dueDate: '2026-04-12T12:00:00.000Z',
      timezone: 'America/Argentina/Buenos_Aires',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);

  const now = new Date('2026-04-11T12:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.dueDateTimezone, 'America/Argentina/Buenos_Aires');
});

test('deadline-proximity-dispatcher should handle date-only dueDate in target timezone', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-dateonly',
      title: 'TP fecha sola',
      subjectId: 'arq-software-2026',
      classId: 'class-07',
      dueDate: '2026-04-13',
      timezone: 'America/Argentina/Buenos_Aires',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);

  const now = new Date('2026-04-11T03:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.title, 'Deadline en 48 horas');
});

test('deadline-proximity-dispatcher should fall back to default timezone when timezone missing', async () => {
  const originalEnv = process.env.DEFAULT_TIMEZONE;
  delete process.env.DEFAULT_TIMEZONE;

  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-no-tz',
      title: 'TP sin timezone',
      subjectId: 'arq-software-2026',
      classId: 'class-08',
      dueDate: '2026-04-13T03:00:00.000Z',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);

  const now = new Date('2026-04-11T03:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.title, 'Deadline en 48 horas');
  assert.strictEqual(payload.dueDateTimezone, 'America/Argentina/Buenos_Aires');

  if (originalEnv) process.env.DEFAULT_TIMEZONE = originalEnv;
});

test('deadline-proximity-dispatcher should fall back to default for invalid timezone', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-bad-tz',
      title: 'TP timezone inválido',
      subjectId: 'arq-software-2026',
      dueDate: '2026-04-13T03:00:00.000Z',
      timezone: 'Invalid/Zone',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);

  const now = new Date('2026-04-11T03:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.dueDateTimezone, 'America/Argentina/Buenos_Aires');
});

test('deadline-proximity-dispatcher should emit 2h escalation for high-weight pending deadline', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-high-weight',
      title: 'Parcial 1',
      subjectId: 'arq-software-2026',
      classId: 'class-05',
      dueDate: '2026-04-11T11:00:00.000Z',
      weight: 35,
      status: 'pending',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);

  const now = new Date('2026-04-11T09:30:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.title, '⚠️ Deadline urgente — 2 horas restantes');
  assert.ok(payload.id.endsWith('-2h'));
});

test('deadline-proximity-dispatcher should NOT emit 2h escalation for low-weight deadline', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-low-weight',
      title: 'Lectura opcional',
      subjectId: 'arq-software-2026',
      classId: 'class-05',
      dueDate: '2026-04-11T11:00:00.000Z',
      weight: 5,
      status: 'pending',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);

  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
  const now = new Date('2026-04-11T09:30:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);
  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();

  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(after, before);
});

test('deadline-proximity-dispatcher should NOT emit 2h escalation for completed deadline', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-completed',
      title: 'TP entregado',
      subjectId: 'arq-software-2026',
      classId: 'class-05',
      dueDate: '2026-04-11T11:00:00.000Z',
      weight: 40,
      status: 'completed',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);

  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
  const now = new Date('2026-04-11T09:30:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);
  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();

  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(after, before);
});

test('deadline-proximity-dispatcher should skip duplicate 2h escalation', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-dup-2h',
      title: 'Parcial 2',
      subjectId: 'arq-software-2026',
      classId: 'class-06',
      dueDate: '2026-04-11T11:00:00.000Z',
      weight: 30,
      status: 'pending',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => ([
    { id: 'notif-deadline-arq-software-2026-deadline-dup-2h-2h' },
  ]));

  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
  const now = new Date('2026-04-11T09:30:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);
  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();

  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(after, before);
});

test('deadline-proximity-dispatcher should use UTC timezone when specified', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-utc',
      title: 'TP UTC',
      subjectId: 'arq-software-2026',
      classId: 'class-09',
      dueDate: '2026-04-13T09:00:00.000Z',
      timezone: 'UTC',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);

  const now = new Date('2026-04-11T09:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.title, 'Deadline en 48 horas');
  assert.strictEqual(payload.dueDateTimezone, 'UTC');
});
