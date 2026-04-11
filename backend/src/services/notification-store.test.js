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

  await store.upsertNotificationForSubject('arq-software-2026', {
    id: 'notif-auto-summary-arq-software-2026-class-03',
    type: 'summary',
    title: 'Resumen validado por docente',
    message: 'Clase 3 — Arquitectura Hexagonal ya tiene resumen validado.',
    createdAt: '2026-04-10T09:00:00Z',
    unread: true,
    origin: 'post-class-summary-timer',
  });

  assert.ok(storageMocks.saveJson.mock.callCount() >= 1);
  const [, , payload] = storageMocks.saveJson.mock.calls.at(-1).arguments;
  assert.strictEqual(Array.isArray(payload), true);
  assert.strictEqual(payload.length, 1);
  assert.strictEqual(payload[0].id, 'notif-auto-summary-arq-software-2026-class-03');
  assert.ok(payload[0].message.includes('Arquitectura Hexagonal'));
});
