import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * identity-reach.test.js — #551: el alcance efectivo se deriva de las matrículas
 * y de la jerarquía unidad → encuentro → material, y cada ítem declara la fuente
 * de la que salió. Lo que no se puede derivar no se inventa: se avisa.
 */

const {
  buildIdentityReach,
  reachDigest,
  MAX_MATERIALES_POR_UNIDAD,
  GLOBAL_REACH_ROLES,
} = await import('./identity-reach.js');

const SUJETOS = [
  { id: 'arq', name: 'Arquitectura de Software 2026', professorIds: ['prof-001'] },
  { id: 'dasi', name: 'DASI', professorIds: [] },
];

const CLASES = [
  { id: 'c1', subjectId: 'arq', title: 'Clase 1', date: '2026-03-01', publicationState: 'publicado', professorIds: ['prof-001'], studentIds: ['alu-001'] },
  { id: 'c2', subjectId: 'arq', title: 'Clase 2', date: '2026-03-08', publicationState: 'borrador', professorIds: ['prof-001'], studentIds: [] },
  { id: 'd1', subjectId: 'dasi', title: 'Clase DASI', date: '2026-03-02', publicationState: 'publicado', professorIds: [], studentIds: [] },
];

const MATERIALES = [
  { materialId: 'm1', subjectId: 'arq', filename: 'uno.pdf', classIds: ['c1'] },
  { materialId: 'm2', subjectId: 'arq', filename: 'dos.pdf', classIds: ['c2'] },
  { materialId: 'm3', subjectId: 'arq', filename: 'suelto.pdf', classIds: [] },
];

const matricula = (subjectId, userId, role, status = 'active') => ({ subjectId, userId, role, status, enrolledAt: '2026-02-01T10:00:00.000Z' });

const ALUMNA = { userId: 'alu-001', name: 'Lucía', role: 'student', status: 'active' };
const DOCENTE = { userId: 'prof-001', name: 'Xavier', role: 'teacher', status: 'active' };
const ADMIN = { userId: 'adm-001', name: 'Admin Técnico', role: 'admin', status: 'active' };
const DIRECTOR = { userId: 'dir-001', name: 'Jorge', role: 'director', status: 'active' };

test('alumnado: alcanza sólo sus unidades y, dentro, los encuentros publicados y su material', () => {
  const alcance = buildIdentityReach({
    user: ALUMNA,
    enrollments: [matricula('arq', 'alu-001', 'student'), matricula('arq', 'prof-001', 'teacher')],
    subjects: SUJETOS,
    classes: CLASES,
    materials: MATERIALES,
  });

  assert.deepEqual(alcance.unidades.map((u) => u.unidadId), ['arq']);
  const unidad = alcance.unidades[0];
  assert.equal(unidad.nombre, 'Arquitectura de Software 2026');
  assert.equal(unidad.acceso.via, 'matricula');
  assert.equal(unidad.acceso.rol, 'student');
  assert.equal(unidad.acceso.contenido, 'solo-publicado');
  assert.match(unidad.acceso.fuente, /Enrollments/);

  // El borrador no se le atribuye: la superficie del alumnado no lo muestra (#428).
  assert.deepEqual(unidad.encuentros.map((e) => e.encuentroId), ['c1']);
  assert.equal(unidad.encuentros[0].estado, 'publicado');
  assert.equal(unidad.encuentros[0].alcanzable, true);
  assert.match(unidad.encuentros[0].fuente, /Classes/);

  // Material: sólo el colgado de un encuentro publicado; el borrador y el suelto no.
  assert.deepEqual(unidad.material.items.map((m) => m.materialId), ['m1']);
  assert.match(unidad.material.items[0].fuente, /Materials/);

  assert.deepEqual(alcance.permisosEspeciales, []);
  assert.deepEqual(alcance.responsabilidadesAbiertas, []);
  assert.equal(alcance.totales.unidades, 1);
  assert.match(alcance.digest, /^[a-f0-9]{64}$/);
});

