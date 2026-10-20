/**
 * adoption-dimensions.js — Lectura de adopción desagregada por unidad, sede y
 * carrera (#491 / UJ-43, capacidad DI-01).
 *
 * El recorrido UJ-43 pide la lectura de uso «abierta por unidad, por sede y por
 * carrera», cada dimensión con su propio total, y exige dos garantías:
 *
 *  - paso 5: cada persona contada pertenece a la unidad y a la sede que la
 *    lectura le asigna (nadie se cuenta dos veces dentro de una dimensión);
 *  - paso 7: los huecos se declaran en vez de taparse (unidades sin cohorte,
 *    personas sin sede declarada, carreras con una sola sede).
 *
 * Este módulo no inventa dimensiones: clasifica cada matrícula activa de rol
 * student con lo que el modelo declara, en este orden de precedencia
 * (matrícula → perfil → unidad) y deja constancia de la fuente de cada valor.
 * Si ninguna capa declara el dato, la persona cae en el corte «sin declarar»
 * de esa dimensión: nunca queda huérfana (fuera de todo total).
 */

export const UNASSIGNED_KEY = '__sin_dato__';

export const DIMENSIONS = {
  subject: { key: 'subject', label: 'Unidad', unassignedLabel: 'Unidad sin identificar' },
  campus: { key: 'campus', label: 'Sede', unassignedLabel: 'Sin sede declarada' },
  track: { key: 'track', label: 'Carrera', unassignedLabel: 'Sin carrera declarada' },
};

export const ADOPTION_CRITERIA = 'Uso: persona con al menos una interacción registrada en SessionMetrics dentro de la ventana. Cohorte: matrículas activas de rol student. Tasa: personas de la cohorte con uso / cohorte de la dimensión. Cada dimensión tiene su propio total y los totales cuentan personas distintas: una persona con matrícula en dos unidades figura en cada corte y una sola vez en el total de la dimensión.';

/**
 * Limpia un valor de dimensión (sede o carrera). Devuelve null cuando no hay
 * dato declarado, para que el corte «sin declarar» sea explícito y no un
 * string vacío que después se confunda con un valor real.
 */
export function normalizeDimension(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text === UNASSIGNED_KEY) return null; // el centinela no es un valor declarado
  return text;
}

export function normalizeCampus(value) {
  return normalizeDimension(value);
}

export function normalizeTrack(value) {
  return normalizeDimension(value);
}

function asMap(value) {
  if (value instanceof Map) return value;
  if (value && typeof value === 'object') return new Map(Object.entries(value));
  return new Map();
}

function normalizeSubjectRecord(subject) {
  const id = normalizeDimension(subject?.id);
  if (!id) return null;
  return {
    id,
    name: normalizeDimension(subject?.name) || id,
    track: normalizeTrack(subject?.track),
  };
}

function normalizeEnrollmentRecord(enrollment) {
  const subjectId = normalizeDimension(enrollment?.subjectId);
  const userId = normalizeDimension(enrollment?.userId);
  return {
    subjectId,
    userId,
    role: String(enrollment?.role || '').trim().toLowerCase(),
    status: String(enrollment?.status || '').trim().toLowerCase(),
    campus: normalizeCampus(enrollment?.campus),
    track: normalizeTrack(enrollment?.track),
  };
}

/**
 * Clasifica una matrícula: qué sede y qué carrera le corresponden y de qué capa
 * salió cada valor. La carrera puede derivarse de la unidad (la materia declara
 * `track`); la sede no se deriva de la unidad porque una unidad puede dictarse
 * en más de una sede.
 */
