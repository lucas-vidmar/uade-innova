import { test, mock } from 'node:test';
import assert from 'node:assert';

const storageMocks = {
  loadJson: mock.fn(async () => null),
  listBlobs: mock.fn(async () => []),
};

const notificationStoreMocks = {
  upsertNotificationForSubject: mock.fn(async () => true),
};

const stateStoreMocks = {
  listClassesBySubject: mock.fn(async () => []),
  listMaterialsByClass: mock.fn(async () => []),
};

mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/notification-store.js', { namedExports: notificationStoreMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });

let timerHandler;
mock.module('@azure/functions', {
  namedExports: {
    app: {
      timer: (name, options) => {
        if (name === 'daily-reminders') timerHandler = options.handler;
      },
    },
  },
});

const dispatcher = await import('./daily-reminders.js');

test('daily-reminders should upsert reminder for class within 24h without materials', async () => {
  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') {
      return [{ id: 'arq-software-2026', name: 'Arquitectura de Software' }];
    }
    return null;
  });

  stateStoreMocks.listClassesBySubject.mock.mockImplementation(async () => ([
    {
      id: 'class-03',
      title: 'Clase 3 — Arquitectura Hexagonal',
      date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      professorIds: ['teacher-001'],
      studentIds: ['alu-001'],
    },
  ]));

  stateStoreMocks.listMaterialsByClass.mock.mockImplementation(async () => []);

  const result = await dispatcher.runDailyReminders({ log: () => {}, error: () => {} });

  assert.strictEqual(result.dispatched, 1);
  assert.ok(notificationStoreMocks.upsertNotificationForSubject.mock.callCount() >= 1);
  const [, payload] = notificationStoreMocks.upsertNotificationForSubject.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.type, 'teacher-reminder');
  assert.ok(payload.title.includes('Recordatorio'));
  assert.ok(payload.id.endsWith('class-03'));
  assert.deepStrictEqual(payload.recipientUserIds, ['teacher-001']);
});

test('daily-reminders should skip class with ready materials', async () => {
  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') {
      return [{ id: 'arq-software-2026', name: 'Arquitectura de Software' }];
    }
    return null;
  });

  stateStoreMocks.listClassesBySubject.mock.mockImplementation(async () => ([
    {
      id: 'class-04',
      title: 'Clase 4 — CQRS',
      date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      professorIds: ['teacher-001'],
    },
  ]));

  stateStoreMocks.listMaterialsByClass.mock.mockImplementation(async () => ([
    { id: 'mat-001', materialId: 'mat-001', status: 'ready' },
  ]));

  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
  const result = await dispatcher.runDailyReminders({ log: () => {}, error: () => {} });
  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();

  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(after, before);
});

test('daily-reminders should skip class outside 24h window', async () => {
  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') {
      return [{ id: 'arq-software-2026', name: 'Arquitectura de Software' }];
    }
    return null;
  });

  stateStoreMocks.listClassesBySubject.mock.mockImplementation(async () => ([
    {
      id: 'class-05',
      title: 'Clase 5 — DDD',
      date: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      professorIds: ['teacher-001'],
    },
  ]));

  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
  const result = await dispatcher.runDailyReminders({ log: () => {}, error: () => {} });
  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();

  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(after, before);
});

test('daily-reminders should skip past class', async () => {
  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') {
      return [{ id: 'arq-software-2026', name: 'Arquitectura de Software' }];
    }
    return null;
  });

  stateStoreMocks.listClassesBySubject.mock.mockImplementation(async () => ([
    {
      id: 'class-06',
      title: 'Clase 6 — Testing',
      date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      professorIds: ['teacher-001'],
    },
  ]));

  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
  const result = await dispatcher.runDailyReminders({ log: () => {}, error: () => {} });
  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();

  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(after, before);
});

test('daily-reminders should skip class with partial material status', async () => {
  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') {
      return [{ id: 'arq-software-2026', name: 'Arquitectura de Software' }];
    }
    return null;
  });

  stateStoreMocks.listClassesBySubject.mock.mockImplementation(async () => ([
    {
      id: 'class-07',
      title: 'Clase 7 — Event Sourcing',
      date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      professorIds: ['teacher-001'],
    },
  ]));

  stateStoreMocks.listMaterialsByClass.mock.mockImplementation(async () => ([
    { id: 'mat-002', materialId: 'mat-002', status: 'processing' },
    { id: 'mat-003', materialId: 'mat-003', status: 'error' },
  ]));

  const result = await dispatcher.runDailyReminders({ log: () => {}, error: () => {} });
  assert.strictEqual(result.dispatched, 1);
});

test('timer handler should execute dispatcher without throwing', async () => {
  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') return [];
    return null;
  });

  await timerHandler({}, { log: () => {}, error: () => {} });
  assert.ok(true);
});
