/**
 * services/identity-reach.js — Alcance efectivo de una identidad (#551).
 *
 * El recorrido de UJ-52 paso 2 pide el inventario de **todo lo que la identidad
 * alcanza hoy**: unidades, encuentros, material, permisos especiales y
 * responsabilidades abiertas. Hasta #549/#550 la revisión de permisos entregaba
 * la lista fija de capacidades del rol (`ROLE_CAPABILITIES`), que es la misma
 * para las diez identidades de un mismo rol y no dice qué unidad, qué encuentro
 * ni qué material alcanza cada persona.
 *
 * Este módulo deriva el alcance de lo que el producto ya tiene registrado, en
 * este orden y sin inventar nada:
 *
 *   matrícula (Enrollments)  →  unidad (materia)
 *   unidad                   →  encuentro (Classes.scope = subjectId)
 *   encuentro                →  material (Materials.classIds)
 *   rol global               →  todas las unidades del catálogo (subjects.json)
 *
 * Cada ítem viaja con su `fuente`: la fila concreta de la que se derivó. Si un
 * dato no se puede leer, el ítem no se inventa: se omite y se declara el aviso
 * en `avisos`. El `digest` del alcance permite que un tercero compruebe que el
 * inventario que le entregaron es el mismo que está mirando.
 *
 * Reglas de visibilidad (las mismas que aplican los endpoints, no una política
 * nueva):
 *   - matrícula docente en la unidad → todas las clases y materiales de la unidad;
 *   - matrícula de alumnado         → sólo encuentros `publicado` y el material
 *                                     colgado de esos encuentros (#428);
 *   - rol Director                  → `get-classes` saltea el control de
 *                                     matrícula (`if (!isDirector)`), así que
 *                                     alcanza el contenido de toda unidad;
 *   - rol Admin                     → `get-subjects` es global, pero
 *                                     `get-classes` NO lo exime: sin matrícula
 *                                     responde 403 «No tienes acceso a esta
 *                                     materia». Por eso su unidad se declara
 *                                     `contenido: 'requiere-matricula'` y no se
 *                                     le atribuyen encuentros ni material.
 */

import { createHash } from 'node:crypto';
import { CONFIG } from './config.js';
import { listAllClasses, listAllMaterials, listAllEnrollments } from './state-store.js';
import { resolveClassPublicationState } from './publication-state.js';

/** Roles con alcance sobre todo el catálogo, sin matrícula. */
export const GLOBAL_REACH_ROLES = ['admin', 'director'];

/**
 * Roles cuyo alcance global incluye el contenido de la unidad. `Admin` queda
 * afuera a propósito: el endpoint de clases le exige matrícula (medido, 403).
 */
export const CONTENT_GLOBAL_ROLES = ['director'];

/** Tope de materiales enumerados por unidad, para que el inventario no crezca sin límite. */
export const MAX_MATERIALES_POR_UNIDAD = 100;

const FUENTE_MATRICULA = 'Enrollments (PartitionKey=unidad, RowKey=userId, role, status)';
const FUENTE_CATALOGO = 'subjects.json (contenedor classes-config: id, name, professorIds)';
const FUENTE_CLASES = 'Classes (PartitionKey=unidad, RowKey=classId, publicationState, professorIds)';
const FUENTE_MATERIALES = 'Materials (PartitionKey=unidad, RowKey=materialId, classIds)';
const FUENTE_USUARIO = 'Users (PartitionKey=users, RowKey=userId, role, status)';

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeStringArray(parsed);
    } catch {
      return [value.trim()];
    }
  }
  return [];
}

function normalizeSubject(subject) {
  const id = String(subject?.id || '').trim();
  if (!id) return null;
  return {
    id,
    name: String(subject?.name || '').trim() || null,
    group: String(subject?.group || '').trim() || null,
    professorIds: normalizeStringArray(subject?.professorIds),
  };
}

function roleOf(value) {
  return String(value || '').trim().toLowerCase();
}

function isActive(enrollment) {
  return String(enrollment?.status || '').trim().toLowerCase() === 'active';
}

/**
 * Fuente legible de una matrícula: la fila concreta y lo que dice.
 * @param {Object} enrollment
 */
export function enrollmentSource(enrollment) {
  if (!enrollment) return null;
  return `${FUENTE_MATRICULA}: ${enrollment.subjectId}/${enrollment.userId} role=${enrollment.role} status=${enrollment.status || 'active'}`;
}

/**
 * Fuente legible de un encuentro.
 * @param {Object} encuentro
 */
