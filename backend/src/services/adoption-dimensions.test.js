import { test } from 'node:test';
import assert from 'node:assert';

import {
  ADOPTION_CRITERIA,
  UNASSIGNED_KEY,
  buildAdoptionReading,
  classifyEnrollment,
  normalizeCampus,
  normalizeTrack,
} from './adoption-dimensions.js';

const SUBJECTS = [
  { id: 'arq', name: 'Arquitectura de Software 2026', track: 'Tecnicatura' },
  { id: 'eco', name: 'Economía Internacional Monetaria 2026', track: 'Licenciatura' },
];

const enroll = (subjectId, userId, extra = {}) => ({
  subjectId,
  userId,
  role: 'student',
  status: 'active',
  ...extra,
});

test('normalizeCampus/normalizeTrack: vacío, null y el centinela no son valores declarados', () => {
  assert.equal(normalizeCampus('  Monserrat '), 'Monserrat');
  assert.equal(normalizeCampus('   '), null);
  assert.equal(normalizeCampus(null), null);
  assert.equal(normalizeCampus(UNASSIGNED_KEY), null);
  assert.equal(normalizeTrack('Tecnicatura'), 'Tecnicatura');
  assert.equal(normalizeTrack(undefined), null);
});

test('classifyEnrollment: la matrícula manda, después el perfil y por último la unidad', () => {
  const fromEnrollment = classifyEnrollment({
    enrollment: enroll('arq', 'alu-1', { campus: 'Recoleta', track: 'Licenciatura' }),
    profile: { campus: 'Monserrat', track: 'Tecnicatura' },
    subject: SUBJECTS[0],
  });
  assert.equal(fromEnrollment.campus, 'Recoleta');
  assert.equal(fromEnrollment.campusSource, 'matricula');
  assert.equal(fromEnrollment.track, 'Licenciatura');
  assert.equal(fromEnrollment.trackSource, 'matricula');

  const fromProfile = classifyEnrollment({
    enrollment: enroll('arq', 'alu-1'),
    profile: { campus: 'Monserrat', track: 'Licenciatura' },
    subject: SUBJECTS[0],
  });
  assert.equal(fromProfile.campus, 'Monserrat');
  assert.equal(fromProfile.campusSource, 'perfil');
  assert.equal(fromProfile.trackSource, 'perfil');

  const fromSubject = classifyEnrollment({
    enrollment: enroll('arq', 'alu-1'),
    profile: null,
    subject: SUBJECTS[0],
  });
  assert.equal(fromSubject.campus, null);
  assert.equal(fromSubject.campusSource, null);
  assert.equal(fromSubject.track, 'Tecnicatura');
  assert.equal(fromSubject.trackSource, 'unidad');
});

test('lectura: cada dimensión trae su propio total y la cohorte no se duplica en los totales', () => {
  const reading = buildAdoptionReading({
    subjects: SUBJECTS,
    enrollments: [
      enroll('arq', 'alu-1', { campus: 'Monserrat' }),
      enroll('arq', 'alu-2', { campus: 'Monserrat' }),
      enroll('eco', 'alu-1', { campus: 'Recoleta' }),
    ],
    profiles: {},
    activeUserIdsBySubject: { arq: ['alu-1', 'alu-2'], eco: [] },
    windowDays: 30,
  });

  const { subject, campus, track } = reading.dimensions;
  assert.equal(subject.total.cohort, 2, 'la cohorte de la dimensión son personas distintas');
  assert.equal(subject.total.active, 2);
  assert.equal(subject.total.rate, 100);
  assert.equal(campus.total.cohort, 2);
  assert.equal(campus.total.rows, 2);
  assert.equal(track.total.cohort, 2);
  assert.equal(track.total.rows, 2);
  assert.equal(reading.criteria, ADOPTION_CRITERIA);

  const arqRow = subject.rows.find((row) => row.key === 'arq');
  assert.equal(arqRow.cohort, 2);
  assert.equal(arqRow.rate, 100);
  const ecoRow = subject.rows.find((row) => row.key === 'eco');
  assert.equal(ecoRow.cohort, 1);
  assert.equal(ecoRow.rate, 0, 'la unidad sin uso se informa 0%, no se rellena');
  assert.equal(ecoRow.active, 0);
});

test('lectura: persona en dos sedes figura en cada corte y se cuenta una vez en el total (con hueco declarado)', () => {
  const reading = buildAdoptionReading({
    subjects: SUBJECTS,
    enrollments: [
      enroll('arq', 'alu-1', { campus: 'Monserrat' }),
      enroll('eco', 'alu-1', { campus: 'Recoleta' }),
      enroll('arq', 'alu-2', { campus: 'Monserrat' }),
    ],
    profiles: {},
    activeUserIdsBySubject: { arq: ['alu-1'] },
  });

  const campus = reading.dimensions.campus;
  assert.equal(campus.total.cohort, 2);
  assert.equal(campus.rows.find((row) => row.key === 'Monserrat').cohort, 2);
  assert.equal(campus.rows.find((row) => row.key === 'Recoleta').cohort, 1);
  assert.equal(reading.integrity.multiBucketCampus, 1);
  assert.ok(reading.gaps.some((gap) => gap.reason === 'persona_en_varias_sedes'));
  assert.equal(reading.integrity.orphanPeople, 0);
});

