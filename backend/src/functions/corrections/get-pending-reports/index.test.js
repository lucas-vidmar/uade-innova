import { test, mock } from 'node:test';
import assert from 'node:assert';

// ── Mocks ────────────────────────────────────────────────

const mockStateStore = {
  getEnrollment: mock.fn(async () => ({ status: 'active', role: 'teacher' })),
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