test('docencia: alcanza todos los encuentros de su unidad y, si es la única persona, queda como responsabilidad abierta', () => {
  const alcance = buildIdentityReach({
    user: DOCENTE,
    enrollments: [matricula('arq', 'prof-001', 'teacher'), matricula('arq', 'alu-001', 'student')],
    subjects: SUJETOS,
    classes: CLASES,
    materials: MATERIALES,
  });

  const unidad = alcance.unidades[0];
  assert.equal(unidad.acceso.contenido, 'completo');
  assert.deepEqual(unidad.encuentros.map((e) => e.encuentroId), ['c1', 'c2']);
  assert.equal(unidad.material.items.length, 3);
  assert.equal(unidad.docentes.activos, 1);
  assert.equal(unidad.docentes.unicoDocente, true);
  assert.equal(unidad.docentes.nomina, 1);

  const tipos = alcance.responsabilidadesAbiertas.map((r) => r.tipo);
  assert.ok(tipos.includes('unica-docente-unidad'), 'la unidad quedaría sin responsable');
  assert.ok(tipos.includes('unico-docente-encuentro'), 'el encuentro publicado depende de una sola persona');
  const unica = alcance.responsabilidadesAbiertas.find((r) => r.tipo === 'unica-docente-unidad');
  assert.equal(unica.unidadId, 'arq');
  assert.match(unica.fuente, /Enrollments/);
});

test('docencia compartida: con otra persona a cargo no hay responsabilidad abierta', () => {
  const alcance = buildIdentityReach({
    user: DOCENTE,
    enrollments: [matricula('arq', 'prof-001', 'teacher'), matricula('arq', 'prof-002', 'teacher')],
    subjects: SUJETOS,
    classes: CLASES,
    materials: MATERIALES,
  });
  assert.equal(alcance.unidades[0].docentes.activos, 2);
  assert.equal(alcance.unidades[0].docentes.unicoDocente, false);
  assert.deepEqual(alcance.responsabilidadesAbiertas.map((r) => r.tipo), ['unico-docente-encuentro']);
});

test('permiso especial: dictar una unidad sin figurar en su nómina se declara con su fuente', () => {
  const sujetos = [{ id: 'arq', name: 'Arquitectura', professorIds: ['prof-009'] }];
  const alcance = buildIdentityReach({
    user: DOCENTE,
    enrollments: [matricula('arq', 'prof-001', 'teacher'), matricula('arq', 'prof-009', 'teacher')],
    subjects: sujetos,
    classes: [],
    materials: [],
  });

  const especial = alcance.permisosEspeciales.find((p) => p.tipo === 'docencia-sin-nomina');
  assert.ok(especial, 'la matrícula docente fuera de la nómina es un permiso especial, no un detalle');
  assert.equal(especial.unidadId, 'arq');
  assert.match(especial.fuente, /Enrollments/);
  assert.match(especial.fuente, /subjects\.json/);
});

test('permiso especial: figurar en un encuentro sin matrícula en la unidad', () => {
  const clases = [{ id: 'c9', subjectId: 'dasi', publicationState: 'publicado', professorIds: [], studentIds: ['alu-001'] }];
  const alcance = buildIdentityReach({
    user: ALUMNA,
    enrollments: [matricula('arq', 'alu-001', 'student')],
    subjects: SUJETOS,
    classes: clases,
    materials: [],
  });

  const especial = alcance.permisosEspeciales.find((p) => p.tipo === 'encuentro-sin-matricula');
  assert.ok(especial);
  assert.equal(especial.encuentroId, 'c9');
  assert.match(especial.fuente, /Classes/);
});

test('rol global: admin alcanza todas las unidades, pero el contenido le exige matrícula (403 medido)', () => {
  const alcance = buildIdentityReach({
    user: ADMIN,
    enrollments: [],
    subjects: SUJETOS,
    classes: CLASES,
    materials: MATERIALES,
    adminsActivos: 1,
  });

  assert.deepEqual(alcance.unidades.map((u) => u.unidadId), ['arq', 'dasi']);
  for (const unidad of alcance.unidades) {
    assert.equal(unidad.acceso.via, 'rol-global');
    assert.equal(unidad.acceso.contenido, 'requiere-matricula');
    assert.deepEqual(unidad.encuentros, []);
    assert.equal(unidad.material.items.length, 0);
    assert.ok(unidad.alertas.some((a) => a.tipo === 'contenido-requiere-matricula'));
  }

  const especial = alcance.permisosEspeciales.find((p) => p.tipo === 'alcance-global');
  assert.ok(especial);
  assert.match(especial.descripcion, /contenido de la unidad no/);

  const responsabilidad = alcance.responsabilidadesAbiertas.find((r) => r.tipo === 'unico-admin-activo');
  assert.ok(responsabilidad, 'sin otro Admin, el corte deja la revisión sin quien la aplique y firme');
});

