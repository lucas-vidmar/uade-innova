import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * access-review-api.test.js — UJ-53: el inventario con evidencia se arma con lo
 * que la tabla Users tiene (no con lo que la pantalla muestra), los permisos sin
 * acto salen huérfanos, sostener/reducir/retirar dejan responsable y efecto, y el
 * acta no se puede firmar sobre algo distinto de lo aplicado.
 *
 * Corre contra el users-store real sobre una tabla en memoria, así que lo que se
 * asienta es lo que después se lee.
 */

const handlers = {};
const declaredRoles = {};
const rolesByHandler = new Map();
mock.module('@azure/functions', {
  namedExports: {
    app: {
      http: (name, options) => {
        handlers[name] = options.handler;
        declaredRoles[name] = rolesByHandler.get(options.handler) || [];
      },
    },
  },
});
mock.module('../middleware/with-auth.js', {
  namedExports: {
    withAuth: (handler, options = {}) => {
      rolesByHandler.set(handler, options.roles || []);
      return handler;
    },
  },
});
mock.module('../middleware/with-correlation.js', { namedExports: { withCorrelation: (handler) => handler } });

const tableData = { Users: [], AccessReview: [] };

// #551: el alcance efectivo se deriva de matrículas, encuentros, material y del
// catálogo de unidades (`subjects.json`), que se lee por `loadJson`.
let subjectsCatalog = [];

function createTableClient(tableName) {
  const data = tableData[tableName] || (tableData[tableName] = []);
  return {
    createTable: async () => true,
    upsertEntity: async (entity, mode = 'Merge') => {
      const idx = data.findIndex((row) => row.partitionKey === entity.partitionKey && row.rowKey === entity.rowKey);
      if (idx === -1) { data.push({ ...entity }); return; }
      if (mode === 'Replace') data[idx] = { ...entity };
      else data[idx] = { ...data[idx], ...entity };
    },
    deleteEntity: async (partitionKey, rowKey) => {
      const idx = data.findIndex((row) => row.partitionKey === partitionKey && row.rowKey === rowKey);
      if (idx !== -1) data.splice(idx, 1);
    },
    getEntity: async (partitionKey, rowKey) => {
      const row = data.find((r) => r.partitionKey === partitionKey && r.rowKey === rowKey);
      if (!row) { const err = new Error('Not Found'); err.statusCode = 404; throw err; }
      return row;
    },
    listEntities: ({ queryOptions } = {}) => {
      const filter = queryOptions?.filter;
      let result = [...data];
      if (filter?.startsWith('PartitionKey eq')) {
        const match = filter.match(/PartitionKey eq '(.+)'/);
        if (match) result = result.filter((row) => row.partitionKey === match[1]);
      }
      return { async *[Symbol.asyncIterator]() { for (const row of result) yield row; } };
    },
  };
}

mock.module('../services/storage.js', {
  namedExports: {
    getTableClient: (tableName) => createTableClient(tableName),
    loadJson: async () => subjectsCatalog,
  },
});

await import('./access-review-api.js');
const { createUser, getUserById } = await import('../services/users-store.js');

function makeRequest({ body, query, params } = {}) {
  return {
    headers: { get: () => null },
    json: async () => body,
    query: new URLSearchParams(query || {}),
    params: params || {},
  };
}

function makeContext(id = 'adm-001') {
  const log = mock.fn();
  log.error = mock.fn();
  return { log, error: log.error, user: { id, userId: id, role: 'Admin' } };
}

const parse = (res) => JSON.parse(res.body);

async function seed() {
  await createUser({ userId: 'prof-001', name: 'Xavier', surname: 'Torres', email: 'prof01@uade.edu.ar', role: 'teacher', password: 'una-clave-larga', grantedBy: 'adm-001', grantReason: 'alta de la cohorte 2026-1' });
  await createUser({ userId: 'alu-001', name: 'Lucía', surname: 'Martínez', email: 'alu01@uade.edu.ar', role: 'student', password: 'una-clave-larga' });
}

beforeEach(() => {
  tableData.Users.length = 0;
  tableData.AccessReview.length = 0;
  tableData.Enrollments = [];
  tableData.classes = [];
  tableData.materials = [];
  subjectsCatalog = [];
});