export function classSource(encuentro) {
  if (!encuentro) return null;
  return `${FUENTE_CLASES}: ${encuentro.subjectId}/${encuentro.id} publicationState=${encuentro.publicationState || 'desconocido'} professors=${(encuentro.professorIds || []).length}`;
}

/**
 * Fuente legible de un material.
 */
export function materialSource(material) {
  if (!material) return null;
  return `${FUENTE_MATERIALES}: ${material.subjectId}/${material.materialId || material.id}`;
}

/**
 * Digest canónico del alcance: una línea por ítem derivado. Un tercero recalcula
 * sobre el JSON que recibió y compara.
 * @param {Object} reach
 * @returns {string} sha256 hex
 */
export function reachDigest(reach) {
  const lines = [];
  for (const unidad of reach?.unidades || []) {
    lines.push(['unidad', unidad.unidadId, unidad.acceso?.via || '', unidad.acceso?.contenido || '', `noAlcanzables=${unidad.encuentrosNoAlcanzables || 0}`].join('~'));
    for (const encuentro of unidad.encuentros || []) {
      lines.push(['encuentro', unidad.unidadId, encuentro.encuentroId, encuentro.estado || '', encuentro.alcanzable ? 'si' : 'no'].join('~'));
    }
    for (const material of unidad.material?.items || []) {
      lines.push(['material', unidad.unidadId, material.materialId, (material.encuentros || []).join(',')].join('~'));
    }
    for (const alerta of unidad.alertas || []) {
      lines.push(['alerta', unidad.unidadId, alerta.tipo].join('~'));
    }
  }
  for (const permiso of reach?.permisosEspeciales || []) {
    lines.push(['permiso-especial', permiso.tipo, permiso.unidadId || '', permiso.encuentroId || ''].join('~'));
  }
  for (const responsabilidad of reach?.responsabilidadesAbiertas || []) {
    lines.push(['responsabilidad', responsabilidad.tipo, responsabilidad.unidadId || '', responsabilidad.encuentroId || ''].join('~'));
  }
  return createHash('sha256').update(lines.sort().join('\n')).digest('hex');
}

/**
 * Alcance efectivo de una identidad, derivado de matrículas y jerarquía.
 *
 * Función pura: recibe todo lo que se leyó y no toca storage. Así la prueba
 * puede fijar el mismo estado que el piloto sin depender de Azure.
 *
 * @param {Object} input
 * @param {Object} input.user fila de Users
 * @param {Array<Object>} [input.enrollments] todas las matrículas
 * @param {Array<Object>} [input.subjects] catálogo de unidades
 * @param {Array<Object>} [input.classes] todos los encuentros
 * @param {Array<Object>} [input.materials] todos los materiales
 * @param {number} [input.adminsActivos] identidades Admin activas
 * @param {boolean} [input.catalogoLeido] si el catálogo de unidades se pudo leer
 */
