import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

/**
 * users-store.test.js — Users table ops + scrypt hashing + domain rule
 * (Story 1.4 / 1.5).
 */

const tableData = { Users: [] };

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
      if (mode === 'Replace') data[idx] = { ...entity };
      else data[idx] = { ...data[idx], ...entity };
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
  createUser,
  getUserByEmail,
  getUserById,
  listUsers,
  updateUser,
  deleteUser,
  setUserPassword,
  verifyPassword,
  hashPassword,
  generateRandomPassword,
  isUadeEmail,
  normalizeEmail,
  INTERNAL_ROLE_BY_ROLE,
} = await import('./users-store.js');

function seedUser(overrides = {}) {
  return createUser({
    userId: 'alu-001',
    name: 'Alumno',
    surname: 'Uno',
    email: 'alu001@uade.edu.ar',
    role: 'student',
    password: 'password-123',
    ...overrides,
  });
}

test('HAPPY_CREATE — creates user, hashes password, never stores plaintext', async () => {
  tableData.Users = [];
  const created = await seedUser();
  assert.equal(created.userId, 'alu-001');
  assert.equal(created.role, 'student');
  assert.equal(created.status, 'active');
  assert.equal(created.passwordHash, undefined);

  const stored = tableData.Users.find((e) => e.rowKey === 'alu-001');
  assert.ok(stored);
  assert.ok(stored.passwordHash.includes(':'));
  assert.ok(!stored.passwordHash.includes('password-123'));
  assert.ok(!Object.values(stored).includes('password-123'));
});

test('HASH_VERIFY — scrypt round-trip; wrong password rejected', () => {
  const hash = hashPassword('s3cret!');
  assert.equal(verifyPassword('s3cret!', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  assert.equal(verifyPassword('s3cret!', 'not-a-hash'), false);
  assert.equal(verifyPassword('s3cret!', ''), false);
  assert.equal(verifyPassword('s3cret!', null), false);
});

test('UNIQUE_SALT — two hashes of the same password differ (per-user salt)', () => {
  assert.notEqual(hashPassword('same'), hashPassword('same'));
});

test('RANDOM_PASSWORD — generated, has length and entropy', () => {
  const p1 = generateRandomPassword();
  const p2 = generateRandomPassword();
  assert.equal(p1.length, 12);
  assert.notEqual(p1, p2);
  assert.ok(p1.length >= 8);
});

test('DOMAIN_RULE — non-UADE email rejected with EMAIL_DOMAIN_INVALID', async () => {
  tableData.Users = [];
  await assert.rejects(
    () => seedUser({ email: 'foo@gmail.com' }),
    (err) => err.code === 'EMAIL_DOMAIN_INVALID' && err.status === 400
  );
  assert.equal(tableData.Users.length, 0);
});

test('EMAIL_NORMALIZATION — trims + lowercases on creation and lookup', async () => {
  tableData.Users = [];
  await seedUser({ email: '  Alu001@Uade.Edu.Ar ' });
  const found = await getUserByEmail('alu001@uade.edu.ar');
  assert.equal(found.userId, 'alu-001');
  assert.equal(found.email, 'alu001@uade.edu.ar');
});

test('DUP_EMAIL — duplicate normalized email rejected with EMAIL_EXISTS', async () => {
  tableData.Users = [];
  await seedUser({ email: 'alu001@uade.edu.ar' });
  await assert.rejects(
    () => seedUser({ userId: 'alu-002', email: 'ALU001@UADE.EDU.AR' }),
    (err) => err.code === 'EMAIL_EXISTS' && err.status === 409
  );
});

test('DUP_USERID — duplicate userId rejected with USER_ID_EXISTS', async () => {
  tableData.Users = [];
  await seedUser();
  await assert.rejects(
    () => seedUser({ email: 'other@uade.edu.ar' }),
    (err) => err.code === 'USER_ID_EXISTS' && err.status === 409
  );
});

test('GET_BY_EMAIL_MISSING — unknown email resolves null', async () => {
  tableData.Users = [];
  assert.equal(await getUserByEmail('ghost@uade.edu.ar'), null);
});

test('LIST_USERS — returns all users without hashes', async () => {
  tableData.Users = [];
  await seedUser();
  await seedUser({ userId: 'alu-002', name: 'Alumno', surname: 'Dos', email: 'alu002@uade.edu.ar' });
  const users = await listUsers();
  assert.equal(users.length, 2);
  assert.ok(users.every((u) => u.passwordHash === undefined));
});

test('UPDATE_ROLE_EMAIL — edit role + status; domain re-validated', async () => {
  tableData.Users = [];
  await seedUser();
  const updated = await updateUser('alu-001', { role: 'teacher', status: 'disabled' });
  assert.equal(updated.role, 'teacher');
  assert.equal(updated.status, 'disabled');

  await assert.rejects(
    () => updateUser('alu-001', { email: 'bad@gmail.com' }),
    (err) => err.code === 'EMAIL_DOMAIN_INVALID'
  );
  await assert.rejects(
    () => updateUser('ghost', { role: 'teacher' }),
    (err) => err.code === 'USER_NOT_FOUND'
  );
});

test('DELETE_USER — removes the entity', async () => {
  tableData.Users = [];
  await seedUser();
  assert.equal(await deleteUser('alu-001'), true);
  assert.equal(await getUserById('alu-001'), null);
  assert.equal(await deleteUser('ghost'), false);
});

test('SET_PASSWORD — new hash verifies; mustChangePassword flag honored', async () => {
  tableData.Users = [];
  await seedUser();
  assert.equal(await setUserPassword('alu-001', 'nueva-pass', { mustChangePassword: true }), true);
  const user = await getUserById('alu-001');
  assert.equal(user.mustChangePassword, true);
  assert.equal(verifyPassword('nueva-pass', user.passwordHash), true);
  assert.equal(verifyPassword('password-123', user.passwordHash), false);
});

test('ROLE_MAP — lowercase Users roles map to internal roles', () => {
  assert.equal(INTERNAL_ROLE_BY_ROLE.student, 'Alumno');
  assert.equal(INTERNAL_ROLE_BY_ROLE.teacher, 'Docente');
  assert.equal(INTERNAL_ROLE_BY_ROLE.director, 'Director');
  assert.equal(INTERNAL_ROLE_BY_ROLE.admin, 'Admin');
});

test('UADE_EMAIL_RULE — only @uade.edu.ar accepted', () => {
  assert.equal(isUadeEmail('alu@uade.edu.ar'), true);
  assert.equal(isUadeEmail('alu@UADE.EDU.AR'), true);
  assert.equal(isUadeEmail('alu@uade.edu.ar '), true);
  assert.equal(isUadeEmail('alu@gmail.com'), false);
  assert.equal(isUadeEmail('@uade.edu.ar'), false);
  assert.equal(normalizeEmail('  A@Uade.Edu.Ar '), 'a@uade.edu.ar');
});
