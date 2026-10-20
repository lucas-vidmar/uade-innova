/**
 * adoption-backfill.js — Plan y ejecución del backfill de sede y carrera
 * (#491 / UJ-43).
 *
 * Por qué existe: el modelo previo no tenía sede en ninguna parte (ni en la
 * unidad, ni en la matrícula, ni en el perfil) y la carrera sólo existía en el
 * catálogo de unidades (`track`). La lectura desagregada necesita las dos
 * dimensiones por persona, así que se agregan a la matrícula y al perfil y este
 * plan completa lo que falta en los datos que ya existen.
 *
 * Reglas (todas verificables en el resultado):
 *  1. Nunca pisa un valor declarado. Si el valor propuesto difiere del existente
 *     se informa como conflicto y no se escribe.
 *  2. La sede no se deriva de la unidad: una unidad puede dictarse en más de una
 *     sede, así que sólo se completa desde un mapa declarado (registro del
 *     alumno) o desde el perfil.
 *  3. La carrera sí se deriva: matrícula → mapa declarado → perfil → `track` de
 *     la unidad. La fuente de cada valor queda registrada.
 *  4. Si no hay fuente, no se escribe nada: la persona cae en el corte «sin
 *     declarar» de la lectura (hueco declarado, nunca inventado).
 *  5. Idempotente: correrlo dos veces sobre el mismo estado no produce cambios.
 */

import { normalizeCampus, normalizeDimension, normalizeTrack } from './adoption-dimensions.js';

const STUDENT = 'student';
const ACTIVE = 'active';

function mapLookup(map, subjectId, userId) {
  if (!map || typeof map !== 'object') return null;
  if (subjectId) {
    const scoped = normalizeDimension(map[`${subjectId}:${userId}`]);
    if (scoped) return scoped;
  }
  return normalizeDimension(map[userId]);
}

function asProfileMap(profiles) {
  return profiles instanceof Map ? profiles : new Map(Object.entries(profiles || {}));
}

/**
 * Arma el plan de escritura sin tocar el storage.
 *
 * @param {Object} input
 * @param {Array} input.enrollments Filas actuales de la tabla Enrollments.
 * @param {Map|Object} [input.profiles] Perfiles por userId ({campus, track}).
 * @param {Array} [input.subjects] Catálogo de unidades ({id, track}).
 * @param {Object} [input.campusMap] Sedes declaradas: {"userId"|"subjectId:userId": "Sede"}.
 * @param {Object} [input.trackMap] Carreras declaradas, mismo formato.
 */
