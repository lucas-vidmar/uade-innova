import { test, mock } from 'node:test';
import assert from 'node:assert';

const mockTableClient = {
  getEntity: mock.fn(async () => { throw { statusCode: 404 }; }),
};

const storageMocks = {
  listBlobs: mock.fn(async () => []),
  loadJson: mock.fn(async () => []),
  getTableClient: mock.fn(() => mockTableClient),
};

const notificationStoreMocks = {
  listNotificationsBySubject: mock.fn(async () => []),
  upsertNotificationForSubject: mock.fn(async () => true),
};

const stateStoreMocks = {
  getEnrollmentsBySubject: mock.fn(async () => ([
    { userId: 'alu-001', status: 'active' },
  ])),
};

mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/notification-store.js', { namedExports: notificationStoreMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });

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

test('deadline-proximity-dispatcher should filter by user who disabled reminders', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-pref-off',
      title: 'TP Prefs Off',
      subjectId: 'arq-software-2026',
      classId: 'class-10',
      dueDate: '2026-04-12T12:00:00.000Z',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);
  stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => ([
    { userId: 'user-disabled', status: 'active' },
    { userId: 'user-enabled', status: 'active' },
  ]));

  mockTableClient.getEntity = mock.fn(async (userId) => {
    if (userId === 'user-disabled') return { enabled: 'false', cadence: 'both' };
    if (userId === 'user-enabled') return { enabled: 'true', cadence: 'both' };
    throw { statusCode: 404 };
  });

  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
  const now = new Date('2026-04-11T12:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.ok(payload.recipientUserIds.includes('user-enabled'));
  assert.ok(!payload.recipientUserIds.includes('user-disabled'));
});

test('deadline-proximity-dispatcher should exclude 24h-only user from 48h notification', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-48h-exclude',
      title: 'TP 48h test',
      subjectId: 'arq-software-2026',
      classId: 'class-11',
      dueDate: '2026-04-13T12:00:00.000Z',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);
  stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => ([
    { userId: 'user-24h-only', status: 'active' },
    { userId: 'user-both', status: 'active' },
  ]));

  mockTableClient.getEntity = mock.fn(async (userId) => {
    if (userId === 'user-24h-only') return { enabled: 'true', cadence: '24h' };
    if (userId === 'user-both') return { enabled: 'true', cadence: 'both' };
    return { enabled: 'true', cadence: 'both' };
  });

  const now = new Date('2026-04-11T12:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.ok(!payload.recipientUserIds.includes('user-24h-only'), '24h-only user should NOT get 48h notification');
  assert.ok(payload.recipientUserIds.includes('user-both'), 'both user SHOULD get 48h notification');
});

test('deadline-proximity-dispatcher should include 24h-only user in 24h window', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-cadence-24h-window',
      title: 'TP 24h Window',
      subjectId: 'arq-software-2026',
      classId: 'class-12',
      dueDate: '2026-04-11T12:00:00.000Z',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);
  stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => ([
    { userId: 'user-24h-only', status: 'active' },
  ]));

  mockTableClient.getEntity = mock.fn(async () => ({ enabled: 'true', cadence: '24h' }));

  const now = new Date('2026-04-10T12:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.ok(payload.recipientUserIds.includes('user-24h-only'));
});

test('deadline-proximity-dispatcher should use defaults when no pref record exists', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-no-pref',
      title: 'TP Sin Prefs',
      subjectId: 'arq-software-2026',
      classId: 'class-13',
      dueDate: '2026-04-12T12:00:00.000Z',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);
  stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => ([
    { userId: 'user-no-prefs', status: 'active' },
  ]));

  mockTableClient.getEntity = mock.fn(async () => { throw { statusCode: 404 }; });

  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
  const now = new Date('2026-04-11T12:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);
  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();

  assert.strictEqual(result.dispatched, 1);
  assert.strictEqual(after, before + 1);
});