export function classifyEnrollment({ enrollment, profile, subject } = {}) {
  const row = normalizeEnrollmentRecord(enrollment);
  const profileCampus = normalizeCampus(profile?.campus);
  const profileTrack = normalizeTrack(profile?.track);
  const subjectTrack = normalizeTrack(subject?.track);

  const campus = row.campus || profileCampus || null;
  const campusSource = row.campus ? 'matricula' : (profileCampus ? 'perfil' : null);

  const track = row.track || profileTrack || subjectTrack || null;
  const trackSource = row.track ? 'matricula' : (profileTrack ? 'perfil' : (subjectTrack ? 'unidad' : null));

  return {
    subjectId: row.subjectId,
    userId: row.userId,
    campus,
    campusSource,
    track,
    trackSource,
  };
}

function emptyBucket(key, label, extra = {}) {
  return {
    key,
    label,
    unassigned: false,
    cohort: new Set(),
    active: new Set(),
    sources: {},
    ...extra,
  };
}

function bumpSource(bucket, source) {
  const key = source || 'sin_dato';
  bucket.sources[key] = (bucket.sources[key] || 0) + 1;
}

function rateOf(activeCount, cohortCount) {
  if (!cohortCount) return null;
  return Math.min(100, Math.round((activeCount / cohortCount) * 100));
}

function serializeBucket(bucket) {
  const cohort = bucket.cohort.size;
  const active = bucket.active.size;
  return {
    key: bucket.key,
    label: bucket.label,
    unassigned: bucket.unassigned,
    cohort,
    active,
    rate: rateOf(active, cohort),
    subjectIds: bucket.subjectIds ? Array.from(bucket.subjectIds).sort() : undefined,
    sources: bucket.sources,
  };
}

function sortBuckets(a, b) {
  if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
  if (b.cohort !== a.cohort) return b.cohort - a.cohort;
  if (b.active !== a.active) return b.active - a.active;
  return String(a.label).localeCompare(String(b.label), 'es');
}

function distinctUnion(buckets, field) {
  const union = new Set();
  for (const bucket of buckets) for (const value of bucket[field]) union.add(value);
  return union;
}

function countMultiBucket(buckets, field) {
  const seen = new Map();
  for (const bucket of buckets) {
    for (const value of bucket[field]) seen.set(value, (seen.get(value) || 0) + 1);
  }
  let multi = 0;
  for (const count of seen.values()) if (count > 1) multi += 1;
  return multi;
}

/**
 * Construye la lectura de adopción con las tres dimensiones y sus totales.
 *
 * @param {Object} input
 * @param {Array} input.subjects Catálogo de unidades ({id, name, track}).
 * @param {Array} input.enrollments Matrículas ({subjectId, userId, role, status, campus?, track?}).
 * @param {Map|Object} [input.profiles] Perfiles por userId ({campus?, track?}).
 * @param {Object} [input.activeUserIdsBySubject] {subjectId: [userId]} con uso en la ventana.
 * @param {Map|Object} [input.activeUserIds] Conjunto global de personas con uso en la ventana.
 * @param {number} [input.windowDays] Ventana de la lectura.
 * @param {string} [input.generatedAt] Marca de la lectura.
 */
