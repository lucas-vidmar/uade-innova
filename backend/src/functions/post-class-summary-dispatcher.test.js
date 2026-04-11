import { test, mock } from 'node:test';
import assert from 'node:assert';

const storageMocks = {
  loadJson: mock.fn(async () => null),
  listBlobs: mock.fn(async () => []),
};

const notificationStoreMocks = {
  upsertNotificationForSubject: mock.fn(async () => true),
};

mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/notification-store.js', { namedExports: notificationStoreMocks });

let timerHandler;
mock.module('@azure/functions', {
  namedExports: {
    app: {
      timer: (name, options) => {
        if (name === 'post-class-summary-dispatcher') timerHandler = options.handler;
      },
    },
  },
});

const dispatcher = await import('./post-class-summary-dispatcher.js');

test('post-class-summary-dispatcher should upsert summary notification for past class', async () => {
  const now = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') {
      return [{ id: 'arq-software-2026', name: 'Arquitectura de Software' }];
    }

    if (container === 'classes-config' && blobName === 'arq-software-2026.json') {
      return [{
        id: 'class-03',
        title: 'Clase 3 — Arquitectura Hexagonal',
        date: now,
        summaryReady: true,
        studentIds: ['alu-001'],
      }];
    }

    if (container === 'class-summaries') return null;

    return null;
  });

  const result = await dispatcher.runPostClassSummaryDispatcher({ log: () => {}, error: () => {} });
  assert.ok(result.dispatched >= 1);
  assert.ok(notificationStoreMocks.upsertNotificationForSubject.mock.callCount() >= 1);
});

test('post-class-summary-dispatcher should skip future classes and avoid upsert', async () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') {
      return [{ id: 'arq-software-2026', name: 'Arquitectura de Software' }];
    }

    if (container === 'classes-config' && blobName === 'arq-software-2026.json') {
      return [{
        id: 'class-04',
        title: 'Clase 4 — CQRS',
        date: future,
        summaryReady: true,
        studentIds: ['alu-001'],
      }];
    }

    return null;
  });

  const before = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();
  const result = await dispatcher.runPostClassSummaryDispatcher({ log: () => {}, error: () => {} });
  const after = notificationStoreMocks.upsertNotificationForSubject.mock.callCount();

  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(after, before);
});

test('timer handler should execute dispatcher without throwing', async () => {
  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') return [];
    return null;
  });

  await timerHandler({}, { log: () => {}, error: () => {} });
  assert.ok(true);
});
