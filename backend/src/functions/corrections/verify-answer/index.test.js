import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mock } from 'node:test';

// ── Story 10.17 / Task 4.7 (Loopback 2/3) ────────────────────────────────────
// verify-answer debe escribir `quarantined: false` en el vector de verified-answer.
// Se preservan las ramas de error (role-rejection / 404 / status-validation) junto
// a la nueva aserción de payload (Loopback 3: no reemplazar por un solo happy-path).

const mockStateStore = {
  getEnrollment: mock.fn(),
  getCorrection: mock.fn(),
  upsertCorrection: mock.fn(),
  deletePendingCorrection: mock.fn(),
};

const mockAuthUtils = {
  validateFrontDoorId: mock.fn(() => true),
  parseClientPrincipal: mock.fn(() => ({
    userId: 'teacher-1',
    userRoles: ['Director'],
    oid: 'teacher-1',
  })),
  setStashedIdentity: mock.fn(() => {}),
};

const mockAi = {
  generateEmbedding: mock.fn(() => Promise.resolve({ embedding: Array(1536).fill(0.1), usage: { totalTokens: 10 } })),
};

const mockVectorStore = {
  upsertChunks: mock.fn(() => Promise.resolve()),
};

mock.module('../../../services/state-store.js', {
  namedExports: mockStateStore,
});
mock.module('../../../services/auth-utils.js', {
  namedExports: mockAuthUtils,
});
mock.module('../../../services/ai.js', {
  namedExports: mockAi,
});
mock.module('../../../services/vector-store.js', {
  namedExports: mockVectorStore,
});

const handlers = {};
mock.module('@azure/functions', {
  namedExports: {
    app: {
      http: (name, options) => {
        handlers[name] = options.handler;
      },
    },
  },
});

await import('./index.js');

function mockRequest(body) {
  return {
    json: async () => body,
    headers: { get: () => null },
    method: 'POST',
  };
}

function mockContext() {
  const log = mock.fn();
  log.warn = mock.fn();
  log.error = mock.fn();
  log.info = mock.fn();
  return { log, error: mock.fn() };
}

function pendingCorrection(overrides = {}) {
  return {
    correctionId: 'corr-001',
    subjectId: 'arq-software-2026',
    classId: 'class-01',
    studentId: 'alu-001',
    teacherId: 'teacher-1',
    question: '¿Qué es la arquitectura hexagonal?',
    originalAnswer: 'respuesta original',
    status: 'pending',
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('verify-answer', () => {
  it('should load and register the module without errors', () => {
    assert.strictEqual(typeof handlers['verify-answer'], 'function');
  });

  it('should reject non-teacher roles (role-rejection branch)', async () => {
    mock.reset();
    mockAuthUtils.parseClientPrincipal.mock.mockImplementation(() => ({
      userId: 'student-1',
      userRoles: ['Alumno'],
      oid: 'student-1',
    }));

    const response = await handlers['verify-answer'](
      mockRequest({ correctionId: 'corr-001', subjectId: 'arq-software-2026', correctedAnswer: 'respuesta corregida' }),
      mockContext()
    );
    assert.strictEqual(response.status, 403);
  });

  it('should return 404 for missing corrections', async () => {
    mock.reset();
    mockAuthUtils.parseClientPrincipal.mock.mockImplementation(() => ({
      userId: 'teacher-1',
      userRoles: ['Director'],
      oid: 'teacher-1',
    }));
    mockStateStore.getCorrection.mock.mockImplementation(async () => null);

    const response = await handlers['verify-answer'](
      mockRequest({ correctionId: 'corr-001', subjectId: 'arq-software-2026', correctedAnswer: 'respuesta corregida' }),
      mockContext()
    );
    assert.strictEqual(response.status, 404);
  });

  it('should handle corrections with status other than pending (status-validation branch)', async () => {
    mock.reset();
    mockAuthUtils.parseClientPrincipal.mock.mockImplementation(() => ({
      userId: 'teacher-1',
      userRoles: ['Director'],
      oid: 'teacher-1',
    }));
    mockStateStore.getCorrection.mock.mockImplementation(async () =>
      pendingCorrection({ status: 'verified' })
    );

    const response = await handlers['verify-answer'](
      mockRequest({ correctionId: 'corr-001', subjectId: 'arq-software-2026', correctedAnswer: 'respuesta corregida' }),
      mockContext()
    );
    assert.strictEqual(response.status, 409);
  });

  it('should require correctionId, subjectId, and correctedAnswer', async () => {
    const response = await handlers['verify-answer'](
      mockRequest({ subjectId: 'arq-software-2026' }),
      mockContext()
    );
    assert.strictEqual(response.status, 400);
  });

  it('should upsert the verified-answer vector with quarantined:false (payload assertion)', async () => {
    mock.reset();
    mockAuthUtils.parseClientPrincipal.mock.mockImplementation(() => ({
      userId: 'teacher-1',
      userRoles: ['Director'],
      oid: 'teacher-1',
    }));
    mockStateStore.getCorrection.mock.mockImplementation(async () => pendingCorrection());
    mockStateStore.upsertCorrection.mock.mockImplementation(async () => true);
    mockStateStore.deletePendingCorrection.mock.mockImplementation(async () => true);
    mockAi.generateEmbedding.mock.mockImplementation(async () => ({
      embedding: Array(1536).fill(0.1),
      usage: { totalTokens: 10 },
    }));
    mockVectorStore.upsertChunks.mock.mockImplementation(async () => Promise.resolve());
    mockVectorStore.upsertChunks.mock.resetCalls();

    const response = await handlers['verify-answer'](
      mockRequest({
        correctionId: 'corr-001',
        subjectId: 'arq-software-2026',
        correctedAnswer: 'respuesta corregida',
        explanation: 'explicación',
      }),
      mockContext()
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(mockVectorStore.upsertChunks.mock.callCount(), 1);
    const payload = mockVectorStore.upsertChunks.mock.calls[0].arguments[0];
    assert.strictEqual(payload.length, 1);
    const vector = payload[0];
    assert.strictEqual(vector.metadata.materialType, 'verified-answer');
    assert.strictEqual(vector.metadata.materialId, 'corr-corr-001');
    assert.strictEqual(vector.metadata.quarantined, false, 'verified-answer lleva quarantined:false (always-present field)');
    // #380: la evidencia que ve la persona es legible, no el id interno.
    assert.strictEqual(vector.metadata.title, 'Respuesta verificada por el docente');
    assert.ok(!/^correction-/.test(vector.metadata.title || ''), 'el título no es un identificador interno');
  });
});