test('roles — dirección puede leer la revisión; sólo administración aplica y firma (UJ-53)', () => {
  assert.deepEqual(declaredRoles['access-review-get'], ['Admin', 'Director']);
  assert.deepEqual(declaredRoles['access-review-decisions-get'], ['Admin', 'Director']);
  assert.deepEqual(declaredRoles['access-review-decide'], ['Admin']);
  assert.deepEqual(declaredRoles['access-review-sign'], ['Admin']);
  assert.deepEqual(declaredRoles['access-review-open'], ['Admin']);
});

test('GET access-review — el inventario sale con el acto de cada permiso y marca el que no lo tiene', async () => {
  await seed();
  const res = await handlers['access-review-get'](makeRequest(), makeContext());
  assert.equal(res.status, 200);
  const data = parse(res).data;

  assert.equal(data.resumen.identidades, 2);
  assert.equal(data.resumen.huerfanos, 1);
  assert.equal(data.resumen.conEvidencia, 1);
  assert.equal(data.estadoActa, 'abierta');
  assert.equal(data.firma, null);
  assert.match(data.digest, /^[a-f0-9]{64}$/);

  const docente = data.entries.find((e) => e.userId === 'prof-001');
  assert.equal(docente.huerfano, false);
  assert.equal(docente.evidencia.dueño, 'adm-001');
  assert.equal(docente.evidencia.motivo, 'alta de la cohorte 2026-1');
  assert.ok(docente.evidencia.fecha);
  assert.ok(docente.permisos.length > 0, 'el inventario tiene que enumerar los permisos vigentes del rol');

  const alumna = data.entries.find((e) => e.userId === 'alu-001');
  assert.equal(alumna.huerfano, true);
  // El alta deja la fecha del acto, pero sin dueño ni motivo el permiso no tiene
  // acto que lo respalde: eso es lo que la revisión tiene que ver, no disimular.
  assert.deepEqual(alumna.falta, ['dueño', 'motivo']);
  assert.deepEqual(data.huerfanos, [{ userId: 'alu-001', role: 'student', falta: ['dueño', 'motivo'] }]);
});

test('GET access-review?format=csv — el acta se puede leer fuera de la aplicación con su digest', async () => {
  await seed();
  const res = await handlers['access-review-get'](makeRequest({ query: { format: 'csv' } }), makeContext());
  assert.equal(res.status, 200);
  assert.match(res.headers['Content-Type'], /text\/csv/);
  assert.match(res.body, /^identidad,rol,estado,permisos,evidencia_dueno/m);
  assert.match(res.body, /"prof-001","teacher","active"/);
  assert.match(res.body, /"alu-001","student","active","[^"]*","","[0-9T:.Z-]+","","si","dueño; motivo"/);
  assert.match(res.body, /digest,,,,,,,,,[a-f0-9]{64}/);
  assert.match(res.body, /ronda,,,,,,,,,ronda-inicial/);
});

test('POST decisions — sin motivo no se aplica nada y la identidad queda igual', async () => {
  await seed();
  const res = await handlers['access-review-decide'](
    makeRequest({ body: { userId: 'alu-001', decision: 'retirar', reason: '   ' } }),
    makeContext(),
  );
  assert.equal(res.status, 400);
  assert.equal(parse(res).error.code, 'MISSING_REASON');
  const alumna = await getUserById('alu-001');
  assert.equal(alumna.status, 'active');
  assert.equal(await handlers['access-review-decisions-get'](makeRequest(), makeContext()).then((r) => parse(r).data.decisiones.length), 0);
});

test('POST decisions — retirar un permiso huérfano deja responsable, motivo y efecto aplicado', async () => {
  await seed();
  const res = await handlers['access-review-decide'](
    makeRequest({ body: { userId: 'alu-001', decision: 'retirar', reason: 'permiso sin acto que lo respalde' } }),
    makeContext('adm-001'),
  );
  assert.equal(res.status, 200);
  const data = parse(res).data;
  assert.equal(data.decision.decidedBy, 'adm-001');
  assert.deepEqual(data.decision.efecto, { rolAntes: 'student', rolDespues: 'student', estadoAntes: 'active', estadoDespues: 'disabled' });
  assert.equal(data.aplicado.status, 'disabled');
  assert.ok(data.decision.decidedAt, 'la decisión tiene que llevar su fecha');

  // Lo aplicado se releyó de la tabla: el estado y el acto quedaron asentados.
  const alumna = await getUserById('alu-001');
  assert.equal(alumna.status, 'disabled');
  assert.equal(alumna.statusChangedBy, 'adm-001');
  assert.equal(alumna.statusChangeReason, 'permiso sin acto que lo respalde');

  const acta = parse(await handlers['access-review-decisions-get'](makeRequest(), makeContext())).data;
  assert.equal(acta.decisiones.length, 1);
  assert.equal(acta.decisiones[0].reason, 'permiso sin acto que lo respalde');
  assert.equal(acta.decisiones[0].decidedBy, 'adm-001');
});

