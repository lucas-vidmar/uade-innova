import { test, mock } from 'node:test';
import assert from 'node:assert';

const tableData = {
  materials: [],
  classes: [],
};

function createTableClient(tableName) {
  const data = tableData[tableName] || (tableData[tableName] = []);
  return {
    createTable: async () => true,
    upsertEntity: async (entity, mode = 'Merge') => {
      const idx = data.findIndex((row) => row.partitionKey === entity.partitionKey && row.rowKey === entity.rowKey);
      if (idx === -1) {
        data.push({ ...entity });
        return;
      }

      if (mode === 'Replace') {
        data[idx] = { ...entity };
      } else {
        data[idx] = { ...data[idx], ...entity };
      }
    },
    deleteEntity: async (partitionKey, rowKey) => {
      const idx = data.findIndex((row) => row.partitionKey === partitionKey && row.rowKey === rowKey);
      if (idx !== -1) data.splice(idx, 1);
    },
    getEntity: async (partitionKey, rowKey) => {
      const row = data.find((r) => r.partitionKey === partitionKey && r.rowKey === rowKey);
      if (!row) {
        const err = new Error('Not Found');
        err.statusCode = 404;
        throw err;
      }
      return row;
    },
    listEntities: ({ queryOptions } = {}) => {
      const filter = queryOptions?.filter;
      let result = [...data];

      if (filter?.startsWith('PartitionKey eq')) {
        const match = filter.match(/PartitionKey eq '(.+)'/);
        if (match) {
          const target = match[1].replace(/''/g, "'");
          result = result.filter((row) => row.partitionKey === target);
        }
      } else if (filter?.startsWith('RowKey eq')) {
        const match = filter.match(/RowKey eq '(.+)'/);
        if (match) {
          const target = match[1].replace(/''/g, "'");
          result = result.filter((row) => row.rowKey === target);
        }
      }

      return {
        async *[Symbol.asyncIterator]() {
          for (const row of result) yield row;
        },
      };
    },
  };
}

mock.module('./storage.js', {
  namedExports: {
    getTableClient: (tableName) => createTableClient(tableName),
  },
});

const {
  upsertMaterialState,
  listMaterialsBySubject,
  listMaterialsByClass,
  replaceClassesForSubject,
  listClassesBySubject,
  deleteMaterialStateById,
  upsertQuizResult,
  getQuizResult,
  listQuizResultsBySubject,
  listAllMaterials,
  listAllClasses,
  listAllEnrollments,
  listAllConversations,
  listAllUserProfiles,
  deleteUserProfile,
  saveConversation,
  upsertEnrollment,
  getEnrollment,
} = await import('./state-store.js');

test('state-store writes and queries material entities', async () => {
  tableData.materials = [];

  await upsertMaterialState({
    subjectId: 'sub-1',
    materialId: 'mat-1',
    classIds: ['class-a', 'class-b'],
    type: 'notes',
    filename: 'notes.pdf',
    status: 'processing',
    blobUrl: 'https://example/blob',
    uploadedAt: '2026-03-01T10:00:00.000Z',
  }, 'Replace');

  const bySubject = await listMaterialsBySubject('sub-1');
  assert.strictEqual(bySubject.length, 1);
  assert.deepStrictEqual(bySubject[0].classIds, ['class-a', 'class-b']);

  const byClass = await listMaterialsByClass('sub-1', 'class-a');
  assert.strictEqual(byClass.length, 1);
  assert.strictEqual(byClass[0].materialId, 'mat-1');
});

test('state-store replaces class set by subject', async () => {
  tableData.classes = [];

  await replaceClassesForSubject('sub-2', [
    { id: 'class-1', title: 'Clase 1', date: '2026-03-10', topics: ['A'] },
    { id: 'class-2', title: 'Clase 2', date: '2026-03-17', topics: ['B'] },
  ]);

  await replaceClassesForSubject('sub-2', [
    { id: 'class-1', title: 'Clase 1 editada', date: '2026-03-10', topics: ['A1'] },
  ]);

  const classes = await listClassesBySubject('sub-2');
  assert.strictEqual(classes.length, 1);
  assert.strictEqual(classes[0].id, 'class-1');
  assert.strictEqual(classes[0].title, 'Clase 1 editada');
  assert.deepStrictEqual(classes[0].topics, ['A1']);
});

test('state-store deletes material by row key lookup', async () => {
  tableData.materials = [
    { partitionKey: 'sub-1', rowKey: 'mat-z', classIds: '[]' },
  ];

  const deleted = await deleteMaterialStateById('mat-z');
  assert.strictEqual(deleted, true);
  assert.strictEqual(tableData.materials.length, 0);
});

