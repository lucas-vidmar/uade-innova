import { test, mock } from 'node:test';
import assert from 'node:assert';

// ── Mocks ────────────────────────────────────────────────

const mockStateStore = {
  getEnrollment: mock.fn(async () => ({ status: 'active', role: 'teacher' })),
  getCorrection: mock.fn(async () => null),
  listCorrections: mock.fn(async () => []),
  listPendingCorrections: mock.fn(async () => [
    {
      correctionId: 'corr-1',
      subjectId: 'arq-software-2026',
      studentId: 'alu-001',
      question: '¿Qué es CQRS?',
      originalAnswer: 'Una respuesta.',
      issueDetail: 'Incorrecta',
      classId: 'class-01',
      status: 'pending',
      createdAt: '2026-04-10T10:00:00.000Z',
    },
  ]),
};

const mockAuthUtils = {
  validateFrontDoorId: mock.fn(() => true),
  parseClientPrincipal: mock.fn(() => ({
    userId: 'teacher-1',
    userRoles: ['Docente'],
    oid: 'teacher-1',
  })),
  setStashedIdentity: mock.fn(() => {}),
};

mock.module('../../../services/state-store.js', {
  namedExports: mockStateStore,
});
mock.module('../../../services/auth-utils.js', {
  namedExports: mockAuthUtils,
});

// ── Capture handler via mocked @azure/functions ────────────

let capturedHandler;
mock.module('@azure/functions', {
  namedExports: {
    app: {
      http: (name, options) => {
        capturedHandler = options.handler;
      },
    },
  },
});

// ── Load function after mocks ──────────────────────────────

await import('./index.js');