export function buildIdentityReach({
  user,
  enrollments = [],
  subjects = [],
  classes = [],
  materials = [],
  adminsActivos = 0,
  catalogoLeido = true,
} = {}) {
  const userId = user?.userId || null;
  const role = roleOf(user?.role);
  const status = String(user?.status || 'active').toLowerCase();
  const esGlobal = GLOBAL_REACH_ROLES.includes(role);
  const contenidoGlobal = CONTENT_GLOBAL_ROLES.includes(role);

  const avisos = [];
  const propias = (enrollments || []).filter((e) => e && e.userId === userId);
  const activas = propias.filter(isActive);

  const catalogo = new Map();
  for (const subject of subjects || []) {
    const norm = normalizeSubject(subject);
    if (norm) catalogo.set(norm.id, norm);
  }
  if (!catalogoLeido) {
    avisos.push('No se pudo leer el catálogo de unidades (subjects.json): las unidades se identifican por su id de matrícula, sin nombre.');
  }

  // Docentes y alumnado activos por unidad: sale de las matrículas, no de la nómina
  // declarada, para poder contrastar las dos fuentes.
  const docentesPorUnidad = new Map();
  const alumnosPorUnidad = new Map();
  for (const enrollment of enrollments || []) {
    if (!enrollment || !isActive(enrollment) || !enrollment.subjectId) continue;
    const target = roleOf(enrollment.role) === 'teacher' ? docentesPorUnidad : (roleOf(enrollment.role) === 'student' ? alumnosPorUnidad : null);
    if (!target) continue;
    const list = target.get(enrollment.subjectId) || [];
    list.push(enrollment.userId);
    target.set(enrollment.subjectId, list);
  }

  const clasesPorUnidad = new Map();
  for (const encuentro of classes || []) {
    if (!encuentro || !encuentro.subjectId || !encuentro.id) continue;
    const list = clasesPorUnidad.get(encuentro.subjectId) || [];
    list.push(encuentro);
    clasesPorUnidad.set(encuentro.subjectId, list);
  }
  const materialesPorUnidad = new Map();
  for (const material of materials || []) {
    if (!material || !material.subjectId) continue;
    const key = material.subjectId;
    const list = materialesPorUnidad.get(key) || [];
    list.push(material);
    materialesPorUnidad.set(key, list);
  }

  const matriculaPorUnidad = new Map(activas.filter((e) => e.subjectId).map((e) => [e.subjectId, e]));

  const unidadIds = [];
  if (esGlobal) for (const id of catalogo.keys()) unidadIds.push(id);
  for (const id of matriculaPorUnidad.keys()) if (!unidadIds.includes(id)) unidadIds.push(id);

  const permisosEspeciales = [];
  const responsabilidadesAbiertas = [];
  const unidades = [];

  if (esGlobal) {
    permisosEspeciales.push({
      tipo: 'alcance-global',
      descripcion: contenidoGlobal
        ? `Alcanza todas las unidades del catálogo sin matrícula (rol ${role}) y también su contenido.`
        : `Alcanza todas las unidades del catálogo sin matrícula (rol ${role}); el contenido de la unidad no, porque /api/classes le exige matrícula.`,
      fuente: `${FUENTE_USUARIO}: ${userId}.role=${role}`,
    });
  }

  for (const unidadId of unidadIds.sort()) {
    const subject = catalogo.get(unidadId) || null;
    const enrollment = matriculaPorUnidad.get(unidadId) || null;
    const enrollmentRole = roleOf(enrollment?.role);
    let via;
    let contenido;
    let fuenteAcceso;

    if (enrollment) {
      via = 'matricula';
      contenido = enrollmentRole === 'teacher' ? 'completo' : 'solo-publicado';
      fuenteAcceso = enrollmentSource(enrollment);
    } else if (contenidoGlobal) {
      via = 'rol-global';
      contenido = 'completo';
      fuenteAcceso = `${FUENTE_USUARIO}: ${userId}.role=${role} (get-subjects: alcance sin matrícula)`;
    } else {
      via = 'rol-global';
      contenido = 'requiere-matricula';
      fuenteAcceso = `${FUENTE_USUARIO}: ${userId}.role=${role} (get-subjects: alcance sin matrícula)`;
    }

    const docentes = docentesPorUnidad.get(unidadId) || [];
    const nomina = subject?.professorIds || [];
    const encuentrosDeLaUnidad = (clasesPorUnidad.get(unidadId) || [])
      .map((encuentro) => {
        const estado = resolveClassPublicationState(encuentro);
        const publicado = estado === 'publicado';
        // Lo que la identidad alcanza, según la regla de visibilidad de su acceso:
        // docente y dirección ven el borrador; el alumnado, sólo lo publicado.
        const alcanzable = contenido === 'completo' ? true : (contenido === 'solo-publicado' ? publicado : false);
        return {
          encuentroId: encuentro.id,
          titulo: encuentro.title || null,
          fecha: encuentro.date || null,
          estado,
          publicado,
          alcanzable,
          fuente: classSource(encuentro),
        };
      })
      .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

    // El inventario enumera lo que alcanza; lo que existe y no alcanza se declara
    // como cantidad, para que no se lea como si lo alcanzara.
    const encuentros = encuentrosDeLaUnidad.filter((e) => e.alcanzable);
    const encuentrosNoAlcanzables = encuentrosDeLaUnidad.length - encuentros.length;
    const idsAlcanzables = new Set(encuentros.map((e) => e.encuentroId));
    const materialesDeLaUnidad = materialesPorUnidad.get(unidadId) || [];
    const materialesAlcanzables = contenido === 'requiere-matricula'
      ? []
      : materialesDeLaUnidad.filter((material) => {
        const classIds = normalizeStringArray(material.classIds || material.classId);
        if (contenido === 'completo') return true;
        return classIds.some((id) => idsAlcanzables.has(id));
      });

    const itemsMaterial = materialesAlcanzables.slice(0, MAX_MATERIALES_POR_UNIDAD).map((material) => ({
      materialId: material.materialId || material.id || null,
      nombre: material.filename || null,
      encuentros: normalizeStringArray(material.classIds || material.classId),
      fuente: materialSource(material),
    }));

    const alertas = [];
    if (docentes.length === 0) {
      alertas.push({
        tipo: 'unidad-sin-docente',
        descripcion: 'La unidad no tiene ninguna matrícula docente activa: no puede quedar así antes del corte.',
        fuente: `${FUENTE_MATRICULA} (role=teacher, status=active, unidad=${unidadId})`,
      });
    }
    const nominaSinMatricula = nomina.filter((id) => !docentes.includes(id));
    if (nominaSinMatricula.length > 0) {
      alertas.push({
        tipo: 'nomina-sin-matricula',
        descripcion: `La nómina declara ${nominaSinMatricula.length} docente(s) sin matrícula activa en la unidad.`,
        fuente: `${FUENTE_CATALOGO} vs ${FUENTE_MATRICULA}`,
      });
    }
    if (contenido === 'requiere-matricula') {
      alertas.push({
        tipo: 'contenido-requiere-matricula',
        descripcion: 'El rol alcanza la unidad en la administración pero no su contenido: /api/classes exige matrícula activa y responde 403 sin ella.',
        fuente: `${FUENTE_USUARIO}: ${userId}.role=${role}`,
      });
    }
    if (enrollment && !subject) {
      alertas.push({
        tipo: 'unidad-fuera-del-catalogo',
        descripcion: 'La matrícula apunta a una unidad que no está en el catálogo vigente.',
        fuente: enrollmentSource(enrollment),
      });
    }

    unidades.push({
      unidadId,
      nombre: subject?.name || null,
      grupo: subject?.group || null,
      acceso: { via, rol: enrollmentRole || 'global', estado: enrollment?.status || 'active', contenido, fuente: fuenteAcceso },
      docentes: {
        activos: docentes.length,
        nomina: nomina.length,
        unicoDocente: docentes.length === 1 && docentes[0] === userId,
        fuente: `${FUENTE_MATRICULA}`,
      },
      encuentros,
      encuentrosNoAlcanzables,
      material: {
        total: materialesDeLaUnidad.length,
        alcanzables: materialesAlcanzables.length,
        truncado: materialesAlcanzables.length > MAX_MATERIALES_POR_UNIDAD,
        items: itemsMaterial,
        fuente: FUENTE_MATERIALES,
      },
      alertas,
    });

    // Permisos especiales: lo que la identidad alcanza y no viene ni del rol ni
    // de la matrícula vigente de la unidad.
    if (enrollment && enrollmentRole === 'teacher' && nomina.length > 0 && !nomina.includes(userId)) {
      permisosEspeciales.push({
        tipo: 'docencia-sin-nomina',
        descripcion: `Dicta la unidad ${unidadId} con matrícula docente activa pero no figura en su nómina de docentes.`,
        unidadId,
        fuente: `${enrollmentSource(enrollment)} vs ${FUENTE_CATALOGO}`,
      });
    }
    if (enrollment && enrollmentRole !== role && role !== 'admin' && role !== 'director') {
      permisosEspeciales.push({
        tipo: 'matricula-con-rol-distinto',
        descripcion: `La matrícula de ${unidadId} es de rol ${enrollmentRole || 'sin rol'} y la identidad tiene rol ${role}.`,
        unidadId,
        fuente: `${enrollmentSource(enrollment)} vs ${FUENTE_USUARIO}`,
      });
    }
    if (!enrollment && subject && (nomina.includes(userId))) {
      permisosEspeciales.push({
        tipo: 'docencia-sin-matricula',
        descripcion: `Figura en la nómina de ${unidadId} sin matrícula activa en la unidad.`,
        unidadId,
        fuente: `${FUENTE_CATALOGO} vs ${FUENTE_MATRICULA}`,
      });
    }

    // Responsabilidades abiertas: lo que quedaría sin responsable si se corta.
    if (enrollment && enrollmentRole === 'teacher' && docentes.length === 1 && docentes[0] === userId) {
      responsabilidadesAbiertas.push({
        tipo: 'unica-docente-unidad',
        descripcion: `Es la única persona con matrícula docente activa en ${unidadId}; sin reasignación, la unidad queda sin responsable.`,
        unidadId,
        fuente: `${FUENTE_MATRICULA} (role=teacher, status=active, unidad=${unidadId})`,
      });
    }
  }

  // Encuentros donde figura sin matrícula en la unidad, y encuentros publicados
  // que dependen de una sola persona.
  for (const [unidadId, lista] of clasesPorUnidad.entries()) {
    const subject = catalogo.get(unidadId) || null;
    const enrollment = matriculaPorUnidad.get(unidadId) || null;
    for (const encuentro of lista) {
      const profesores = normalizeStringArray(encuentro.professorIds);
      const alumnos = normalizeStringArray(encuentro.studentIds);
      const figura = profesores.includes(userId) || alumnos.includes(userId);
      if (!figura) continue;
      if (!enrollment && subject) {
        permisosEspeciales.push({
          tipo: 'encuentro-sin-matricula',
          descripcion: `Figura en el encuentro ${encuentro.id} de ${unidadId} sin matrícula activa en la unidad.`,
          unidadId,
          encuentroId: encuentro.id,
          fuente: classSource(encuentro),
        });
      }
      const estado = resolveClassPublicationState(encuentro);
      if (estado === 'publicado' && profesores.length === 1 && profesores[0] === userId) {
        responsabilidadesAbiertas.push({
          tipo: 'unico-docente-encuentro',
          descripcion: `Es el único docente del encuentro publicado ${encuentro.id} de ${unidadId}.`,
          unidadId,
          encuentroId: encuentro.id,
          fuente: classSource(encuentro),
        });
      }
    }
  }

  if (role === 'admin' && status === 'active' && adminsActivos === 1) {
    responsabilidadesAbiertas.push({
      tipo: 'unico-admin-activo',
      descripcion: 'Es la única identidad Admin activa: el corte deja la revisión de accesos sin quien aplique y firme decisiones.',
      fuente: `${FUENTE_USUARIO} (role=admin, status=active: 1 identidad)`,
    });
  }

  const totales = {
    unidades: unidades.length,
    encuentros: unidades.reduce((n, u) => n + u.encuentros.length, 0),
    encuentrosNoAlcanzables: unidades.reduce((n, u) => n + (u.encuentrosNoAlcanzables || 0), 0),
    materiales: unidades.reduce((n, u) => n + u.material.alcanzables, 0),
    permisosEspeciales: permisosEspeciales.length,
    responsabilidadesAbiertas: responsabilidadesAbiertas.length,
  };

  const reach = {
    regla: 'matrículas activas + jerarquía unidad → encuentro → material, más permisos especiales y responsabilidades abiertas',
    identidad: { userId, rol: role || null, estado: status },
    unidades,
    totales,
    permisosEspeciales,
    responsabilidadesAbiertas,
    avisos,
  };
  reach.digest = reachDigest(reach);
  return reach;
}

