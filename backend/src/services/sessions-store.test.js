import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

/**
 * sessions-store.test.js — opaque session tokens + expiry (Story 1.1a).
 */

const tableData = { Sessions: [] };

function createTableClient(tableName) {
  const data = tableData[tableName] || (tableData[tableName] = []);
  return {
    createTable: async () => true,
    upsertEntity: async (entity) => {
      const idx = data.findIndex((row) => row.partitionKey === entity.partitionKey && row.rowKey === entity.rowKey);
      if (idx === -1) data.push({ ...entity });
      else data[idx] = { ...entity };
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
      const partition = filter?.match(/PartitionKey eq '([^']+)'/);
      if (partition) result = result.filter((row) => row.partitionKey === partition[1].replace(/''/g, "'"));
      const rowkey = filter?.match(/RowKey eq '([^']+)'/);
      if (rowkey) result = result.filter((row) => row.rowKey === rowkey[1].replace(/''/g, "'"));
      const user = filter?.match(/userId eq '([^']+)'/);
      if (user) result = result.filter((row) => row.userId === user[1].replace(/''/g, "'"));
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
  createSession,
  getSession,
  deleteSession,
  deleteSessionsForUser,
  generateSessionToken,
} = await import('./sessions-store.js');

test('CREATE_GET — opaque token round-trip', async () => {
  tableData.Sessions = [];
  const session = await createSession('alu-001');
  assert.equal(session.userId, 'alu-001');
  assert.equal(session.token.length, 64);
  const resolved = await getSession(session.token);
  assert.equal(resolved.userId, 'alu-001');
  assert.equal(resolved.token, session.token);
});

test('TOKEN_UNIQUENESS — tokens are random', async () => {
  const t1 = generateSessionToken();
  const t2 = generateSessionToken();
  assert.notEqual(t1, t2);
  assert.equal(t1.length, 64);
});

test('EXPIRED — expired session resolves null (fail closed)', async () => {
  tableData.Sessions = [];
  const session = await createSession('alu-001', { ttlMs: -1000 });
  assert.equal(await getSession(session.token), null);
});

test('UNKNOWN_TOKEN — unknown token resolves null', async () => {
  tableData.Sessions = [];
  assert.equal(await getSession('does-not-exist'), null);
  assert.equal(await getSession(''), null);
});

test('DELETE — logout deletes the session', async () => {
  tableData.Sessions = [];
  const session = await createSession('alu-001');
  assert.equal(await deleteSession(session.token), true);
  assert.equal(await getSession(session.token), null);
});

test('DELETE_SESSIONS_FOR_USER — revokes other sessions, keeps exceptToken', async () => {
  tableData.Sessions = [];
  const keep = await createSession('alu-001');
  const other1 = await createSession('alu-001');
  await createSession('alu-002');

  const deleted = await deleteSessionsForUser('alu-001', keep.token);
  assert.equal(deleted, 1);
  assert.ok(await getSession(keep.token));
  assert.equal(await getSession(other1.token), null);
});