export function buildAdoptionReading({
  subjects = [],
  enrollments = [],
  profiles = {},
  activeUserIdsBySubject = {},
  activeUserIds = [],
  windowDays = null,
  generatedAt = null,
} = {}) {
  const subjectList = (Array.isArray(subjects) ? subjects : []).map(normalizeSubjectRecord).filter(Boolean);
  const subjectById = new Map(subjectList.map((subject) => [subject.id, subject]));
  const profileByUser = asMap(profiles);

  const activeBySubject = new Map();
  for (const [subjectId, users] of Object.entries(activeUserIdsBySubject || {})) {
    const sid = normalizeDimension(subjectId);
    if (!sid) continue;
    activeBySubject.set(sid, new Set((Array.isArray(users) ? users : []).map(normalizeDimension).filter(Boolean)));
  }
  const globalActive = new Set((Array.isArray(activeUserIds) ? activeUserIds : []).map(normalizeDimension).filter(Boolean));
  for (const users of activeBySubject.values()) for (const userId of users) globalActive.add(userId);

  const subjectBuckets = new Map();
  const campusBuckets = new Map();
  const trackBuckets = new Map();

  // Las unidades del catálogo existen en la lectura aunque no tengan matrículas:
  // UJ-43 paso 4 pide ver las unidades con uso nulo en vez de esconderlas.
  for (const subject of subjectList) {
    subjectBuckets.set(subject.id, emptyBucket(subject.id, subject.name, {
      subjectIds: new Set([subject.id]),
      inCatalog: true,
      subjectTrack: subject.track,
    }));
  }

  const integrity = {
    enrollmentsRead: Array.isArray(enrollments) ? enrollments.length : 0,
    enrollmentsCounted: 0,
    enrollmentsSkipped: 0,
    orphanEnrollments: 0,
    profilesRead: profileByUser.size,
    profilesMatched: 0,
    distinctCohort: 0,
    distinctActive: 0,
    outsideCatalog: [],
  };
  const orphanUsers = new Set();
  const peopleWithoutProfile = new Set();

  for (const rawEnrollment of Array.isArray(enrollments) ? enrollments : []) {
    const row = normalizeEnrollmentRecord(rawEnrollment);
    if (!row.userId || !row.subjectId) {
      integrity.orphanEnrollments += 1;
      integrity.enrollmentsSkipped += 1;
      continue;
    }
    if (row.role !== 'student' || row.status !== 'active') {
      integrity.enrollmentsSkipped += 1;
      continue;
    }

    const subject = subjectById.get(row.subjectId) || null;
    const profile = profileByUser.get(row.userId) || null;
    if (profile) integrity.profilesMatched += 1;
    else peopleWithoutProfile.add(row.userId);

    const classified = classifyEnrollment({ enrollment: rawEnrollment, profile, subject });
    integrity.enrollmentsCounted += 1;

    if (!subjectBuckets.has(row.subjectId)) {
      const bucket = emptyBucket(row.subjectId, subject ? subject.name : row.subjectId, {
        subjectIds: new Set([row.subjectId]),
        inCatalog: Boolean(subject),
        subjectTrack: subject ? subject.track : null,
      });
      subjectBuckets.set(row.subjectId, bucket);
    }
    subjectBuckets.get(row.subjectId).cohort.add(row.userId);

    const campusKey = classified.campus || UNASSIGNED_KEY;
    if (!campusBuckets.has(campusKey)) {
      campusBuckets.set(campusKey, emptyBucket(
        campusKey,
        classified.campus || DIMENSIONS.campus.unassignedLabel,
        { unassigned: !classified.campus, subjectIds: new Set() },
      ));
    }
    const campusBucket = campusBuckets.get(campusKey);
    campusBucket.cohort.add(row.userId);
    campusBucket.subjectIds.add(row.subjectId);
    bumpSource(campusBucket, classified.campusSource);

    const trackKey = classified.track || UNASSIGNED_KEY;
    if (!trackBuckets.has(trackKey)) {
      trackBuckets.set(trackKey, emptyBucket(
        trackKey,
        classified.track || DIMENSIONS.track.unassignedLabel,
        { unassigned: !classified.track, subjectIds: new Set() },
      ));
    }
    const trackBucket = trackBuckets.get(trackKey);
    trackBucket.cohort.add(row.userId);
    trackBucket.subjectIds.add(row.subjectId);
    bumpSource(trackBucket, classified.trackSource);
  }

  // Uso: sólo cuentan las personas de la cohorte de cada corte. Un alumno con
  // uso pero sin matrícula activa no entra en la lectura (no pertenece a la
  // unidad) y un alumno de la cohorte sin uso cuenta como cero, no se omite.
  for (const bucket of subjectBuckets.values()) {
    const users = activeBySubject.get(bucket.key) || new Set();
    for (const userId of bucket.cohort) if (users.has(userId)) bucket.active.add(userId);
  }
  for (const bucket of campusBuckets.values()) {
    for (const userId of bucket.cohort) if (globalActive.has(userId)) bucket.active.add(userId);
  }
  for (const bucket of trackBuckets.values()) {
    for (const userId of bucket.cohort) if (globalActive.has(userId)) bucket.active.add(userId);
  }

  const cohortUnion = distinctUnion(subjectBuckets.values(), 'cohort');
  const activeUnion = distinctUnion(subjectBuckets.values(), 'active');
  integrity.distinctCohort = cohortUnion.size;
  integrity.distinctActive = activeUnion.size;
  for (const userId of cohortUnion) {
    if (!profileByUser.has(userId)) orphanUsers.add(userId);
  }

  const catalogMissing = Array.from(subjectBuckets.values())
    .filter((bucket) => !bucket.inCatalog)
    .map((bucket) => bucket.key);
  integrity.outsideCatalog = catalogMissing;

  const toRows = (buckets) => Array.from(buckets.values()).map(serializeBucket).sort(sortBuckets);

  const dimension = (name, buckets) => {
    const rows = toRows(buckets);
    const cohort = distinctUnion(buckets.values(), 'cohort').size;
    const active = distinctUnion(buckets.values(), 'active').size;
    const sources = {};
    for (const bucket of buckets.values()) {
      for (const [source, count] of Object.entries(bucket.sources)) {
        sources[source] = (sources[source] || 0) + count;
      }
    }
    return {
      key: DIMENSIONS[name].key,
      label: DIMENSIONS[name].label,
      rows,
      total: {
        key: 'total',
        label: `Total por ${DIMENSIONS[name].label.toLowerCase()}`,
        cohort,
        active,
        rate: rateOf(active, cohort),
        rows: rows.length,
        sources,
      },
    };
  };

  const reading = {
    generatedAt,
    windowDays,
    criteria: ADOPTION_CRITERIA,
    dimensions: {
      subject: dimension('subject', subjectBuckets),
      campus: dimension('campus', campusBuckets),
      track: dimension('track', trackBuckets),
    },
    integrity: {
      ...integrity,
      peopleWithoutProfile: peopleWithoutProfile.size,
      cohortWithoutProfile: orphanUsers.size,
      multiBucketCampus: countMultiBucket(campusBuckets.values(), 'cohort'),
      multiBucketTrack: countMultiBucket(trackBuckets.values(), 'cohort'),
      // Toda persona de la cohorte cae en exactamente un corte por dimensión
      // (con su valor o en «sin declarar»): las huérfanas tienen que ser 0.
      orphanPeople: countOrphanPeople(cohortUnion, [campusBuckets, trackBuckets]),
    },
  };

  reading.gaps = describeGaps({ reading, subjects: subjectList });
  return reading;
}