test('get-pending-reports should require teacher or director role', async () => {
  mockAuthUtils.parseClientPrincipal.mock.mockImplementation(() => ({
    userId: 'student-1',
    userRoles: ['Alumno'],
    oid: 'student-1',
  }));

  const response = await capturedHandler(
    { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
    { invocationId: 'test-1' }
  );

  assert.strictEqual(response.status, 403);
  const body = JSON.parse(response.body);
  assert.strictEqual(body.success, false);

  // Restore teacher principal for subsequent tests
  mockAuthUtils.parseClientPrincipal.mock.mockImplementation(() => ({
    userId: 'teacher-1',
    userRoles: ['Docente'],
    oid: 'teacher-1',
  }));
});

test('get-pending-reports should anonymize numeric student IDs correctly', async () => {
  mockStateStore.listPendingCorrections.mock.mockImplementation(async () => [
    {
      correctionId: 'corr-2',
      subjectId: 'arq-software-2026',
      studentId: '12345678',
      question: '¿Qué es hexagonal?',
      originalAnswer: 'Una respuesta.',
      issueDetail: 'Incomplete',
      classId: 'class-02',
      status: 'pending',
      createdAt: '2026-04-10T11:00:00.000Z',
    },
  ]);

  const response = await capturedHandler(
    { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
    { invocationId: 'test-2' }
  );

  assert.strictEqual(response.status, 200);
  const body = JSON.parse(response.body);
  assert.strictEqual(body.success, true);
  assert.ok(body.data.length > 0);
  // Numeric ID with > 4 digits should be masked as first***last
  assert.match(body.data[0].studentId, /^\d\*\*\*\d$/);
});

test('get-pending-reports groups coincident reports first and counts them (UJ-40)', async () => {
  mockStateStore.listPendingCorrections.mock.mockImplementation(async () => [
    { correctionId: 'c-solo', subjectId: 'arq-software-2026', studentId: 'alu-003', question: 'Q solo', originalAnswer: 'respuesta distinta', issueDetail: 'x', classId: 'class-02', status: 'pending', createdAt: '2026-04-10T12:00:00.000Z', groupKey: 'k-solo' },
    { correctionId: 'c-a', subjectId: 'arq-software-2026', studentId: 'alu-001', question: 'Q compartida', originalAnswer: 'misma respuesta', issueDetail: 'x', classId: 'class-04', status: 'pending', createdAt: '2026-04-10T11:00:00.000Z', groupKey: 'k-shared' },
    { correctionId: 'c-b', subjectId: 'arq-software-2026', studentId: 'alu-005', question: 'Q compartida', originalAnswer: 'misma respuesta', issueDetail: 'x', classId: 'class-04', status: 'pending', createdAt: '2026-04-10T13:00:00.000Z', groupKey: 'k-shared' },
  ]);

  const response = await capturedHandler(
    { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
    { invocationId: 'test-uj40' }
  );

  assert.strictEqual(response.status, 200);
  const body = JSON.parse(response.body);
  assert.strictEqual(body.data.length, 3);
  // The two coincident reports come first, ordered oldest-first within the group.
  assert.strictEqual(body.data[0].correctionId, 'c-a');
  assert.strictEqual(body.data[0].coincidences, 2);
  assert.strictEqual(body.data[1].correctionId, 'c-b');
  assert.strictEqual(body.data[1].coincidences, 2);
  assert.strictEqual(body.data[2].correctionId, 'c-solo');
  assert.strictEqual(body.data[2].coincidences, 1);
});

test('get-pending-reports fallback groups by the question, not by a shared answer (UJ-40)', async () => {
  // Reports stored before the key was persisted have no groupKey. The common
  // point of two marks is the material point that was asked about, so the
  // fallback must not fuse two different questions that only happen to share a
  // boilerplate/abstention answer into one inflated group.
  mockStateStore.listPendingCorrections.mock.mockImplementation(async () => [
    { correctionId: 'f-a', subjectId: 'arq-software-2026', studentId: 'alu-004', question: '¿Qué diferencia hay entre SAGA y CQRS?', originalAnswer: 'No encontre informacion sobre eso en los materiales seleccionados.', issueDetail: 'x', classId: 'class-04', status: 'pending', createdAt: '2026-10-17T19:14:47.496Z' },
    { correctionId: 'f-b', subjectId: 'arq-software-2026', studentId: 'alu-005', question: '¿Qué dice el material sobre la norma ISO 99999?', originalAnswer: 'No encontre informacion sobre eso en los materiales seleccionados.', issueDetail: 'y', classId: 'class-04', status: 'pending', createdAt: '2026-10-17T17:43:08.995Z' },
    { correctionId: 'f-c', subjectId: 'arq-software-2026', studentId: 'alu-001', question: '¿Qué diferencia hay entre SAGA y CQRS?', originalAnswer: 'Una redaccion distinta.', issueDetail: 'z', classId: 'class-04', status: 'pending', createdAt: '2026-10-17T19:15:04.091Z' },
  ]);

  const response = await capturedHandler(
    { query: new URLSearchParams({ subjectId: 'arq-software-2026' }) },
    { invocationId: 'test-uj40-fallback' }
  );

  assert.strictEqual(response.status, 200);
  const body = JSON.parse(response.body);
  const byId = Object.fromEntries(body.data.map((c) => [c.correctionId, c]));
  // Same question (even with different answer wording) converges, oldest first.
  assert.strictEqual(byId['f-a'].coincidences, 2);
  assert.strictEqual(byId['f-c'].coincidences, 2);
  assert.strictEqual(body.data[0].correctionId, 'f-a');
  // A different question that only shares the boilerplate answer stays alone.
  assert.strictEqual(byId['f-b'].coincidences, 1);
});

test('get-pending-reports puts a negative rating and a report of the same answer in one group (#514)', async () => {
  mockStateStore.listCorrections.mock.mockImplementation(async () => [
    {
      correctionId: 'val-1', subjectId: 'arq-software-2026', studentId: 'alu-004',
      question: '¿Qué es la arquitectura hexagonal?', originalAnswer: 'Hexagonal separa dominio de infraestructura.',
      issueDetail: 'Esperaba puertos y adaptadores.', classId: 'class-04', status: 'pending',
      createdAt: '2026-10-19T12:00:00.000Z', messageId: 'm-1', type: 'negative-rating', groupKey: 'class-04|mat-9#3',
    },
    {
      correctionId: 'rep-1', subjectId: 'arq-software-2026', studentId: 'alu-005',
      question: '¿Qué es la arquitectura hexagonal?', originalAnswer: 'Hexagonal separa dominio de infraestructura.',
      issueDetail: 'No menciona puertos.', classId: 'class-04', status: 'pending',
      createdAt: '2026-10-19T13:00:00.000Z', messageId: 'm-2', type: 'ai-feedback-issue', groupKey: 'class-04|mat-9#3',
    },
    {
      correctionId: 'rep-2', subjectId: 'arq-software-2026', studentId: 'alu-003',
      question: '¿Qué es DDD?', originalAnswer: 'Otra respuesta.', issueDetail: 'x', classId: 'class-04', status: 'pending',
      createdAt: '2026-10-19T14:00:00.000Z', messageId: 'm-3', type: 'ai-feedback-issue', groupKey: 'class-04|mat-7#1',
    },
  ]);

  const response = await capturedHandler(
    { query: new URLSearchParams({ subjectId: 'arq-software-2026', status: 'all' }) },
    { invocationId: 'test-514' }
  );

  assert.strictEqual(response.status, 200);
  const body = JSON.parse(response.body);
  const byId = Object.fromEntries(body.data.map((c) => [c.correctionId, c]));
  // La marca y el reporte del mismo punto pesan juntos...
  assert.strictEqual(byId['val-1'].coincidences, 2);
  assert.strictEqual(byId['rep-1'].coincidences, 2);
  assert.strictEqual(byId['rep-2'].coincidences, 1);
  // ...y el grupo con más peso va primero, con la marca más vieja en cabeza.
  assert.strictEqual(body.data[0].correctionId, 'val-1');
  // La bandeja puede distinguir el origen de cada señal.
  assert.strictEqual(byId['val-1'].type, 'negative-rating');
  assert.strictEqual(byId['rep-1'].type, 'ai-feedback-issue');
});

test('get-pending-reports should honor correctionId for non-pending states (#350)', async () => {
  mockStateStore.getCorrection.mock.mockImplementation(async (subjectId, correctionId) => {
    if (correctionId === 'verified-1') {
      return {
        correctionId: 'verified-1',
        subjectId: 'arq-software-2026',
        studentId: 'alu-001',
        question: '¿Qué es CQRS?',
        originalAnswer: 'Una respuesta.',
        correctedAnswer: 'Una corrección.',
        issueDetail: 'Incorrecta',
        classId: 'class-01',
        status: 'verified',
        createdAt: '2026-04-10T10:00:00.000Z',
      };
    }
    return null;
  });

  const response = await capturedHandler(
    { query: new URLSearchParams({ subjectId: 'arq-software-2026', correctionId: 'verified-1' }) },
    { invocationId: 'test-350' }
  );

  assert.strictEqual(response.status, 200);
  const body = JSON.parse(response.body);
  assert.strictEqual(body.success, true);
  assert.strictEqual(body.data.length, 1);
  assert.strictEqual(body.data[0].correctionId, 'verified-1');
  assert.strictEqual(body.data[0].status, 'verified');

  const missing = await capturedHandler(
    { query: new URLSearchParams({ subjectId: 'arq-software-2026', correctionId: 'does-not-exist' }) },
    { invocationId: 'test-350-missing' }
  );
  assert.strictEqual(missing.status, 200);
  assert.deepStrictEqual(JSON.parse(missing.body).data, []);
});