test('rol global: dirección alcanza también el contenido de toda unidad', () => {
  const alcance = buildIdentityReach({
    user: DIRECTOR,
    enrollments: [],
    subjects: SUJETOS,
    classes: CLASES,
    materials: MATERIALES,
    adminsActivos: 1,
  });
  assert.ok(GLOBAL_REACH_ROLES.includes('director'));
  for (const unidad of alcance.unidades) assert.equal(unidad.acceso.contenido, 'completo');
  assert.equal(alcance.unidades.find((u) => u.unidadId === 'arq').encuentros.length, 2);
});

test('identidad sin matrícula y sin rol global: alcance vacío, sin inventar unidades', () => {
  const alcance = buildIdentityReach({
    user: { userId: 'alu-099', role: 'student', status: 'active' },
    enrollments: [],
    subjects: [],
    classes: CLASES,
    materials: MATERIALES,
    catalogoLeido: false,
  });
  assert.deepEqual(alcance.unidades, []);
  assert.equal(alcance.totales.unidades, 0);
  assert.ok(alcance.avisos.length > 0, 'sin catálogo hay que declararlo');
});

test('unidad sin docente con matrícula activa se declara en la alerta de la unidad', () => {
  const alcance = buildIdentityReach({
    user: ALUMNA,
    enrollments: [matricula('dasi', 'alu-001', 'student')],
    subjects: SUJETOS,
    classes: CLASES,
    materials: MATERIALES,
  });
  const unidad = alcance.unidades[0];
  assert.equal(unidad.unidadId, 'dasi');
  const alerta = unidad.alertas.find((a) => a.tipo === 'unidad-sin-docente');
  assert.ok(alerta, 'lo que no puede quedar sin responsable tiene que verse en la unidad');
  assert.match(alerta.fuente, /Enrollments/);
});

test('el alcance no expone a terceros: ni ids ni nombres de otras identidades', () => {
  const alcance = buildIdentityReach({
    user: ALUMNA,
    enrollments: [matricula('arq', 'alu-001', 'student'), matricula('arq', 'prof-001', 'teacher'), matricula('arq', 'prof-002', 'teacher')],
    subjects: SUJETOS,
    classes: CLASES,
    materials: MATERIALES,
  });
  const serializado = JSON.stringify(alcance);
  for (const tercero of ['prof-001', 'prof-002', 'Xavier', 'Jorge']) {
    assert.equal(serializado.includes(tercero), false, `el alcance no debe nombrar a ${tercero}`);
  }
  assert.equal(alcance.unidades[0].docentes.activos, 2);
});

test('el tope de materiales por unidad se declara en vez de recortar en silencio', () => {
  const muchos = Array.from({ length: MAX_MATERIALES_POR_UNIDAD + 5 }, (_, i) => ({
    materialId: `m-${i}`, subjectId: 'arq', filename: `f-${i}.pdf`, classIds: ['c1'],
  }));
  const alcance = buildIdentityReach({
    user: DOCENTE,
    enrollments: [matricula('arq', 'prof-001', 'teacher')],
    subjects: SUJETOS,
    classes: CLASES,
    materials: muchos,
  });
  const unidad = alcance.unidades[0];
  assert.equal(unidad.material.items.length, MAX_MATERIALES_POR_UNIDAD);
  assert.equal(unidad.material.alcanzables, MAX_MATERIALES_POR_UNIDAD + 5);
  assert.equal(unidad.material.truncado, true);
});

test('reachDigest: mismo alcance, mismo digest; un material nuevo lo cambia', () => {
  const base = buildIdentityReach({
    user: ALUMNA,
    enrollments: [matricula('arq', 'alu-001', 'student')],
    subjects: SUJETOS,
    classes: CLASES,
    materials: MATERIALES,
  });
  const igual = buildIdentityReach({
    user: ALUMNA,
    enrollments: [matricula('arq', 'alu-001', 'student')],
    subjects: SUJETOS,
    classes: CLASES,
    materials: MATERIALES,
  });
  assert.equal(base.digest, igual.digest);
  assert.equal(reachDigest(base), base.digest);

  const conMasMaterial = buildIdentityReach({
    user: ALUMNA,
    enrollments: [matricula('arq', 'alu-001', 'student')],
    subjects: SUJETOS,
    classes: CLASES,
    materials: [...MATERIALES, { materialId: 'm4', subjectId: 'arq', filename: 'tres.pdf', classIds: ['c1'] }],
  });
  assert.notEqual(conMasMaterial.digest, base.digest);
});