/**
 * Cuenta personas de la cohorte que no cayeron en ningún corte de alguna de las
 * dimensiones. Es una verificación estructural: si da > 0 la lectura está
 * perdiendo gente y el panel tiene que decirlo, no taparlo.
 */
function countOrphanPeople(cohortUnion, bucketMaps) {
  if (cohortUnion.size === 0) return 0;
  let orphans = 0;
  for (const buckets of bucketMaps) {
    const accounted = new Set();
    for (const bucket of buckets.values()) for (const userId of bucket.cohort) accounted.add(userId);
    for (const userId of cohortUnion) if (!accounted.has(userId)) orphans += 1;
  }
  return orphans;
}

/**
 * Declara los huecos de la lectura (UJ-43 paso 7). Nunca rellena: cada entrada
 * dice qué no se pudo leer y por qué.
 */
function describeGaps({ reading, subjects }) {
  const gaps = [];
  const { dimensions, integrity } = reading;

  const unassignedCampus = dimensions.campus.rows.filter((row) => row.unassigned);
  if (unassignedCampus.length > 0) {
    const people = unassignedCampus.reduce((sum, row) => sum + row.cohort, 0);
    gaps.push({
      dimension: 'campus',
      reason: 'sede_sin_declarar',
      count: people,
      detail: `${people} persona(s) sin sede declarada: ni la matrícula ni el perfil traen el dato. Se informan en su propio corte en vez de repartirlas entre sedes.`,
    });
  }
  const unassignedTrack = dimensions.track.rows.filter((row) => row.unassigned);
  if (unassignedTrack.length > 0) {
    const people = unassignedTrack.reduce((sum, row) => sum + row.cohort, 0);
    gaps.push({
      dimension: 'track',
      reason: 'carrera_sin_declarar',
      count: people,
      detail: `${people} persona(s) sin carrera declarada: ni la matrícula, ni el perfil, ni la unidad la declaran.`,
    });
  }

  const unitsWithoutCohort = dimensions.subject.rows.filter((row) => row.cohort === 0);
  if (unitsWithoutCohort.length > 0) {
    gaps.push({
      dimension: 'subject',
      reason: 'unidad_sin_cohorte',
      count: unitsWithoutCohort.length,
      units: unitsWithoutCohort.map((row) => row.label),
      detail: 'Unidades abiertas sin personas activas: no hay cohorte sobre la que leer adopción.',
    });
  }

  const unitsWithoutUse = dimensions.subject.rows.filter((row) => row.cohort > 0 && row.active === 0);
  if (unitsWithoutUse.length > 0) {
    gaps.push({
      dimension: 'subject',
      reason: 'unidad_sin_uso',
      count: unitsWithoutUse.length,
      units: unitsWithoutUse.map((row) => row.label),
      detail: 'Unidades con cohorte y sin uso registrado en la ventana: la ausencia se declara como ausencia (0%), no se rellena con el promedio de las demás.',
    });
  }

  if (integrity.outsideCatalog && integrity.outsideCatalog.length > 0) {
    gaps.push({
      dimension: 'subject',
      reason: 'matricula_sin_unidad_en_catalogo',
      count: integrity.outsideCatalog.length,
      units: integrity.outsideCatalog,
      detail: 'Matrículas activas de unidades que no están en el catálogo: se leen por su id, sin nombre ni carrera declarada.',
    });
  }

  const unitsWithoutTrack = (Array.isArray(subjects) ? subjects : []).filter((subject) => !subject.track);
  if (unitsWithoutTrack.length > 0) {
    gaps.push({
      dimension: 'track',
      reason: 'unidad_sin_carrera',
      count: unitsWithoutTrack.length,
      units: unitsWithoutTrack.map((subject) => subject.name || subject.id),
      detail: 'Unidades sin carrera declarada: quien sólo tenga la unidad como fuente cae en «sin carrera declarada».',
    });
  }

  if (integrity.multiBucketCampus > 0) {
    gaps.push({
      dimension: 'campus',
      reason: 'persona_en_varias_sedes',
      count: integrity.multiBucketCampus,
      detail: 'Personas con matrículas en más de una sede: figuran en cada corte, y el total de la dimensión las cuenta una sola vez.',
    });
  }
  if (integrity.multiBucketTrack > 0) {
    gaps.push({
      dimension: 'track',
      reason: 'persona_en_varias_carreras',
      count: integrity.multiBucketTrack,
      detail: 'Personas con matrículas en más de una carrera: figuran en cada corte, y el total de la dimensión las cuenta una sola vez.',
    });
  }
  if (integrity.cohortWithoutProfile > 0) {
    gaps.push({
      dimension: 'campus',
      reason: 'cohorte_sin_perfil',
      count: integrity.cohortWithoutProfile,
      detail: 'Personas de la cohorte sin fila de perfil: la capa de perfil no aportó sede ni carrera para ellas.',
    });
  }

  return gaps;
}