test('deadline-proximity-dispatcher should skip enrollment with no active status', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-inactive',
      title: 'TP Inactive',
      subjectId: 'arq-software-2026',
      classId: 'class-14',
      dueDate: '2026-04-12T12:00:00.000Z',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);
  stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => ([
    { userId: 'user-active', status: 'active' },
    { userId: 'user-inactive', status: 'inactive' },
  ]));

  mockTableClient.getEntity = mock.fn(async (userId) => {
    if (userId === 'user-active') return { enabled: 'true', cadence: 'both' };
    throw { statusCode: 404 };
  });

  const now = new Date('2026-04-11T12:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.ok(payload.recipientUserIds.includes('user-active'));
  assert.ok(!payload.recipientUserIds.includes('user-inactive'));
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

// ── UJ-35: decisión por fecha (vigilar / antelación) y franja horaria ──
test('UJ-35: una fecha declarada como no vigilada no genera aviso', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-nowatch',
      title: 'TP no vigilado',
      subjectId: 'arq-software-2026',
      classId: 'class-20',
      dueDate: '2026-04-12T12:00:00.000Z',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);
  stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => ([
    { userId: 'user-nowatch', status: 'active' },
  ]));

  mockTableClient.getEntity = mock.fn(async () => ({
    enabled: 'true', cadence: 'both', timeWindow: 'any',
    datePrefsJson: JSON.stringify({ '2026-04-12': { watch: false } }),
  }));

  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
  const now = new Date('2026-04-11T12:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);
  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();

  assert.strictEqual(result.dispatched, 0, 'una fecha con watch:false no debe generar aviso');
  assert.strictEqual(after, before);
});

test('UJ-35: la antelación declarada por fecha fija el umbral del aviso', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-lead12',
      title: 'TP antelación 12h',
      subjectId: 'arq-software-2026',
      classId: 'class-21',
      dueDate: '2026-04-12T12:00:00.000Z',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);
  stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => ([
    { userId: 'user-lead12', status: 'active' },
  ]));

  mockTableClient.getEntity = mock.fn(async () => ({
    enabled: 'true', cadence: 'both', timeWindow: 'any',
    datePrefsJson: JSON.stringify({ '2026-04-12': { watch: true, leadHours: 12 } }),
  }));

  const now = new Date('2026-04-12T00:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.title, 'Aviso anticipado — 12 horas antes');
  assert.ok(payload.id.endsWith('-12h'), `id=${payload.id}`);
});

test('UJ-35: con franja declarada el aviso no sale fuera de la franja', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-franja-out',
      title: 'TP franja fuera',
      subjectId: 'arq-software-2026',
      classId: 'class-22',
      dueDate: '2026-04-12T12:00:00.000Z',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);
  stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => ([
    { userId: 'user-evening', status: 'active' },
  ]));

  mockTableClient.getEntity = mock.fn(async () => ({ enabled: 'true', cadence: 'both', timeWindow: 'evening' }));

  // 12:00Z = 09:00 en Buenos Aires → mañana, fuera de la franja "evening".
  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
  const now = new Date('2026-04-11T12:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);
  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();

  assert.strictEqual(result.dispatched, 0, 'fuera de la franja no debe salir el aviso');
  assert.strictEqual(after, before);
});

test('UJ-35: con franja declarada el aviso sale dentro de la franja', async () => {
  storageMocks.listBlobs.mock.mockImplementation(async () => ['arq-software-2026.json']);
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'deadline-franja-in',
      title: 'TP franja dentro',
      subjectId: 'arq-software-2026',
      classId: 'class-23',
      dueDate: '2026-04-12T12:00:00.000Z',
    },
  ]));
  notificationStoreMocks.listNotificationsBySubject.mock.mockImplementation(async () => []);
  stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => ([
    { userId: 'user-evening', status: 'active' },
  ]));

  mockTableClient.getEntity = mock.fn(async () => ({ enabled: 'true', cadence: 'both', timeWindow: 'evening' }));

  // 23:00Z = 20:00 en Buenos Aires → dentro de la franja "evening"; faltan 13h.
  const now = new Date('2026-04-11T23:00:00.000Z');
  const result = await dispatcher.runDeadlineProximityDispatcher({ log: () => {}, error: () => {} }, now);

  assert.strictEqual(result.dispatched, 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.deliveryWindow, 'evening');
  assert.ok(payload.id.endsWith('-24h-evening'), `id=${payload.id}`);
  assert.ok(payload.recipientUserIds.includes('user-evening'));
});
