import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { planAdoptionBackfill, runAdoptionBackfill } from './adoption-backfill.js';
import { buildAdoptionReading } from './adoption-dimensions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, '../../scripts/fixtures/pilot-adoption-before-2026-10-20.json'), 'utf8'),
);

const PILOT_IDS = FIXTURE.identidadesDelPiloto;

function pilotProfiles() {
  return new Map(FIXTURE.profiles.map((profile) => [profile.userId, { ...profile }]));
}

/**
 * Store en memoria que imita el comportamiento Merge de las tablas: el parche
 * sólo escribe las claves que trae y conserva el resto de la fila.
 */
function makeMemoryStores({ enrollments, profiles, subjects }) {
  const rows = enrollments.map((row) => ({ ...row }));
  const profileRows = new Map(Array.from(profiles.entries()).map(([userId, value]) => [userId, { ...value }]));
  const writes = [];
  return {
    rows,
    profileRows,
    writes,
    listEnrollments: async () => rows.map((row) => ({ ...row })),
    listProfiles: async () => new Map(Array.from(profileRows.entries()).map(([k, v]) => [k, { ...v }])),
    loadSubjects: async () => subjects,
    patchEnrollment: async ({ subjectId, userId, ...fields }) => {
      const row = rows.find((entry) => entry.subjectId === subjectId && entry.userId === userId);
      if (!row) throw new Error(`enrollment not found ${subjectId}/${userId}`);
      Object.assign(row, fields);
      writes.push({ table: 'Enrollments', subjectId, userId, ...fields });
    },
    patchProfile: async ({ userId, ...fields }) => {
      const current = profileRows.get(userId) || { userId };
      profileRows.set(userId, { ...current, ...fields });
      writes.push({ table: 'UserProfiles', userId, ...fields });
    },
  };
}

function pilotStores() {
  return makeMemoryStores({
    enrollments: FIXTURE.enrollments,
    profiles: pilotProfiles(),
    subjects: FIXTURE.subjects,
  });
}

test('plan sobre el estado previo del piloto: completa la carrera desde la unidad y no inventa sede', () => {
  const plan = planAdoptionBackfill({
    enrollments: FIXTURE.enrollments,
    profiles: pilotProfiles(),
    subjects: FIXTURE.subjects,
  });

  // 12 filas, 5 no son alumnos (admin, director y 3 docentes), 7 matrículas de
  // alumno activo sobre 6 personas (alu-001 está en dos unidades).
  assert.deepEqual(plan.cohort, { enrollmentsRead: 12, studentActive: 7, people: 6 });
  assert.equal(plan.skipped.notStudent, 5, 'admin, director y docentes quedan fuera de la cohorte');
  assert.equal(plan.conflicts.length, 0);

  for (const userId of PILOT_IDS) {
    const patches = plan.enrollments.filter((patch) => patch.userId === userId);
    assert.ok(patches.length >= 1, `${userId} recibe su parche de matrícula`);
    for (const patch of patches) {
      assert.equal(patch.track, 'Tecnicatura', `${userId} hereda la carrera declarada por la unidad`);
      assert.equal(patch.trackSource, 'unidad');
      assert.equal(patch.campus, undefined, 'la sede no se deriva de la unidad');
    }
  }

  // Sin fuente de sede, el plan lo declara en vez de repartir personas.
  assert.equal(plan.unassigned.campus, 6);
  assert.equal(plan.unassigned.track, 0);
  assert.equal(plan.summary.campusPatched, 0);
  assert.equal(plan.summary.trackPatched, 7);
});

test('backfill aplicado dos veces es idempotente y no pierde campos de las filas existentes', async () => {
  const stores = pilotStores();
  const before = stores.rows.map((row) => ({ ...row }));

  const first = await runAdoptionBackfill({ stores, apply: true });
  assert.equal(first.applied, true);
  assert.equal(first.written.enrollments, 7, 'una matrícula por cada matrícula de alumno activo (alu-001 cursa dos unidades)');
  assert.ok(first.written.profiles >= 1);

  // Las filas conservan rol, estado y cualquier campo previo.
  for (const row of stores.rows) {
    const previous = before.find((entry) => entry.subjectId === row.subjectId && entry.userId === row.userId);
    assert.equal(row.role, previous.role);
    assert.equal(row.status, previous.status);
    assert.equal(row.subjectId, previous.subjectId);
    assert.equal(row.userId, previous.userId);
  }

  const second = await runAdoptionBackfill({ stores, apply: true });
  assert.equal(second.plan.summary.enrollmentPatches, 0, 'la segunda pasada no reescribe nada');
  assert.equal(second.plan.summary.profilePatches, 0);
  assert.equal(stores.writes.length, first.written.enrollments + first.written.profiles);
  // El perfil de alu-001 conserva sus preferencias: el parche es Merge.
  assert.equal(stores.profileRows.get('alu-001').theme, 'light');
});

