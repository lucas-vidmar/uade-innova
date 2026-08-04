import { test, mock } from 'node:test';
import assert from 'node:assert';

const storageMocks = {
  loadJson: mock.fn(async () => null),
  listBlobs: mock.fn(async () => []),
};

const notificationStoreMocks = {
  dispatchClassSummaryNotification: mock.fn(async () => ({ success: true, retryAttempts: 0, deadLetterWrites: 0, dispatched: 1 })),
};

const telemetryMock = {
  trackDispatcherRun: mock.fn(async () => {}),
};

mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/notification-store.js', { namedExports: notificationStoreMocks });
mock.module('../services/telemetry.js', { namedExports: telemetryMock });

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

  const telemetryBefore = telemetryMock.trackDispatcherRun.mock.callCount();
  const result = await dispatcher.runPostClassSummaryDispatcher({ log: () => {}, error: () => {} });
  assert.ok(result.dispatched >= 1);
  assert.ok(notificationStoreMocks.dispatchClassSummaryNotification.mock.callCount() >= 1);
  assert.strictEqual(telemetryMock.trackDispatcherRun.mock.callCount(), telemetryBefore + 1);
  const telemetryCall = telemetryMock.trackDispatcherRun.mock.calls.at(-1).arguments[0];
  assert.strictEqual(telemetryCall.dispatcherName, 'post-class-summary');
  assert.strictEqual(telemetryCall.subjectCount, 1);
  assert.strictEqual(telemetryCall.dispatched, 1);
  assert.strictEqual(telemetryCall.skipped, 0);
  assert.strictEqual(telemetryCall.errors, 0);
  assert.strictEqual(telemetryCall.errorDetails, undefined);
  assert.ok(telemetryCall.durationMs >= 0);
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

  const upsertBefore = notificationStoreMocks.dispatchClassSummaryNotification.mock.callCount();
  const telemetryBefore = telemetryMock.trackDispatcherRun.mock.callCount();
  const result = await dispatcher.runPostClassSummaryDispatcher({ log: () => {}, error: () => {} });
  const upsertAfter = notificationStoreMocks.dispatchClassSummaryNotification.mock.callCount();

  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(upsertAfter, upsertBefore);
  assert.strictEqual(telemetryMock.trackDispatcherRun.mock.callCount(), telemetryBefore + 1);
  const telemetryCall = telemetryMock.trackDispatcherRun.mock.calls.at(-1).arguments[0];
  assert.strictEqual(telemetryCall.dispatched, 0);
  assert.strictEqual(telemetryCall.skipped, 1);
  assert.strictEqual(telemetryCall.errors, 0);
});

test('post-class-summary-dispatcher should report errors in telemetry when upsert fails', async () => {
  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') {
      return [{ id: 'arq-software-2026', name: 'Arquitectura de Software' }];
    }
    if (container === 'classes-config' && blobName === 'arq-software-2026.json') {
      return [{ id: 'class-03', title: 'Clase 3', date: new Date(Date.now() - 86400000).toISOString(), summaryReady: true }];
    }
    return null;
  });

  notificationStoreMocks.dispatchClassSummaryNotification.mock.mockImplementation(async () => {
    throw new Error('storage unavailable');
  });

  const telemetryBefore = telemetryMock.trackDispatcherRun.mock.callCount();
  const result = await dispatcher.runPostClassSummaryDispatcher({ log: () => {}, error: () => {} });
  assert.strictEqual(telemetryMock.trackDispatcherRun.mock.callCount(), telemetryBefore + 1);
  const telemetryCall = telemetryMock.trackDispatcherRun.mock.calls.at(-1).arguments[0];
  assert.strictEqual(telemetryCall.dispatched, 0);
  assert.strictEqual(telemetryCall.errors, 1);
  assert.strictEqual(telemetryCall.skipped, 0);
  assert.ok(telemetryCall.errorDetails.includes('subject=arq-software-2026 class=class-03'));
});

test('timer handler should execute dispatcher without throwing', async () => {
  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') return [];
    return null;
  });

  await timerHandler({}, { log: () => {}, error: () => {} });
  assert.ok(true);
});