test('POST decisions — reducir el rol deja el nuevo acto y el permiso deja de ser huérfano', async () => {
  await seed();
  const antes = parse(await handlers['access-review-get'](makeRequest(), makeContext())).data;
  assert.equal(antes.entries.find((e) => e.userId === 'prof-001').huerfano, false);

  const res = await handlers['access-review-decide'](
    makeRequest({ body: { userId: 'prof-001', decision: 'reducir', reason: 'dicta una sola materia desde 2026-2' } }),
    makeContext('adm-001'),
  );
  assert.equal(res.status, 200);
  const data = parse(res).data;
  assert.deepEqual(data.decision.efecto, { rolAntes: 'teacher', rolDespues: 'student', estadoAntes: 'active', estadoDespues: 'active' });
  assert.equal(data.aplicado.role, 'student');

  const docente = await getUserById('prof-001');
  assert.equal(docente.role, 'student');
  // El acto anterior respaldaba otro permiso: el nuevo queda con su propio motivo.
  assert.equal(docente.grantedBy, 'adm-001');
  assert.equal(docente.grantReason, 'dicta una sola materia desde 2026-2');
});

test('POST decisions — sostener no cambia el permiso pero deja la decisión asentada', async () => {
  await seed();
  const res = await handlers['access-review-decide'](
    makeRequest({ body: { userId: 'alu-001', decision: 'sostener', reason: 'la cátedra respalda el acceso y el alta se rehace en la ronda siguiente' } }),
    makeContext('adm-001'),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(parse(res).data.decision.efecto, { rolAntes: 'student', rolDespues: 'student', estadoAntes: 'active', estadoDespues: 'active' });
  const alumna = await getUserById('alu-001');
  assert.equal(alumna.role, 'student');
  assert.equal(alumna.status, 'active');
});

test('POST decisions — una identidad que no existe no se inventa (404)', async () => {
  await seed();
  const res = await handlers['access-review-decide'](
    makeRequest({ body: { userId: 'no-existe', decision: 'retirar', reason: 'x' } }),
    makeContext(),
  );
  assert.equal(res.status, 404);
  assert.equal(parse(res).error.code, 'USER_NOT_FOUND');
});

test('POST sign — no firma sin digest, ni sobre un inventario que cambió después de la comprobación', async () => {
  await seed();
  const inventario = parse(await handlers['access-review-get'](makeRequest(), makeContext())).data;

  const sinDigest = await handlers['access-review-sign'](makeRequest({ body: {} }), makeContext());
  assert.equal(sinDigest.status, 400);
  assert.equal(parse(sinDigest).error.code, 'MISSING_DIGEST');

  // Alguien aplica una decisión DESPUÉS de que el auditor comprobó el conjunto:
  // el rol cambia, así que el inventario comprobado ya no describe lo aplicado.
  await handlers['access-review-decide'](
    makeRequest({ body: { userId: 'prof-001', decision: 'reducir', reason: 'dicta una sola materia desde 2026-2' } }),
    makeContext(),
  );
  const desfasado = await handlers['access-review-sign'](makeRequest({ body: { digest: inventario.digest } }), makeContext());
  assert.equal(desfasado.status, 409);
  assert.equal(parse(desfasado).error.code, 'STALE_DIGEST');
  assert.ok(parse(desfasado).error.expectedDigest);

  const vigente = parse(await handlers['access-review-get'](makeRequest(), makeContext())).data;
  assert.notEqual(vigente.digest, inventario.digest);

  const firma = await handlers['access-review-sign'](
    makeRequest({ body: { digest: vigente.digest, note: 'ronda cerrada con una falta heredada' } }),
    makeContext('adm-001'),
  );
  assert.equal(firma.status, 200);
  const firmado = parse(firma).data;
  assert.equal(firmado.firma.signedBy, 'adm-001');
  assert.equal(firmado.firma.digest, vigente.digest);
  assert.equal(firmado.decisiones, 1);
  assert.deepEqual(firmado.faltasHeredadas.map((f) => f.userId), ['alu-001']);

  const acta = parse(await handlers['access-review-get'](makeRequest(), makeContext())).data;
  assert.equal(acta.estadoActa, 'firmada');
  assert.equal(acta.firma.signedBy, 'adm-001');
});

test('POST sign — un acta firmada no admite más decisiones hasta abrir la ronda siguiente', async () => {
  await seed();
  const inventario = parse(await handlers['access-review-get'](makeRequest(), makeContext())).data;
  await handlers['access-review-sign'](makeRequest({ body: { digest: inventario.digest } }), makeContext());

  const tarde = await handlers['access-review-decide'](
    makeRequest({ body: { userId: 'alu-001', decision: 'retirar', reason: 'llego tarde' } }),
    makeContext(),
  );
  assert.equal(tarde.status, 409);
  assert.equal(parse(tarde).error.code, 'REVIEW_SIGNED');

  const dobleFirma = await handlers['access-review-sign'](makeRequest({ body: { digest: inventario.digest } }), makeContext());
  assert.equal(dobleFirma.status, 409);

  const abierta = await handlers['access-review-open'](makeRequest({ body: {} }), makeContext('adm-001'));
  assert.equal(abierta.status, 201);
  const ronda = parse(abierta).data;
  assert.equal(ronda.previousReviewId, 'ronda-inicial');
  assert.match(ronda.reviewId, /^ronda-/);

  // La ronda nueva arranca sin decisiones ni firma, y vuelve a aceptar decisiones.
  const limpia = parse(await handlers['access-review-decisions-get'](makeRequest(), makeContext())).data;
  assert.equal(limpia.reviewId, ronda.reviewId);
  assert.equal(limpia.decisiones.length, 0);
  assert.equal(limpia.estadoActa, 'abierta');

  const aplicada = await handlers['access-review-decide'](
    makeRequest({ body: { userId: 'alu-001', decision: 'retirar', reason: 'falta heredada de la ronda anterior' } }),
    makeContext(),
  );
  assert.equal(aplicada.status, 200);
});

// ─── #551 — alcance efectivo derivado de matrículas y jerarquía ──────────────

/**
 * Estado del piloto, en tablas: una unidad con dos docentes, dos encuentros (uno
 * publicado y uno en borrador) y material colgado de cada uno.
 */
async function seedReach() {
  subjectsCatalog = [
    { id: 'arq-software-2026', name: 'Arquitectura de Software 2026', professorIds: ['prof-001', 'prof-002'] },
    { id: 'dasi-1c2023', name: 'DASI', professorIds: [] },
  ];
  tableData.Enrollments = [
    { partitionKey: 'arq-software-2026', rowKey: 'alu-001', role: 'student', status: 'active', enrolledAt: '2026-02-01T10:00:00.000Z' },
    { partitionKey: 'arq-software-2026', rowKey: 'prof-001', role: 'teacher', status: 'active', enrolledAt: '2026-02-01T10:00:00.000Z' },
    { partitionKey: 'arq-software-2026', rowKey: 'prof-002', role: 'teacher', status: 'active', enrolledAt: '2026-02-01T10:00:00.000Z' },
  ];
  tableData.classes = [
    {
      partitionKey: 'arq-software-2026', rowKey: 'class-01', title: 'Clase 1', date: '2026-03-01',
      publicationState: 'publicado', summaryReady: true, professorIds: JSON.stringify(['prof-001', 'prof-002']), studentIds: JSON.stringify([]),
    },
    {
      partitionKey: 'arq-software-2026', rowKey: 'class-02', title: 'Clase 2', date: '2026-03-08',
      publicationState: 'borrador', summaryReady: false, professorIds: JSON.stringify(['prof-001']), studentIds: JSON.stringify([]),
    },
  ];
  tableData.materials = [
    { partitionKey: 'arq-software-2026', rowKey: 'mat-publicado', filename: 'guia-01.pdf', classIds: JSON.stringify(['class-01']), type: 'pdf', status: 'processed' },
    { partitionKey: 'arq-software-2026', rowKey: 'mat-borrador', filename: 'guia-02.pdf', classIds: JSON.stringify(['class-02']), type: 'pdf', status: 'processed' },
  ];
}

test('#551 — el inventario dice qué alcanza cada identidad: unidad → encuentro → material, con la fuente de cada ítem', async () => {
  await seed();
  await seedReach();

  const data = parse(await handlers['access-review-get'](makeRequest(), makeContext())).data;
  assert.equal(data.resumen.identidades, 2);

  const alumna = data.entries.find((e) => e.userId === 'alu-001');
  assert.ok(alumna.alcance, 'cada entrada tiene que traer el alcance efectivo, no sólo la lista de permisos del rol');

  const unidad = alumna.alcance.unidades.find((u) => u.unidadId === 'arq-software-2026');
  assert.ok(unidad, 'la matrícula activa tiene que aparecer como unidad alcanzada');
  assert.equal(unidad.nombre, 'Arquitectura de Software 2026');
  assert.equal(unidad.acceso.via, 'matricula');
  assert.equal(unidad.acceso.rol, 'student');
  assert.match(unidad.acceso.fuente, /Enrollments/);

  // El borrador no se le atribuye al alumnado; el publicado sí, con su fuente.
  assert.deepEqual(unidad.encuentros.map((e) => e.encuentroId), ['class-01']);
  assert.equal(unidad.encuentrosNoAlcanzables, 1);
  assert.match(unidad.encuentros[0].fuente, /Classes/);

  // Material: sólo el colgado del encuentro publicado.
  assert.deepEqual(unidad.material.items.map((m) => m.materialId), ['mat-publicado']);
  assert.equal(unidad.material.alcanzables, 1);
  assert.match(unidad.material.items[0].fuente, /Materials/);

  // La docente alcanza además el borrador y su material.
  const docente = data.entries.find((e) => e.userId === 'prof-001');
  const unidadDocente = docente.alcance.unidades.find((u) => u.unidadId === 'arq-software-2026');
  assert.deepEqual(unidadDocente.encuentros.map((e) => e.encuentroId), ['class-01', 'class-02']);
  assert.equal(unidadDocente.material.items.length, 2);
  assert.equal(unidadDocente.docentes.activos, 2);

  // El resumen del inventario suma el alcance, para que la cabecera lo pueda decir.
  assert.equal(data.resumen.alcance.unidades, 2);
  assert.equal(data.resumen.alcance.encuentros, 3);
  assert.equal(data.resumen.alcance.materiales, 3);
});

test('#551 — el alcance no expone contenido ni datos de terceros: sólo lo que hace falta para decidir el acceso', async () => {
  await seed();
  await seedReach();
  const data = parse(await handlers['access-review-get'](makeRequest(), makeContext())).data;
  const alumna = data.entries.find((e) => e.userId === 'alu-001');

  const serializado = JSON.stringify(alumna.alcance);
  for (const tercero of ['prof-001', 'prof-002', 'Xavier', 'prof01@uade.edu.ar']) {
    assert.equal(serializado.includes(tercero), false, `el alcance no debe exponer ${tercero}`);
  }
  // Lo que sí hace falta: cuántas personas comparten la unidad y qué alcanza ella.
  assert.equal(alumna.alcance.unidades[0].docentes.activos, 2);
});

test('#551 — el acta en CSV lleva el alcance al final sin romper las columnas que ya existían', async () => {
  await seed();
  await seedReach();
  const res = await handlers['access-review-get'](makeRequest({ query: { format: 'csv' } }), makeContext());
  assert.equal(res.status, 200);
  assert.match(res.body, /^identidad,rol,estado,permisos,evidencia_dueno,[^\n]*unidades,encuentros,material,permisos_especiales,responsabilidades_abiertas/m);
  assert.match(res.body, /"alu-001","student","active",[^\n]*"arq-software-2026[^"]*"/);
  assert.match(res.body, /^alcance,,+unidades=2;/m);
});

test('#551 — GET reach/{userId} devuelve el alcance de una sola identidad, con sus avisos', async () => {
  await seed();
  await seedReach();

  const res = await handlers['access-review-reach'](makeRequest({ params: { userId: 'alu-001' } }), makeContext());
  assert.equal(res.status, 200);
  const data = parse(res).data;
  assert.equal(data.identidad.userId, 'alu-001');
  assert.equal(data.alcance.unidades.length, 1);
  assert.equal(data.alcance.unidades[0].unidadId, 'arq-software-2026');
  assert.match(data.alcance.digest, /^[a-f0-9]{64}$/);

  const inexistente = await handlers['access-review-reach'](makeRequest({ params: { userId: 'no-existe' } }), makeContext());
  assert.equal(inexistente.status, 404);
  assert.equal(parse(inexistente).error.code, 'USER_NOT_FOUND');

  assert.deepEqual(declaredRoles['access-review-reach'], ['Admin', 'Director']);
});
