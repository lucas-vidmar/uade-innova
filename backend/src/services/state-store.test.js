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