test('backfill con sede declarada: la cohorte queda con sede y carrera y la lectura no deja huérfanas', async () => {
  const stores = pilotStores();
  const campusMap = Object.fromEntries(PILOT_IDS.map((userId) => [userId, 'Monserrat']));

  await runAdoptionBackfill({ stores, apply: true, campusMap });

  for (const userId of PILOT_IDS) {
    const row = stores.rows.find((entry) => entry.subjectId === 'arq-software-2026' && entry.userId === userId);
    assert.equal(row.campus, 'Monserrat');
    assert.equal(row.campusSource, 'mapa');
    assert.equal(row.track, 'Tecnicatura');
    const profile = stores.profileRows.get(userId);
    assert.equal(profile.campus, 'Monserrat', 'el perfil también queda con la sede declarada');
    assert.equal(profile.track, 'Tecnicatura');
  }

  const reading = buildAdoptionReading({
    subjects: FIXTURE.subjects,
    enrollments: stores.rows,
    profiles: stores.profileRows,
    activeUserIdsBySubject: { 'arq-software-2026': ['alu-001', 'alu-003'] },
  });

  assert.equal(reading.integrity.orphanPeople, 0, 'ninguna persona queda fuera de los cortes');
  assert.equal(reading.dimensions.campus.total.cohort, 6);
  // 5 identidades del piloto con sede declarada + 1132 (cuenta de prueba del
  // piloto, sin sede en el mapa) en su propio corte «sin declarar».
  assert.equal(reading.dimensions.campus.total.rows, 2);
  assert.equal(reading.dimensions.campus.rows[0].label, 'Monserrat');
  assert.equal(reading.dimensions.campus.rows[0].cohort, 5);
  // Tras el backfill el valor vive en la matrícula: la lectura declara esa fuente.
  assert.equal(reading.dimensions.campus.total.sources.matricula, 6, 'alu-001 cursa dos unidades con la misma sede');
  assert.equal(reading.dimensions.campus.total.sources.sin_dato, 1);
  assert.equal(reading.dimensions.track.rows[0].label, 'Tecnicatura');
  assert.equal(reading.dimensions.track.total.sources.matricula, 7, 'la carrera quedó escrita en la matrícula');
  assert.equal(reading.gaps.find((entry) => entry.reason === 'sede_sin_declarar').count, 1);
  assert.equal(reading.dimensions.campus.total.active, 2);
  assert.equal(reading.dimensions.campus.total.rate, 33);

  // Cada identidad del piloto aparece exactamente una vez en cada dimensión.
  for (const userId of PILOT_IDS) {
    const row = stores.rows.find((entry) => entry.subjectId === 'arq-software-2026' && entry.userId === userId);
    assert.ok(row.campus === 'Monserrat' && row.track === 'Tecnicatura', `${userId} con sede y carrera asignadas`);
  }
});

test('backfill sin sede declarada: la lectura muestra el corte «sin sede declarada» y lo declara', async () => {
  const stores = pilotStores();
  await runAdoptionBackfill({ stores, apply: true });
  const reading = buildAdoptionReading({
    subjects: FIXTURE.subjects,
    enrollments: stores.rows,
    profiles: stores.profileRows,
    activeUserIdsBySubject: {},
  });

  assert.equal(reading.integrity.orphanPeople, 0);
  const campus = reading.dimensions.campus;
  assert.equal(campus.total.cohort, 6);
  assert.equal(campus.rows.length, 1);
  assert.equal(campus.rows[0].unassigned, true);
  assert.equal(campus.rows[0].label, 'Sin sede declarada');
  const gap = reading.gaps.find((entry) => entry.reason === 'sede_sin_declarar');
  assert.equal(gap.count, 6);
});

test('backfill no pisa una sede o carrera ya declarada y reporta el conflicto', () => {
  const enrollments = [
    { subjectId: 'arq-software-2026', userId: 'alu-001', role: 'student', status: 'active', campus: 'Recoleta', track: 'Licenciatura' },
  ];
  const plan = planAdoptionBackfill({
    enrollments,
    profiles: {},
    subjects: FIXTURE.subjects,
    campusMap: { 'alu-001': 'Monserrat' },
    trackMap: { 'alu-001': 'Tecnicatura' },
  });

  assert.equal(plan.summary.enrollmentPatches, 0, 'lo declarado no se toca');
  assert.equal(plan.conflicts.length, 2);
  assert.deepEqual(
    plan.conflicts.map((conflict) => `${conflict.field}=${conflict.current}->${conflict.proposed}`).sort(),
    ['campus=Recoleta->Monserrat', 'track=Licenciatura->Tecnicatura'],
  );
});

test('backfill toma la sede del perfil cuando la matrícula no la trae', () => {
  const plan = planAdoptionBackfill({
    enrollments: [{ subjectId: 'arq-software-2026', userId: 'alu-002', role: 'student', status: 'active' }],
    profiles: new Map([['alu-002', { campus: 'Belgrano', track: 'Tecnicatura' }]]),
    subjects: FIXTURE.subjects,
  });

  const patch = plan.enrollments.find((entry) => entry.userId === 'alu-002');
  assert.equal(patch.campus, 'Belgrano');
  assert.equal(patch.campusSource, 'perfil');
  assert.equal(patch.track, 'Tecnicatura');
  assert.equal(patch.trackSource, 'perfil');
  assert.equal(plan.unassigned.campus, 0);
  assert.equal(plan.unassigned.track, 0);
});

test('runAdoptionBackfill en dry-run no escribe nada', async () => {
  const stores = pilotStores();
  const result = await runAdoptionBackfill({ stores, apply: false });
  assert.equal(result.applied, false);
  assert.equal(stores.writes.length, 0);
  assert.equal(result.plan.summary.enrollmentPatches, 7);
});