test('state-store upserts and reads quiz results per student per class', async () => {
  tableData.QuizResults = [];

  await upsertQuizResult({
    subjectId: 'sub-1',
    userId: 'alu-001',
    classId: 'class-a',
    quizId: 'quiz-1',
    score: 80,
    totalQuestions: 5,
    correctCount: 4,
    passed: true,
    weakTopics: ['Arquitectura'],
    answers: [{ questionId: 'q1', isCorrect: false }],
    attemptCount: 1,
  });

  const result = await getQuizResult('sub-1', 'alu-001', 'class-a');
  assert.strictEqual(result.userId, 'alu-001');
  assert.strictEqual(result.classId, 'class-a');
  assert.strictEqual(result.score, 80);
  assert.strictEqual(result.passed, true);
  assert.deepStrictEqual(result.weakTopics, ['Arquitectura']);
  assert.deepStrictEqual(result.answers, [{ questionId: 'q1', isCorrect: false }]);

  // Upsert replaces (latest attempt wins)
  await upsertQuizResult({
    subjectId: 'sub-1',
    userId: 'alu-001',
    classId: 'class-a',
    score: 40,
    totalQuestions: 5,
    correctCount: 2,
    passed: false,
    weakTopics: ['Hexagonal', 'CQRS'],
    answers: [],
    attemptCount: 2,
  });

  const latest = await getQuizResult('sub-1', 'alu-001', 'class-a');
  assert.strictEqual(latest.score, 40);
  assert.strictEqual(latest.attemptCount, 2);
  assert.deepStrictEqual(latest.weakTopics, ['Hexagonal', 'CQRS']);

  const bySubject = await listQuizResultsBySubject('sub-1');
  assert.strictEqual(bySubject.length, 1);
});

test('state-store lists all materials and classes across subjects', async () => {
  tableData.materials = [];
  tableData.classes = [];

  await upsertMaterialState({ subjectId: 'sub-a', materialId: 'ma-1', classIds: ['c1'], filename: 'a.txt' }, 'Replace');
  await upsertMaterialState({ subjectId: 'sub-b', materialId: 'mb-1', classIds: ['c1'], filename: 'b.txt' }, 'Replace');
  assert.strictEqual((await listAllMaterials()).length, 2);

  await replaceClassesForSubject('sub-a', [{ id: 'class-a', title: 'A', date: '2026-03-01' }]);
  await replaceClassesForSubject('sub-b', [{ id: 'class-b', title: 'B', date: '2026-03-02' }]);
  assert.strictEqual((await listAllClasses()).length, 2);
});

test('state-store lists all conversations and enrollments across partitions', async () => {
  tableData.Conversations = [];
  tableData.Enrollments = [];

  await saveConversation({
    userId: 'u1', conversationId: 'c1', subjectId: 's1',
    messages: [{ role: 'user', content: '¿Qué es la arquitectura hexagonal?' }],
  });
  await saveConversation({
    userId: 'u2', conversationId: 'c2', subjectId: 's2',
    messages: [{ role: 'user', content: '¿Qué es un sistema?' }],
  });
  const conversations = await listAllConversations();
  assert.strictEqual(conversations.length, 2);
  assert.ok(conversations.some((c) => c.conversationId === 'c1'));
  assert.ok(conversations.some((c) => c.conversationId === 'c2'));

  await upsertEnrollment({ subjectId: 's1', userId: 'u1', role: 'student' });
  await upsertEnrollment({ subjectId: 's2', userId: 'u2', role: 'student' });
  assert.strictEqual((await listAllEnrollments()).length, 2);
  assert.ok((await getEnrollment('s1', 'u1')).role === 'student');
});

test('state-store lists and deletes user profiles by rowKey', async () => {
  tableData.UserProfiles = [];

  const client = createTableClient('UserProfiles');
  await client.upsertEntity({ partitionKey: 'Profiles', rowKey: 'alu-001', name: 'Lucas' }, 'Replace');
  await client.upsertEntity({ partitionKey: 'student', rowKey: 'test-alu-001', displayName: 'Ana' }, 'Replace');

  const all = await listAllUserProfiles();
  assert.strictEqual(all.length, 2);

  const deleted = await deleteUserProfile('test-alu-001');
  assert.strictEqual(deleted, true);
  assert.strictEqual((await listAllUserProfiles()).length, 1);
  assert.strictEqual((await listAllUserProfiles())[0].rowKey, 'alu-001');

  assert.strictEqual(await deleteUserProfile('no-existe'), false);
});