/**
 * Lee las fuentes del alcance. Una fuente que falla no rompe el inventario: se
 * devuelve vacía y queda declarada en `avisos` (nunca se rellena con datos
 * supuestos).
 *
 * El catálogo de unidades vive en un blob (`subjects.json`) al que se llega por
 * import dinámico: así el módulo se puede cargar en entornos de prueba donde el
 * storage está mockeado sin esa función, y en ese caso el alcance se arma igual
 * desde las matrículas, sin nombres.
 *
 * @returns {Promise<{subjects: Array, classes: Array, materials: Array, enrollments: Array, catalogoLeido: boolean, avisos: string[]}>}
 */
export async function loadReachSources() {
  const avisos = [];

  const safe = async (label, fn) => {
    try {
      const value = await fn();
      return value;
    } catch (err) {
      avisos.push(`No se pudo leer ${label}: ${err?.message || 'error de lectura'}.`);
      return [];
    }
  };

  const [enrollments, classes, materials] = await Promise.all([
    safe('las matrículas (Enrollments)', () => listAllEnrollments()),
    safe('los encuentros (Classes)', () => listAllClasses()),
    safe('los materiales (Materials)', () => listAllMaterials()),
  ]);

  let subjects = [];
  let catalogoLeido = false;
  try {
    const storage = await import('./storage.js');
    if (typeof storage?.loadJson === 'function') {
      const saved = await storage.loadJson(CONFIG.containers.classes, CONFIG.blobs.subjects);
      if (Array.isArray(saved)) {
        subjects = saved.map(normalizeSubject).filter(Boolean);
        catalogoLeido = true;
      }
    }
  } catch (err) {
    avisos.push(`No se pudo leer el catálogo de unidades: ${err?.message || 'error de lectura'}.`);
  }
  if (!catalogoLeido) {
    avisos.push('El catálogo de unidades (subjects.json) no está disponible: las unidades se identifican por el id de la matrícula, sin nombre ni nómina.');
  }

  return {
    subjects: Array.isArray(subjects) ? subjects : [],
    classes: Array.isArray(classes) ? classes : [],
    materials: Array.isArray(materials) ? materials : [],
    enrollments: Array.isArray(enrollments) ? enrollments : [],
    catalogoLeido,
    avisos,
  };
}

export const _internals = { normalizeSubject, normalizeStringArray };
