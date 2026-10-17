import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * access-review.test.js — UJ-53: inventario con evidencia, huérfanos,
 * decisiones con responsable y efecto, y firma del acta.
 */

const tableData = { AccessReview: [] };

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
        if (match) result = result.filter((row) => row.partitionKey === match[1]);
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
  namedExports: { getTableClient: (tableName) => createTableClient(tableName) },
});

const {
  buildAccessReview,
  permissionEvidence,
  statusEvidence,
  capabilitiesForRole,
  digestOf,
  effectFor,
  validateDecision,
  reviewCsv,
  currentReviewId,
  startReview,
  recordDecision,
  listDecisions,
  readSignature,
  signReview,
  DEFAULT_REVIEW_ID,
  DECISIONS,
} = await import('./access-review.js');

beforeEach(() => {
  tableData.AccessReview.length = 0;
});

const CON_EVIDENCIA = {
  userId: 'prof-001', name: 'Xavier', email: 'prof01@uade.edu.ar', role: 'teacher', status: 'active',
  createdAt: '2026-06-01T10:00:00.000Z',
  grantedBy: 'adm-001', grantedAt: '2026-06-01T10:00:00.000Z', grantReason: 'alta de la cohorte 2026-1',
  statusChangedBy: 'adm-001', statusChangedAt: '2026-06-01T10:00:00.000Z', statusChangeReason: 'alta de la cohorte 2026-1',
};

test('permissionEvidence: sin dueño, fecha o motivo el permiso queda huérfano y dice qué le falta', () => {
  assert.equal(permissionEvidence(CON_EVIDENCIA).huerfano, false);
  assert.deepEqual(permissionEvidence(CON_EVIDENCIA).falta, []);

  const sinMotivo = { ...CON_EVIDENCIA, grantReason: undefined };
  assert.equal(permissionEvidence(sinMotivo).huerfano, true);
  assert.deepEqual(permissionEvidence(sinMotivo).falta, ['motivo']);

  const vacio = { userId: 'alu-001', role: 'student', status: 'active' };
  assert.deepEqual(permissionEvidence(vacio).falta, ['dueño', 'fecha', 'motivo']);
  assert.equal(permissionEvidence(vacio).huerfano, true);
});

test('statusEvidence: el acto que fijó el estado se evalúa por separado del que otorgó el rol', () => {
  const soloRol = { ...CON_EVIDENCIA, statusChangedBy: undefined, statusChangedAt: undefined, statusChangeReason: undefined };
  assert.equal(permissionEvidence(soloRol).huerfano, false);
  assert.equal(statusEvidence(soloRol).huerfano, true);
});

test('buildAccessReview: el inventario trae rol, permisos vigentes y el acto, y separa los huérfanos', () => {
  const review = buildAccessReview([CON_EVIDENCIA, { userId: 'alu-001', name: 'Lucía', email: 'alu01@uade.edu.ar', role: 'student', status: 'active' }], { generatedAt: '2026-10-17T12:00:00.000Z' });

  assert.equal(review.resumen.identidades, 2);
  assert.equal(review.resumen.activas, 2);
  assert.equal(review.resumen.conEvidencia, 1);
  assert.equal(review.resumen.huerfanos, 1);
  assert.ok(review.resumen.permisosVigentes > 0, 'los permisos vigentes del rol tienen que enumerarse');

  const docente = review.entries.find((e) => e.userId === 'prof-001');
  assert.equal(docente.huerfano, false);
  assert.equal(docente.evidencia.dueño, 'adm-001');
  assert.equal(docente.evidencia.motivo, 'alta de la cohorte 2026-1');
  assert.ok(docente.permisos.length > 0);

  const alumna = review.entries.find((e) => e.userId === 'alu-001');
  assert.equal(alumna.huerfano, true);
  assert.deepEqual(alumna.falta, ['dueño', 'fecha', 'motivo']);
  assert.equal(alumna.evidencia.dueño, null);

  assert.deepEqual(review.huerfanos, [{ userId: 'alu-001', role: 'student', falta: ['dueño', 'fecha', 'motivo'] }]);
});

test('buildAccessReview: una identidad deshabilitada no cuenta como permiso vigente', () => {
  const review = buildAccessReview([{ ...CON_EVIDENCIA, userId: 'prof-002', status: 'disabled' }]);
  assert.equal(review.resumen.identidades, 1);
  assert.equal(review.resumen.activas, 0);
  assert.equal(review.resumen.permisosVigentes, 0);
  assert.equal(review.resumen.huerfanos, 0);
});

test('digestOf: el mismo conjunto da el mismo digest y un cambio de evidencia lo mueve', () => {
  const a = buildAccessReview([CON_EVIDENCIA]);
  const b = buildAccessReview([CON_EVIDENCIA]);
  assert.equal(a.digest, b.digest);

  const c = buildAccessReview([{ ...CON_EVIDENCIA, grantReason: 'otro motivo' }]);
  assert.notEqual(a.digest, c.digest);

  const d = buildAccessReview([{ ...CON_EVIDENCIA, role: 'director' }]);
  assert.notEqual(a.digest, d.digest);
  assert.match(a.digest, /^[a-f0-9]{64}$/);
});

test('digestOf: el orden de las filas no cambia el digest (un tercero recalcula y compara)', () => {
  const uno = { ...CON_EVIDENCIA };
  const dos = { userId: 'alu-001', role: 'student', status: 'active', grantedBy: 'adm-001', grantedAt: '2026-06-01T10:00:00.000Z', grantReason: 'matrícula' };
  assert.equal(buildAccessReview([uno, dos]).digest, buildAccessReview([dos, uno]).digest);
});