test('lectura: sin sede declarada la persona cae en su propio corte y el hueco se declara', () => {
  const reading = buildAdoptionReading({
    subjects: SUBJECTS,
    enrollments: [enroll('arq', 'alu-1'), enroll('arq', 'alu-2')],
    profiles: { 'alu-1': { campus: 'Monserrat' } },
    activeUserIdsBySubject: { arq: ['alu-1'] },
  });

  const campus = reading.dimensions.campus;
  assert.equal(campus.rows.length, 2);
  const unassigned = campus.rows.find((row) => row.unassigned);
  assert.ok(unassigned, 'el corte «sin sede declarada» existe');
  assert.equal(unassigned.label, 'Sin sede declarada');
  assert.equal(unassigned.cohort, 1);
  assert.equal(campus.total.cohort, 2, 'nadie queda fuera del total');
  assert.equal(campus.total.sources.perfil, 1);
  assert.equal(campus.total.sources.sin_dato, 1);
  const gap = reading.gaps.find((entry) => entry.reason === 'sede_sin_declarar');
  assert.ok(gap);
  assert.equal(gap.count, 1);
});

test('lectura: sin carrera en matrícula ni perfil se deriva de la unidad y se declara la fuente', () => {
  const reading = buildAdoptionReading({
    subjects: SUBJECTS,
    enrollments: [enroll('arq', 'alu-1')],
    profiles: {},
    activeUserIdsBySubject: {},
  });

  const track = reading.dimensions.track;
  assert.equal(track.rows.length, 1);
  assert.equal(track.rows[0].label, 'Tecnicatura');
  assert.equal(track.rows[0].unassigned, false);
  assert.equal(track.total.sources.unidad, 1);
});

test('lectura: el uso sólo cuenta personas de la cohorte de la unidad', () => {
  const reading = buildAdoptionReading({
    subjects: SUBJECTS,
    enrollments: [enroll('arq', 'alu-1'), { ...enroll('arq', 'alu-2'), status: 'inactive' }],
    profiles: {},
    activeUserIdsBySubject: { arq: ['alu-1', 'alu-2', 'ajeno-1'] },
  });

  const arqRow = reading.dimensions.subject.rows.find((row) => row.key === 'arq');
  assert.equal(arqRow.cohort, 1, 'la matrícula inactiva no entra en la cohorte');
  assert.equal(arqRow.active, 1, 'un usuario activo sin matrícula activa no se cuenta');
  assert.equal(arqRow.rate, 100);
  assert.equal(reading.integrity.enrollmentsSkipped, 1);
});

test('lectura: unidad del catálogo sin matrículas se muestra con cohorte 0 y tasa no calculable', () => {
  const reading = buildAdoptionReading({
    subjects: SUBJECTS,
    enrollments: [enroll('arq', 'alu-1')],
    profiles: {},
    activeUserIdsBySubject: { arq: ['alu-1'] },
  });

  const ecoRow = reading.dimensions.subject.rows.find((row) => row.key === 'eco');
  assert.ok(ecoRow, 'la unidad sin cohorte no desaparece de la lectura');
  assert.equal(ecoRow.cohort, 0);
  assert.equal(ecoRow.rate, null);
  const gap = reading.gaps.find((entry) => entry.reason === 'unidad_sin_cohorte');
  assert.deepEqual(gap.units, ['Economía Internacional Monetaria 2026']);
});

test('lectura: matrícula de una unidad fuera del catálogo se lee por su id y se declara', () => {
  const reading = buildAdoptionReading({
    subjects: SUBJECTS,
    enrollments: [enroll('arq', 'alu-1'), enroll('fantasma', 'alu-9')],
    profiles: {},
    activeUserIdsBySubject: {},
  });

  const row = reading.dimensions.subject.rows.find((entry) => entry.key === 'fantasma');
  assert.equal(row.label, 'fantasma');
  assert.equal(row.cohort, 1);
  assert.deepEqual(reading.integrity.outsideCatalog, ['fantasma']);
  assert.ok(reading.gaps.some((gap) => gap.reason === 'matricula_sin_unidad_en_catalogo'));
});

test('lectura: sin matrículas activas no inventa una tasa', () => {
  const reading = buildAdoptionReading({
    subjects: SUBJECTS,
    enrollments: [],
    profiles: {},
    activeUserIdsBySubject: {},
  });

  assert.equal(reading.integrity.distinctCohort, 0);
  assert.equal(reading.dimensions.subject.total.rate, null);
  assert.equal(reading.dimensions.campus.total.rate, null);
  assert.equal(reading.dimensions.track.total.rate, null);
  assert.equal(reading.dimensions.campus.rows.length, 0);
  assert.equal(reading.integrity.orphanPeople, 0);
});

test('lectura: es determinista con el mismo insumo', () => {
  const input = {
    subjects: SUBJECTS,
    enrollments: [enroll('arq', 'alu-2', { campus: 'Sede B' }), enroll('arq', 'alu-1', { campus: 'Sede A' })],
    profiles: { 'alu-1': { track: 'Tecnicatura' } },
    activeUserIdsBySubject: { arq: ['alu-2'] },
    windowDays: 14,
    generatedAt: '2026-10-20T00:00:00.000Z',
  };
  const a = buildAdoptionReading(input);
  const b = buildAdoptionReading(input);
  assert.deepEqual(a, b);
  assert.deepEqual(
    a.dimensions.campus.rows.map((row) => row.label),
    ['Sede B', 'Sede A'],
    'el orden es estable (cohorte desc, luego etiqueta)',
  );
});
