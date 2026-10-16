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
let httpHandler;
mock.module('@azure/functions', {
  namedExports: {
    app: {
      timer: (name, options) => {
        if (name === 'post-class-summary-dispatcher') timerHandler = options.handler;
      },
      http: (name, options) => {
        if (name === 'publish-class-summary-now') httpHandler = options.handler;
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

    if (container === 'class-summaries' && blobName === 'arq-software-2026/class-03.json') {
      return { classId: 'class-03', subjectId: 'arq-software-2026', summary: 'resumen', validated: true };
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
    if (container === 'class-summaries' && blobName === 'arq-software-2026/class-03.json') {
      return { classId: 'class-03', subjectId: 'arq-software-2026', summary: 'resumen', validated: true };
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

test('publish-class-summary-now should dispatch notification for validated past class (11-4-10)', async () => {
  const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
  notificationStoreMocks.dispatchClassSummaryNotification.mock.mockImplementation(async () => ({ success: true, retryAttempts: 0, deadLetterWrites: 0, dispatched: 1, recipientCount: 1 }));

  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subject-pub.json') {
      return [{ id: 'class-pub', title: 'Clase publicable', date: new Date(Date.now() - 86400000).toISOString(), summaryReady: true }];
    }
    if (container === 'class-summaries' && blobName === 'class-pub.json') {
      return { classId: 'class-pub', summary: 'resumen', validated: true };
    }
    return null;
  });

  const req = {
    params: { classId: 'class-pub' },
    query: { get: (k) => (k === 'subjectId' ? 'subject-pub' : null) },
  };
  const res = await httpHandler(req, { log: () => {}, error: () => {} });
  const body = JSON.parse(res.body);
  if (prevEnv === undefined) delete process.env.AZURE_FUNCTIONS_ENVIRONMENT;
  else process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.dispatched, 1);
});

test('publish-class-summary-now should reject unvalidated class', async () => {
  const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';

  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subject-novalid.json') {
      return [{ id: 'class-novalid', title: 'Clase sin validar', date: new Date(Date.now() - 86400000).toISOString(), summaryReady: false }];
    }
    if (container === 'class-summaries' && blobName === 'class-novalid.json') {
      return { classId: 'class-novalid', summary: 'borrador', validated: false };
    }
    return null;
  });

  const req = {
    params: { classId: 'class-novalid' },
    query: { get: (k) => (k === 'subjectId' ? 'subject-novalid' : null) },
  };
  const res = await httpHandler(req, { log: () => {}, error: () => {} });
  if (prevEnv === undefined) delete process.env.AZURE_FUNCTIONS_ENVIRONMENT;
  else process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
  assert.strictEqual(res.status, 409);
});

// #368: la bandera `summaryReady` del listado de clases no es prueba de que el
// derivado exista en el alcance que lee la alumna. Sin derivado no hay aviso.
test('post-class-summary-dispatcher should not announce a summary that is missing in the student scope (#368)', async () => {
  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') {
      return [{ id: 'arq-software-2026', name: 'Arquitectura de Software' }];
    }
    if (container === 'classes-config' && blobName === 'arq-software-2026.json') {
      return [{ id: 'class-02', title: 'Clase 2', date: new Date(Date.now() - 86400000).toISOString(), summaryReady: true }];
    }
    return null;
  });

  const upsertBefore = notificationStoreMocks.dispatchClassSummaryNotification.mock.callCount();
  const result = await dispatcher.runPostClassSummaryDispatcher({ log: () => {}, error: () => {} });

  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(result.skipped, 1);
  assert.strictEqual(notificationStoreMocks.dispatchClassSummaryNotification.mock.callCount(), upsertBefore);
});

// #368 + #328: un blob heredado de otra materia no puede habilitar la publicación.
test('post-class-summary-dispatcher should ignore a legacy summary owned by another subject (#368)', async () => {
  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subjects.json') {
      return [{ id: 'arq-software-2026', name: 'Arquitectura de Software' }];
    }
    if (container === 'classes-config' && blobName === 'arq-software-2026.json') {
      return [{ id: 'class-01', title: 'Clase 1', date: new Date(Date.now() - 86400000).toISOString(), summaryReady: true }];
    }
    if (container === 'class-summaries' && blobName === 'class-01.json') {
      return { classId: 'class-01', subjectId: 'otra-materia', summary: 'ajeno', validated: true };
    }
    return null;
  });

  const upsertBefore = notificationStoreMocks.dispatchClassSummaryNotification.mock.callCount();
  const result = await dispatcher.runPostClassSummaryDispatcher({ log: () => {}, error: () => {} });

  assert.strictEqual(result.dispatched, 0);
  assert.strictEqual(notificationStoreMocks.dispatchClassSummaryNotification.mock.callCount(), upsertBefore);
});

test('publish-class-summary-now should reject a class whose summary is missing in the student scope (#368)', async () => {
  const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
  process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';

  storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
    if (container === 'classes-config' && blobName === 'subject-pub2.json') {
      return [{ id: 'class-pub2', title: 'Clase publicable sin resumen', date: new Date(Date.now() - 86400000).toISOString(), summaryReady: true }];
    }
    return null;
  });

  const req = {
    params: { classId: 'class-pub2' },
    query: { get: (k) => (k === 'subjectId' ? 'subject-pub2' : null) },
  };
  const res = await httpHandler(req, { log: () => {}, error: () => {} });
  if (prevEnv === undefined) delete process.env.AZURE_FUNCTIONS_ENVIRONMENT;
  else process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;

  assert.strictEqual(res.status, 409);
  assert.ok(JSON.parse(res.body).error.includes('no tiene un resumen validado'));
});