export function planAdoptionBackfill({
  enrollments = [],
  profiles = {},
  subjects = [],
  campusMap = {},
  trackMap = {},
} = {}) {
  const profileByUser = asProfileMap(profiles);
  const subjectTrackById = new Map(
    (Array.isArray(subjects) ? subjects : [])
      .map((subject) => [normalizeDimension(subject?.id), normalizeTrack(subject?.track)])
      .filter(([id]) => id),
  );

  const enrollmentPatches = [];
  const conflicts = [];
  const skipped = { read: 0, notStudent: 0, inactive: 0, incomplete: 0 };
  const cohort = new Set();
  let studentActiveEnrollments = 0;
  const campusAssigned = new Set();
  const trackAssigned = new Set();
  const tracksByUser = new Map();

  for (const enrollment of Array.isArray(enrollments) ? enrollments : []) {
    skipped.read += 1;
    const subjectId = normalizeDimension(enrollment?.subjectId);
    const userId = normalizeDimension(enrollment?.userId);
    if (!subjectId || !userId) {
      skipped.incomplete += 1;
      continue;
    }
    const role = String(enrollment?.role || '').trim().toLowerCase();
    const status = String(enrollment?.status || '').trim().toLowerCase();
    if (role !== STUDENT) {
      skipped.notStudent += 1;
      continue;
    }
    if (status !== ACTIVE) {
      skipped.inactive += 1;
      continue;
    }

    studentActiveEnrollments += 1;
    cohort.add(userId);

    const profile = profileByUser.get(userId) || null;
    const currentCampus = normalizeCampus(enrollment?.campus);
    const currentTrack = normalizeTrack(enrollment?.track);
    const profileCampus = normalizeCampus(profile?.campus);
    const profileTrack = normalizeTrack(profile?.track);
    const subjectTrack = subjectTrackById.get(subjectId) || null;

    const declaredCampus = mapLookup(campusMap, subjectId, userId);
    const declaredTrack = mapLookup(trackMap, subjectId, userId);

    if (declaredCampus && currentCampus && declaredCampus !== currentCampus) {
      conflicts.push({ scope: 'enrollment', subjectId, userId, field: 'campus', current: currentCampus, proposed: declaredCampus });
    }
    if (declaredTrack && currentTrack && declaredTrack !== currentTrack) {
      conflicts.push({ scope: 'enrollment', subjectId, userId, field: 'track', current: currentTrack, proposed: declaredTrack });
    }

    const patch = { subjectId, userId };
    if (!currentCampus) {
      const proposedCampus = declaredCampus || profileCampus;
      if (proposedCampus) {
        patch.campus = proposedCampus;
        patch.campusSource = declaredCampus ? 'mapa' : 'perfil';
      }
    }
    if (!currentTrack) {
      const proposedTrack = declaredTrack || profileTrack || subjectTrack;
      if (proposedTrack) {
        patch.track = proposedTrack;
        patch.trackSource = declaredTrack ? 'mapa' : (profileTrack ? 'perfil' : 'unidad');
      }
    }
    if (patch.campus || patch.track) enrollmentPatches.push(patch);

    if (patch.campus || currentCampus) campusAssigned.add(userId);
    const effectiveTrack = currentTrack || patch.track || null;
    if (effectiveTrack) {
      trackAssigned.add(userId);
      if (!tracksByUser.has(userId)) tracksByUser.set(userId, new Set());
      tracksByUser.get(userId).add(effectiveTrack);
    }
  }

  // Perfiles: se completan con lo mismo que la matrícula. La carrera sólo se
  // copia al perfil cuando la persona tiene una sola en toda la cohorte; con dos
  // carreras el perfil no puede elegir por ella.
  const profilePatches = [];
  for (const userId of Array.from(cohort).sort()) {
    const profile = profileByUser.get(userId) || null;
    const currentCampus = normalizeCampus(profile?.campus);
    const currentTrack = normalizeTrack(profile?.track);
    const declaredCampus = mapLookup(campusMap, null, userId);
    const declaredTrack = mapLookup(trackMap, null, userId);
    const tracks = tracksByUser.get(userId) || new Set();
    const singleTrack = tracks.size === 1 ? Array.from(tracks)[0] : null;

    const patch = { userId };
    if (!currentCampus && declaredCampus) patch.campus = declaredCampus;
    if (!currentTrack && (declaredTrack || singleTrack)) patch.track = declaredTrack || singleTrack;
    if (patch.campus || patch.track) profilePatches.push(patch);
  }

  return {
    cohort: {
      enrollmentsRead: skipped.read,
      studentActive: studentActiveEnrollments,
      people: cohort.size,
    },
    skipped,
    // Lo que el plan NO puede completar. Es exactamente lo que la lectura va a
    // mostrar en su corte «sin declarar»: hueco declarado, no inventado.
    unassigned: {
      campus: Array.from(cohort).filter((userId) => !campusAssigned.has(userId)).length,
      track: Array.from(cohort).filter((userId) => !trackAssigned.has(userId)).length,
    },
    enrollments: enrollmentPatches,
    profiles: profilePatches,
    conflicts,
    summary: {
      enrollmentPatches: enrollmentPatches.length,
      profilePatches: profilePatches.length,
      campusPatched: enrollmentPatches.filter((patch) => patch.campus).length,
      trackPatched: enrollmentPatches.filter((patch) => patch.track).length,
      conflicts: conflicts.length,
    },
  };
}

/**
 * Ejecuta el plan contra los stores inyectados. `apply: false` (default) deja
 * el plan como dry-run: no escribe nada.
 */
export async function runAdoptionBackfill({
  stores,
  apply = false,
  campusMap = {},
  trackMap = {},
  now = () => new Date(),
} = {}) {
  if (!stores || typeof stores.listEnrollments !== 'function') {
    throw new Error('runAdoptionBackfill requires stores.listEnrollments');
  }
  const [enrollments, profiles, subjects] = await Promise.all([
    stores.listEnrollments(),
    typeof stores.listProfiles === 'function' ? stores.listProfiles() : new Map(),
    typeof stores.loadSubjects === 'function' ? stores.loadSubjects() : [],
  ]);

  const plan = planAdoptionBackfill({ enrollments, profiles, subjects, campusMap, trackMap });
  const result = {
    generatedAt: now().toISOString(),
    applied: false,
    plan,
  };

  if (!apply) return result;

  for (const patch of plan.enrollments) {
    await stores.patchEnrollment(patch);
  }
  for (const patch of plan.profiles) {
    await stores.patchProfile(patch);
  }
  result.applied = true;
  result.written = {
    enrollments: plan.enrollments.length,
    profiles: plan.profiles.length,
  };
  return result;
}