test('effectFor: sostener no cambia nada, reducir baja un escalón y retirar deshabilita', () => {
  const admin = { role: 'admin', status: 'active' };
  assert.deepEqual(effectFor(admin, 'sostener'), { role: 'admin', status: 'active' });
  assert.deepEqual(effectFor(admin, 'reducir'), { role: 'director', status: 'active' });
  assert.deepEqual(effectFor({ role: 'teacher', status: 'active' }, 'reducir'), { role: 'student', status: 'active' });
  assert.deepEqual(effectFor({ role: 'student', status: 'active' }, 'reducir'), { role: 'student', status: 'active' });
  assert.deepEqual(effectFor(admin, 'retirar'), { role: 'admin', status: 'disabled' });
  assert.throws(() => effectFor(admin, 'cualquier-cosa'), /decisión debe ser una de/);
});

test('validateDecision: sin motivo no hay decisión, y la decisión tiene que ser una de las tres', () => {
  assert.deepEqual(validateDecision({ decision: 'sostener', reason: 'se sostiene por la cátedra' }), { decision: 'sostener', reason: 'se sostiene por la cátedra' });
  assert.deepEqual(DECISIONS, ['sostener', 'reducir', 'retirar']);
  assert.throws(() => validateDecision({ decision: 'sostener', reason: '   ' }), /requiere motivo/);
  assert.throws(() => validateDecision({ decision: 'borrar', reason: 'x' }), /decisión debe ser una de/);
  assert.equal(validateDecision({ decision: 'RETIRAR', reason: 'acceso vencido' }).decision, 'retirar');
});

test('capabilitiesForRole: cada rol declara sus permisos vigentes', () => {
  for (const role of ['student', 'teacher', 'director', 'admin']) {
    assert.ok(capabilitiesForRole(role).length > 0, `${role} tiene que declarar permisos`);
  }
  assert.deepEqual(capabilitiesForRole('desconocido'), []);
});

test('reviewCsv: el acta exportada lleva la evidencia, los huérfanos, el digest y las decisiones', () => {
  const review = buildAccessReview([CON_EVIDENCIA, { userId: 'alu-001', role: 'student', status: 'active' }]);
  const csv = reviewCsv(review, {
    reviewId: 'ronda-2026-10-17',
    estado: 'firmada',
    firma: { signedBy: 'adm-001', signedAt: '2026-10-17T13:00:00.000Z', digest: review.digest },
    decisiones: [{ userId: 'alu-001', decision: 'retirar', reason: 'permiso sin acto', decidedBy: 'adm-001', decidedAt: '2026-10-17T12:30:00.000Z', efecto: { rolAntes: 'student', rolDespues: 'student', estadoAntes: 'active', estadoDespues: 'disabled' } }],
  });
  const lines = csv.split('\n');
  assert.match(lines[0], /^identidad,rol,estado,permisos,evidencia_dueno/);
  assert.match(csv, /"prof-001","teacher","active"/);
  assert.match(csv, /"adm-001","2026-06-01T10:00:00.000Z","alta de la cohorte 2026-1","no",""/);
  assert.match(csv, /"alu-001","student","active","[^"]*","","","","si","dueño; fecha; motivo"/);
  assert.match(csv, new RegExp(`digest,,,,,,,,,${review.digest}`));
  assert.match(csv, /decision,"alu-001","retirar","permiso sin acto","adm-001"/);
});

test('ronda vigente: sin nada abierto es la ronda inicial y abrir una nueva la reemplaza', async () => {
  assert.equal(await currentReviewId(), DEFAULT_REVIEW_ID);
  const nueva = await startReview({ actor: 'adm-001', now: '2026-10-17T12:00:00.000Z' });
  assert.equal(nueva, 'ronda-2026-10-17T12-00-00-000Z');
  assert.equal(await currentReviewId(), nueva);
});

test('decisiones y firma: se asientan con responsable, motivo y efecto, y la firma congela el digest', async () => {
  const reviewId = await currentReviewId();
  const registro = await recordDecision({
    reviewId,
    userId: 'alu-001',
    decision: 'retirar',
    reason: 'permiso sin acto que lo respalde',
    decidedBy: 'adm-001',
    efecto: { rolAntes: 'student', rolDespues: 'student', estadoAntes: 'active', estadoDespues: 'disabled' },
    digestBefore: 'a'.repeat(64),
    digestAfter: 'b'.repeat(64),
    now: '2026-10-17T12:30:00.000Z',
  });
  assert.equal(registro.decidedBy, 'adm-001');
  assert.equal(registro.efecto.estadoDespues, 'disabled');

  const decisiones = await listDecisions(reviewId);
  assert.equal(decisiones.length, 1);
  assert.equal(decisiones[0].reason, 'permiso sin acto que lo respalde');
  assert.equal(decisiones[0].efecto.estadoAntes, 'active');

  assert.equal(await readSignature(reviewId), null);
  await signReview({ reviewId, signedBy: 'adm-001', digest: 'c'.repeat(64), note: 'ronda cerrada', decisiones: 1, now: '2026-10-17T13:00:00.000Z' });
  const firma = await readSignature(reviewId);
  assert.equal(firma.signedBy, 'adm-001');
  assert.equal(firma.digest, 'c'.repeat(64));
  assert.equal(firma.decisiones, 1);

  // La firma no aparece como si fuera una decisión más del acta.
  assert.equal((await listDecisions(reviewId)).length, 1);
});
