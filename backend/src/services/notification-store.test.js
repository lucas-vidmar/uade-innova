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

test('dispatchClassSummaryNotification should merge enrolled students with class studentIds', async () => {
  storageMocks.loadJson.mock.mockImplementation(async () => []);
  stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => ([
    { subjectId: 's1', userId: 'alu-001', role: 'student', status: 'active' },
    { subjectId: 's1', userId: 'alu-002', role: 'student', status: 'active' },
    { subjectId: 's1', userId: 'alu-003', role: 'teacher', status: 'active' },
    { subjectId: 's1', userId: 'alu-004', role: 'student', status: 'inactive' },
  ]));

  const result = await store.dispatchClassSummaryNotification({
    subjectId: 's1',
    classData: { id: 'class-03', title: 'Clase 3', studentIds: ['alu-005'] },
    origin: 'class-publish',
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.dispatched, 1);
  assert.strictEqual(result.recipientCount, 3);
  const [, , payload] = storageMocks.saveJson.mock.calls.at(-1).arguments;
  const saved = payload[0];
  assert.strictEqual(saved.id, 'notif-auto-summary-s1-class-03');
  assert.strictEqual(saved.type, 'summary');
  assert.strictEqual(saved.origin, 'class-publish');
  assert.deepStrictEqual(saved.recipientUserIds, ['alu-001', 'alu-002', 'alu-005']);
  assert.strictEqual(saved.targetHash, '#/student/class/class-03');
});

test('dispatchClassSummaryNotification should fall back to class studentIds when enrollments fail', async () => {
  storageMocks.loadJson.mock.mockImplementation(async () => []);
  stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => {
    throw new Error('storage unavailable');
  });

  const result = await store.dispatchClassSummaryNotification({
    subjectId: 's1',
    classData: { id: 'class-01', title: 'Clase 1', studentIds: ['alu-001', 'alu-002'] },
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.recipientCount, 2);
  const [, , payload] = storageMocks.saveJson.mock.calls.at(-1).arguments;
  assert.deepStrictEqual(payload[0].recipientUserIds, ['alu-001', 'alu-002']);
});

test('dispatchClassSummaryNotification should skip when classData is missing id', async () => {
  storageMocks.loadJson.mock.mockImplementation(async () => []);
  const saveBefore = storageMocks.saveJson.mock.callCount();

  const result = await store.dispatchClassSummaryNotification({ subjectId: 's1', classData: {} });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(storageMocks.saveJson.mock.callCount(), saveBefore);
});

// UJ-19: el aviso de publicación no puede sobrevivir al retiro de la clase. Se
// reescribe el mismo aviso (mismo id) como aviso de retiro, conservando lo que
// cada persona ya marcó como leído.
test('retractClassSummaryNotification reescribe el aviso como retiro y conserva readByUserIds', async () => {
  stateStoreMocks.getEnrollmentsBySubject.mock.mockImplementation(async () => ([
    { subjectId: 's1', userId: 'alu-001', role: 'student', status: 'active' },
    { subjectId: 's1', userId: 'alu-002', role: 'student', status: 'active' },
  ]));
  storageMocks.loadJson.mock.mockImplementation(async () => ([
    {
      id: 'notif-auto-summary-s1-class-01',
      type: 'summary',
      title: 'Resumen validado por docente',
      message: 'Clase 1 ya tiene resumen validado.',
      createdAt: '2026-04-10T08:00:00Z',
      unread: true,
      subjectId: 's1',
      recipientUserIds: ['alu-001', 'alu-002'],
      readByUserIds: ['alu-001'],
      origin: 'class-publish',
    },
  ]));

  const result = await store.retractClassSummaryNotification({
    subjectId: 's1',
    classData: { id: 'class-01', title: 'Clase 1' },
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.dispatched, 1);
  const [, , payload] = storageMocks.saveJson.mock.calls.at(-1).arguments;
  assert.strictEqual(payload.length, 1, 'debe reescribir el mismo aviso, no agregar otro');
  const saved = payload[0];
  assert.strictEqual(saved.id, 'notif-auto-summary-s1-class-01');
  assert.strictEqual(saved.title, 'Material retirado');
  assert.ok(/retirado/i.test(saved.message), `el mensaje debe declarar el retiro: ${saved.message}`);
  assert.ok(!/validado/i.test(saved.message), 'el aviso ya no puede afirmar que el resumen está validado');
  assert.deepStrictEqual(saved.readByUserIds, ['alu-001'], 'no se pierde lo ya leído');
  assert.strictEqual(saved.origin, 'class-unpublish');
});

test('retractClassSummaryNotification should skip when classData is missing id', async () => {
  const saveBefore = storageMocks.saveJson.mock.callCount();
  const result = await store.retractClassSummaryNotification({ subjectId: 's1', classData: {} });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(storageMocks.saveJson.mock.callCount(), saveBefore);
});
