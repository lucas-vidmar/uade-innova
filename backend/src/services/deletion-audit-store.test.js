import { test, mock } from 'node:test';
import assert from 'node:assert';

const blobs = new Map();
let saveJsonShouldFail = false;

const storageMocks = {
  saveJson: mock.fn(async (container, blob, data) => {
    if (saveJsonShouldFail) throw new Error('storage caído');
    blobs.set(`${container}/${blob}`, data);
  }),
  loadJson: mock.fn(async (container, blob) => blobs.get(`${container}/${blob}`) || null),
  listBlobs: mock.fn(async (container, prefix = '') => [...blobs.keys()]
    .filter((key) => key.startsWith(`${container}/`))
    .map((key) => key.slice(container.length + 1))
    .filter((name) => name.startsWith(prefix))),
};

mock.module('./storage.js', { namedExports: storageMocks });

const {
  buildDeletionRecordId,
  isValidDeletionRecordId,
  recordMaterialDeletion,
  getMaterialDeletion,
  listMaterialDeletions,
  readDeclaredSoftDeleteDays,
  DELETED_CONTAINER_PURGE_DAYS,
} = await import('./deletion-audit-store.js');

function entry(overrides = {}) {
  return {
    requestedAt: '2026-10-19T22:47:10.610Z',
    outcome: 'deleted',
    actor: { id: 'adm-001', email: 'admin@uade.edu.ar', roles: ['authenticated', 'Admin'] },
    authorization: { basis: 'role', allowedRoles: ['Docente', 'Director', 'Admin'], actorRoles: ['Admin'] },
    target: {
      materialId: '48f711e9-3f75-4429-a67c-a422798e4157',
      subjectId: 'arq-software-2026',
      filename: 'rv3-538.txt',
      materialType: 'notes',
      classIds: ['class-01'],
      uploadedBy: 'prof-001',
      fileSize: 27,
    },
    scope: {
      blobsMoved: ['deleted/arq-software-2026/48f711e9.txt'],
      chunkCount: 1,
      vectorsDeleted: true,
      stateDeleted: true,
      quotaReleased: true,
    },
    retention: { declaredDays: 7 },
    correlationId: 'corr-1',
    ...overrides,
  };
}

test('el id de la constancia arranca con la fecha y es ordenable', () => {
  const id = buildDeletionRecordId({ requestedAt: '2026-10-19T22:47:10.610Z', materialId: 'abc-123', nonce: 'ff00aa' });
  assert.strictEqual(id, '20261019T224710610-abc-123-ff00aa');
  assert.ok(isValidDeletionRecordId(id));
  assert.ok(buildDeletionRecordId({ requestedAt: '2026-10-19T22:47:10.610Z', materialId: 'x' }) < buildDeletionRecordId({ requestedAt: '2026-10-20T00:00:00.000Z', materialId: 'x' }));
});

test('isValidDeletionRecordId rechaza rutas y valores vacíos', () => {
  assert.strictEqual(isValidDeletionRecordId('../retention-policy'), false);
  assert.strictEqual(isValidDeletionRecordId(''), false);
  assert.strictEqual(isValidDeletionRecordId(null), false);
  assert.strictEqual(isValidDeletionRecordId('deletions/a.json'), false);
  assert.strictEqual(isValidDeletionRecordId('20261019T224710610-abc-ff00aa'), true);
});

test('la constancia se guarda en compliance/deletions con alcance y responsable', async () => {
  blobs.clear();
  const res = await recordMaterialDeletion(entry());
  assert.strictEqual(res.recorded, true);
  const stored = blobs.get(`compliance/deletions/${res.recordId}.json`);
  assert.ok(stored, 'la constancia debe quedar como blob JSON');
  assert.strictEqual(stored.action, 'material-delete');
  assert.strictEqual(stored.outcome, 'deleted');
  assert.strictEqual(stored.actor.id, 'adm-001');
  assert.strictEqual(stored.target.materialId, '48f711e9-3f75-4429-a67c-a422798e4157');
  assert.deepStrictEqual(stored.scope.blobsMoved, ['deleted/arq-software-2026/48f711e9.txt']);
  assert.strictEqual(stored.retention.declaredDays, 7);
  assert.strictEqual(stored.retention.containerPurgeDays, DELETED_CONTAINER_PURGE_DAYS);
  assert.strictEqual(stored.correlationId, 'corr-1');
});

test('sin materialId no se escribe constancia y se informa el motivo', async () => {
  blobs.clear();
  const res = await recordMaterialDeletion({ target: {} });
  assert.strictEqual(res.recorded, false);
  assert.match(res.error, /materialId/);
  assert.strictEqual(blobs.size, 0);
});

test('si Storage falla, el borrado no explota: se informa recorded:false', async () => {
  blobs.clear();
  saveJsonShouldFail = true;
  const res = await recordMaterialDeletion(entry());
  saveJsonShouldFail = false;
  assert.strictEqual(res.recorded, false);
  assert.match(res.error, /storage/);
  assert.ok(res.recordId, 'se devuelve el id reservado para poder reclamarlo');
});

test('las constancias se listan de la más reciente a la más vieja y se filtran', async () => {
  blobs.clear();
  await recordMaterialDeletion(entry({ requestedAt: '2026-10-18T10:00:00.000Z', nonce: undefined, target: { materialId: 'mat-viejo', subjectId: 'arq-software-2026' } }));
  await recordMaterialDeletion(entry({ requestedAt: '2026-10-19T10:00:00.000Z', target: { materialId: 'mat-nuevo', subjectId: 'arq-software-2026' } }));
  await recordMaterialDeletion(entry({ requestedAt: '2026-10-19T11:00:00.000Z', target: { materialId: 'mat-otra-unidad', subjectId: 'otra-unidad' } }));

  const todas = await listMaterialDeletions();
  assert.strictEqual(todas.length, 3);
  assert.strictEqual(todas[0].target.materialId, 'mat-otra-unidad');
  assert.strictEqual(todas[2].target.materialId, 'mat-viejo');

  const filtradas = await listMaterialDeletions({ subjectId: 'arq-software-2026' });
  assert.strictEqual(filtradas.length, 2);

  const unaSola = await listMaterialDeletions({ materialId: 'mat-nuevo' });
  assert.strictEqual(unaSola.length, 1);

  const limitada = await listMaterialDeletions({ limit: 1 });
  assert.strictEqual(limitada.length, 1);
  assert.strictEqual(limitada[0].target.materialId, 'mat-otra-unidad');
});

test('getMaterialDeletion lee por id y devuelve null si no existe', async () => {
  blobs.clear();
  const { recordId } = await recordMaterialDeletion(entry());
  const record = await getMaterialDeletion(recordId);
  assert.strictEqual(record.recordId, recordId);
  assert.strictEqual(await getMaterialDeletion('20990101T000000000-nada-000000'), null);
  assert.strictEqual(await getMaterialDeletion('../x'), null);
});

test('readDeclaredSoftDeleteDays cae a 7 si no hay política y respeta la vigente', async () => {
  blobs.clear();
  assert.strictEqual(await readDeclaredSoftDeleteDays(), 7);
  blobs.set('compliance/retention-policy.json', { softDeleteDays: 14 });
  assert.strictEqual(await readDeclaredSoftDeleteDays(), 14);
});
