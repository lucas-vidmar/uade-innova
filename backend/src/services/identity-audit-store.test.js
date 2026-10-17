import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * identity-audit-store.test.js — constancia de los cambios de identidad
 * (UJ-52 paso 9): fecha, quién, motivo y alcance, en un registro de sólo alta.
 */

const tableData = [];

function createTableClient() {
  return {
    createTable: async () => true,
    upsertEntity: async (entity) => {
      const idx = tableData.findIndex((row) => row.partitionKey === entity.partitionKey && row.rowKey === entity.rowKey);
      if (idx === -1) tableData.push({ ...entity });
      else tableData[idx] = { ...entity };
    },
    listEntities: ({ queryOptions } = {}) => {
      const filter = queryOptions?.filter || '';
      const match = filter.match(/PartitionKey eq '(.+)'/);
      const target = match ? match[1].replace(/''/g, "'") : null;
      const result = target ? tableData.filter((row) => row.partitionKey === target) : [...tableData];
      return {
        async *[Symbol.asyncIterator]() {
          for (const row of result) yield row;
        },
      };
    },
  };
}

mock.module('./storage.js', {
  namedExports: { getTableClient: () => createTableClient() },
});

const { recordIdentityChange, listIdentityChanges } = await import('./identity-audit-store.js');

beforeEach(() => {
  tableData.length = 0;
});

test('asienta el corte con fecha, quién, motivo y alcance (UJ-52 paso 9)', async () => {
  const out = await recordIdentityChange({
    target: 'rv3-uj52-baja',
    targetEmail: 'rv3-uj52-baja@uade.edu.ar',
    action: 'disable',
    actor: 'adm-001',
    actorRole: 'Admin',
    reason: 'Deja la institución el 2026-10-31',
    before: { role: 'student', status: 'active' },
    after: { role: 'student', status: 'disabled' },
    scope: { access: 'cerrado', sessions: 'revocadas', permisos: 2 },
  });
  assert.equal(out.recorded, true);
  assert.ok(out.at);
  assert.equal(tableData.length, 1);
  // No se guarda nada secreto.
  assert.equal(tableData[0].password, undefined);
  assert.equal(tableData[0].token, undefined);
});

test('la constancia se puede leer y llega del cambio más reciente al más viejo', async () => {
  await recordIdentityChange({
    target: 'alu-x', action: 'create', actor: 'adm-001', actorRole: 'Admin',
    reason: 'Alta', after: { status: 'active' }, at: '2026-10-01T10:00:00.000Z',
  });
  await recordIdentityChange({
    target: 'alu-x', action: 'disable', actor: 'adm-001', actorRole: 'Admin',
    reason: 'Se va', before: { status: 'active' }, after: { status: 'disabled' },
    scope: { access: 'cerrado' }, at: '2026-10-31T09:00:00.000Z',
  });
  await recordIdentityChange({
    target: 'alu-y', action: 'disable', actor: 'adm-001', reason: 'otra persona',
  });

  const trail = await listIdentityChanges('alu-x');
  assert.equal(trail.length, 2);
  assert.equal(trail[0].action, 'disable');
  assert.equal(trail[0].at, '2026-10-31T09:00:00.000Z');
  assert.equal(trail[0].reason, 'Se va');
  assert.deepEqual(trail[0].scope, { access: 'cerrado' });
  assert.deepEqual(trail[0].before, { status: 'active' });
  assert.deepEqual(trail[0].after, { status: 'disabled' });
  assert.equal(trail[0].actor, 'adm-001');
  assert.equal(trail[1].action, 'create');

  // La constancia de una persona no mezcla la de otra.
  assert.equal((await listIdentityChanges('alu-y')).length, 1);
  assert.equal((await listIdentityChanges('nadie')).length, 0);
  assert.deepEqual(await listIdentityChanges(''), []);
});

test('rechaza un cambio sin destino o con una acción desconocida, sin asentar nada', async () => {
  const sinDestino = await recordIdentityChange({ action: 'disable' });
  assert.equal(sinDestino.recorded, false);
  const accionInvalida = await recordIdentityChange({ target: 'alu-x', action: 'borrar-todo' });
  assert.equal(accionInvalida.recorded, false);
  assert.equal(tableData.length, 0);
});
