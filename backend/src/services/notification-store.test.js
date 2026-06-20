import { test, mock } from 'node:test';
import assert from 'node:assert';

const storageMocks = {
  loadJson: mock.fn(async () => []),
  saveJson: mock.fn(async () => true),
};

mock.module('./storage.js', { namedExports: storageMocks });

const store = await import('./notification-store.js');

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

test('markNotificationReadForUser should append user to readByUserIds', async () => {
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'notif-1',
      type: 'material',
      title: 'Nuevo material',
      subjectId: 'arq-software-2026',
      unread: true,
      readByUserIds: [],
    },
  ]));

  const result = await store.markNotificationReadForUser('arq-software-2026', 'notif-1', 'alu-001');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.retryAttempts, 0);

  const [, , payload] = storageMocks.saveJson.mock.calls.at(-1).arguments;
  assert.strictEqual(payload[0].id, 'notif-1');
  assert.deepStrictEqual(payload[0].readByUserIds, ['alu-001']);
});

test('should retry on transient saveJson failure and succeed', async () => {
  let callCount = 0;
  storageMocks.loadJson.mock.mockImplementation(async () => []);
  storageMocks.saveJson.mock.mockImplementation(async () => {
    callCount += 1;
    if (callCount <= 2) throw new Error('Transient storage error');
  });

  const result = await store.upsertNotificationForSubject('arq-software-2026', {
    id: 'notif-retry-test',
    type: 'material',
    title: 'Retry test',
    subjectId: 'arq-software-2026',
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.retryAttempts, 2);
  assert.strictEqual(result.deadLetterWrites, 0);
  assert.strictEqual(callCount, 3);
});

test('should write dead-letter after exhausting all retries', async () => {
  let callCount = 0;
  storageMocks.loadJson.mock.mockImplementation(async () => []);
  storageMocks.saveJson.mock.mockImplementation(async () => {
    callCount += 1;
    if (callCount <= 3) throw new Error('Persistent storage error');
  });

  const result = await store.upsertNotificationForSubject('arq-software-2026', {
    id: 'notif-dl-test',
    type: 'material',
    title: 'Dead letter test',
    subjectId: 'arq-software-2026',
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.retryAttempts, 3);
  assert.strictEqual(result.deadLetterWrites, 1);
  assert.strictEqual(callCount, 4);
});

test('should mark notification read with retry on transient failure', async () => {
  let callCount = 0;
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    { id: 'notif-retry-read', type: 'material', title: 'Test', subjectId: 's1', unread: true, readByUserIds: [] },
  ]));
  storageMocks.saveJson.mock.mockImplementation(async () => {
    callCount += 1;
    if (callCount <= 1) throw new Error('Transient error');
  });

  const result = await store.markNotificationReadForUser('s1', 'notif-retry-read', 'user-1');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.retryAttempts, 1);
});
