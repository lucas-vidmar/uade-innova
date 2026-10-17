import { test, mock } from 'node:test';
import assert from 'node:assert';

// In-memory stand-in for Azure Table Storage so the corrections entity
// round-trip can be exercised without a live account.
const tables = new Map();
const rowKey = (pk, rk) => `${pk}\u0000${rk}`;

function fakeClient(tableName) {
  if (!tables.has(tableName)) tables.set(tableName, new Map());
  const store = tables.get(tableName);
  return {
    createTable: mock.fn(async () => {}),
    upsertEntity: mock.fn(async (entity) => {
      store.set(rowKey(entity.partitionKey, entity.rowKey), JSON.parse(JSON.stringify(entity)));
    }),
    getEntity: mock.fn(async (pk, rk) => {
      const found = store.get(rowKey(pk, rk));
      if (!found) {
        const err = new Error('not found');
        err.statusCode = 404;
        throw err;
      }
      return JSON.parse(JSON.stringify(found));
    }),
    deleteEntity: mock.fn(async (pk, rk) => { store.delete(rowKey(pk, rk)); }),
    listEntities: async function* () {
      for (const entity of store.values()) yield JSON.parse(JSON.stringify(entity));
    },
  };
}

mock.module('./storage.js', {
  namedExports: {
    getTableClient: mock.fn((tableName) => fakeClient(tableName)),
    saveJson: mock.fn(async () => true),
    loadJson: mock.fn(async () => null),
    listBlobs: mock.fn(async () => []),
    deleteBlob: mock.fn(async () => true),
  },
});

const { upsertCorrection, getCorrection, listCorrections } = await import('./state-store.js');

test('upsertCorrection keeps the convergence groupKey on the stored entity (UJ-40)', async () => {
  const saved = await upsertCorrection({
    correctionId: 'c-group',
    subjectId: 'arq-software-2026',
    studentId: 'alu-004',
    question: '¿Qué diferencia hay entre SAGA y CQRS?',
    originalAnswer: 'No encontre informacion sobre eso en los materiales seleccionados.',
    issueDetail: 'confunde SAGA con CQRS',
    messageId: 'm-1',
    type: 'ai-feedback-issue',
    status: 'pending',
    createdAt: '2026-10-17T19:14:47.496Z',
    groupKey: 'class-04|mat-9#3',
  });

  // The entity that actually reaches the table (and therefore the bandeja)
  // must carry the key; before the fix it was silently dropped here and
  // get-pending-reports could only rebuild a heuristic one.
  assert.strictEqual(saved.groupKey, 'class-04|mat-9#3');

  const read = await getCorrection('arq-software-2026', 'c-group');
  assert.strictEqual(read.groupKey, 'class-04|mat-9#3');

  const listed = await listCorrections('arq-software-2026');
  assert.strictEqual(listed[0].groupKey, 'class-04|mat-9#3');
});

test('a correction stored without a groupKey still reads back without one (UJ-40 fallback path)', async () => {
  await upsertCorrection({
    correctionId: 'c-legacy',
    subjectId: 'arq-software-2026',
    studentId: 'alu-003',
    question: '¿Qué es la arquitectura de software?',
    originalAnswer: 'Respuesta vieja.',
    issueDetail: 'x',
    status: 'pending',
    createdAt: '2026-09-18T04:33:51.761Z',
  });

  const read = await getCorrection('arq-software-2026', 'c-legacy');
  assert.strictEqual(read.groupKey, '');
});
