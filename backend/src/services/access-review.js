/**
 * services/access-review.js — Revisión periódica de permisos con evidencia (UJ-53).
 *
 * El recorrido pide tres cosas que antes no existían en ninguna parte:
 *
 *   1. un inventario de identidades activas con su rol, sus permisos vigentes y
 *      el acto con que cada permiso se otorgó (dueño, motivo y fecha);
 *   2. que un permiso sin ese acto quede marcado como **huérfano** en vez de
 *      disimularse entre los que sí lo tienen;
 *   3. que sostener / reducir / retirar un permiso quede con su responsable y su
 *      efecto aplicado, y que el conjunto se pueda firmar y revisar por un
 *      tercero que no participó de la revisión.
 *
 * El inventario no se arma con lo que la pantalla muestra: se arma con lo que la
 * tabla `Users` tiene. Un permiso cuyo acto no está asentado sale huérfano por
 * más que la fila se vea prolija. El `digest` del inventario es lo que un
 * tercero puede recalcular para llegar a las mismas conclusiones, y lo que la
 * firma congela.
 *
 * Los permisos vigentes de un rol son los alcances que la aplicación le concede
 * (los mismos que aplican los `withAuth({ roles })` de cada endpoint). Están
 * declarados acá en un solo lugar para que el inventario los pueda enumerar.
 */

import { createHash } from 'node:crypto';
import { CONFIG } from './config.js';
import { getTableClient } from './storage.js';

const TABLE = CONFIG.tables.accessReview;
const META_PARTITION = '_meta';
const CURRENT_REVIEW_KEY = 'current';
const SIGNATURE_KEY = 'signature';
export const DEFAULT_REVIEW_ID = 'ronda-inicial';

export const DECISIONS = ['sostener', 'reducir', 'retirar'];
const ROLE_LADDER = ['student', 'teacher', 'director', 'admin'];

/**
 * Permisos vigentes por rol: lo que cada rol alcanza hoy en la aplicación.
 * Refleja los `roles:` declarados por los endpoints (`withAuth`). Si un endpoint
 * cambia su gate, esta lista es la que hay que mover.
 */
export const ROLE_CAPABILITIES = {
  student: [
    'ver clases de sus materias matriculadas',
    'chatear con el asistente dentro de su alcance',
    'leer materiales publicados',
    'entregar tareas y rendir quizzes',
    'impugnar una calificación',
  ],
  teacher: [
    'gestionar clases y materiales de sus materias',
    'cargar y corregir transcripciones',
    'publicar y retirar clases',
    'responder consultas del alumnado',
    'reportar respuestas para corrección',
  ],
  director: [
    'leer el panel de dirección y sus KPI',
    'leer la administración de usuarios (sin escribir)',
    'leer políticas de retención y archivo en frío',
    'leer la revisión de accesos',
    'gestionar intervenciones y umbrales de riesgo',
  ],
  admin: [
    'crear, editar, deshabilitar y eliminar identidades',
    'resetear credenciales y revocar sesiones',
    'configurar el modelo de IA y las versiones de prompts',
    'definir políticas de retención y ejecutar resguardos',
    'aplicar decisiones de la revisión de accesos',
    'firmar el acta de revisión',
  ],
};

const ensuredTables = new Set();

async function ensureTable() {
  if (ensuredTables.has(TABLE)) return;
  const client = getTableClient(TABLE);
  try {
    await client.createTable();
  } catch (err) {
    if (err.statusCode !== 409) throw err;
  }
  ensuredTables.add(TABLE);
}

function validationError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/**
 * Permisos vigentes de un rol.
 * @param {string} role
 * @returns {string[]}
 */
export function capabilitiesForRole(role) {
  return ROLE_CAPABILITIES[String(role || '').toLowerCase()] || [];
}

/**
 * Evidencia del acto de otorgamiento del permiso vigente de una identidad.
 * Huérfano = falta cualquiera de los tres datos (dueño, motivo o fecha).
 * @param {Object} user fila de la tabla Users
 * @returns {{dueño: string|null, motivo: string|null, fecha: string|null, completa: boolean, falta: string[], huerfano: boolean}}
 */
export function permissionEvidence(user) {
  const dueño = user?.grantedBy || null;
  const motivo = user?.grantReason || null;
  const fecha = user?.grantedAt || null;
  const falta = [];
  if (!dueño) falta.push('dueño');
  if (!fecha) falta.push('fecha');
  if (!motivo) falta.push('motivo');
  return { dueño, motivo, fecha, completa: falta.length === 0, falta, huerfano: falta.length > 0 };
}

/**
 * Evidencia del acto que fijó el estado vigente (activo / deshabilitado).
 * @param {Object} user
 */
export function statusEvidence(user) {
  const dueño = user?.statusChangedBy || null;
  const motivo = user?.statusChangeReason || null;
  const fecha = user?.statusChangedAt || null;
  const falta = [];
  if (!dueño) falta.push('dueño');
  if (!fecha) falta.push('fecha');
  if (!motivo) falta.push('motivo');
  return { dueño, motivo, fecha, completa: falta.length === 0, falta, huerfano: falta.length > 0 };
}

/**
 * Digest canónico del inventario: lo que un tercero recalcula para comprobar que
 * el acta que le entregaron describe el mismo conjunto que él está mirando.
 * @param {Array<Object>} entries
 * @returns {string} sha256 hex
 */
export function digestOf(entries) {
  const canonical = (entries || [])
    .map((e) => [
      e.userId,
      e.role,
      e.status,
      (e.permisos || []).join('|'),
      e.evidencia?.dueño || '',
      e.evidencia?.fecha || '',
      e.evidencia?.motivo || '',
    ].join('~'))
    .sort()
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Arma el inventario de identidades con su rol, sus permisos vigentes y el acto
 * con que cada permiso se otorgó.
 *
 * #551: el inventario de permisos por rol dice qué concede el rol, no qué
 * alcanza la persona. Cuando el llamador pasa `reachById` (derivado de
 * matrículas y jerarquía por `services/identity-reach.js`), cada entrada lleva
 * además su `alcance` con la fuente de cada ítem. El digest del acta no cambia
 * de significado: sigue siendo el de permisos/estado/acto, y el alcance lleva el
 * suyo propio (`alcance.digest`).
 *
 * @param {Array<Object>} users filas de la tabla Users
 * @param {{generatedAt?: string, reachById?: Object<string, Object>|null}} [options]
 */
export function buildAccessReview(users, { generatedAt = new Date().toISOString(), reachById = null } = {}) {
  const entries = (users || [])
    .map((user) => {
      const evidencia = permissionEvidence(user);
      const estado = statusEvidence(user);
      const permisos = capabilitiesForRole(user.role);
      const alcance = reachById ? (reachById[user.userId] || null) : null;
      return {
        userId: user.userId,
        name: user.name || null,
        email: user.email || null,
        role: user.role,
        status: user.status || 'active',
        activa: (user.status || 'active') !== 'disabled',
        permisos,
        alcance,
        evidencia: { ...evidencia, estado },
        huerfano: evidencia.huerfano,
        falta: evidencia.falta,
        createdAt: user.createdAt || null,
      };
    })
    .sort((a, b) => String(a.userId).localeCompare(String(b.userId)));

  const activas = entries.filter((e) => e.activa);
  const huerfanos = activas.filter((e) => e.huerfano);
  const conAlcance = activas.filter((e) => e.alcance);
  const resumen = {
    identidades: entries.length,
    activas: activas.length,
    permisosVigentes: activas.reduce((n, e) => n + e.permisos.length, 0),
    conEvidencia: activas.length - huerfanos.length,
    huerfanos: huerfanos.length,
  };
  if (conAlcance.length > 0) {
    resumen.alcance = {
      identidades: conAlcance.length,
      unidades: conAlcance.reduce((n, e) => n + (e.alcance.totales?.unidades || 0), 0),
      encuentros: conAlcance.reduce((n, e) => n + (e.alcance.totales?.encuentros || 0), 0),
      materiales: conAlcance.reduce((n, e) => n + (e.alcance.totales?.materiales || 0), 0),
      permisosEspeciales: conAlcance.reduce((n, e) => n + (e.alcance.permisosEspeciales || []).length, 0),
      responsabilidadesAbiertas: conAlcance.reduce((n, e) => n + (e.alcance.responsabilidadesAbiertas || []).length, 0),
    };
  }

  return {
    generatedAt,
    resumen,
    entries,
    huerfanos: huerfanos.map((e) => ({ userId: e.userId, role: e.role, falta: e.falta })),
    digest: digestOf(entries),
  };
}

/**
 * El acta en CSV, para que un tercero la pueda leer fuera de la aplicación.
 *
 * #551: las columnas de alcance van al final para no romper el contrato que ya
 * consumían las actas exportadas (identidad, rol, estado, permisos, evidencia),
 * y traen el detalle derivado de matrículas y jerarquía con sus totales.
 *
 * @param {Object} review salida de buildAccessReview
 * @param {Object} [extra] { reviewId, estado, firma, decisiones }
 */
export function reviewCsv(review, extra = {}) {
  const q = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;
  const reachSummary = (e) => {
    const a = e.alcance;
    if (!a) return [q(''), q(''), q(''), q(''), q('')];
    const t = a.totales || {};
    return [
      q((a.unidades || []).map((u) => `${u.unidadId}${u.acceso?.contenido === 'completo' ? '' : ` [${u.acceso?.contenido || ''}]`}`).join('; ')),
      q(`${t.encuentros || 0} de ${(t.encuentros || 0) + (t.encuentrosNoAlcanzables || 0)} alcanzables`),
      q(`${t.materiales || 0} alcanzable${(t.materiales || 0) === 1 ? '' : 's'}`),
      q((a.permisosEspeciales || []).map((p) => p.tipo).join('; ')),
      q((a.responsabilidadesAbiertas || []).map((r) => `${r.tipo}${r.unidadId ? `@${r.unidadId}` : ''}`).join('; ')),
    ];
  };
  const lines = ['identidad,rol,estado,permisos,evidencia_dueno,evidencia_fecha,evidencia_motivo,huerfano,falta,unidades,encuentros,material,permisos_especiales,responsabilidades_abiertas'];
  for (const e of review.entries || []) {
    lines.push([
      q(e.userId), q(e.role), q(e.status), q((e.permisos || []).join('; ')),
      q(e.evidencia?.dueño), q(e.evidencia?.fecha), q(e.evidencia?.motivo),
      q(e.huerfano ? 'si' : 'no'), q((e.falta || []).join('; ')),
      ...reachSummary(e),
    ].join(','));
  }
  lines.push(`resumen,,,,,,,,,identidades=${review.resumen.identidades};activas=${review.resumen.activas};permisos=${review.resumen.permisosVigentes};conEvidencia=${review.resumen.conEvidencia};huerfanos=${review.resumen.huerfanos}`);
  if (review.resumen?.alcance) {
    const a = review.resumen.alcance;
    lines.push(`alcance,,,,,,,,,unidades=${a.unidades};encuentros=${a.encuentros};material=${a.materiales};permisosEspeciales=${a.permisosEspeciales};responsabilidadesAbiertas=${a.responsabilidadesAbiertas}`);
  }
  lines.push(`digest,,,,,,,,,${review.digest}`);
  if (extra.reviewId) lines.push(`ronda,,,,,,,,,${extra.reviewId}`);
  if (extra.estado) lines.push(`estado_acta,,,,,,,,,${extra.estado}`);
  if (extra.firma) lines.push(`firma,,,,,,,,,${extra.firma.signedBy || ''};${extra.firma.signedAt || ''};${extra.firma.digest || ''}`);
  for (const d of extra.decisiones || []) {
    lines.push(`decision,${q(d.userId)},${q(d.decision)},${q(d.reason)},${q(d.decidedBy)},${q(d.decidedAt)},${q(d.efecto?.rolAntes)}->${q(d.efecto?.rolDespues)},${q(d.efecto?.estadoAntes)}->${q(d.efecto?.estadoDespues)}`);
  }
  return lines.join('\n');
}

/**
 * Valida una decisión sobre un permiso. Sin motivo no hay decisión: el recorrido
 * exige responsable y efecto, y un cambio sin motivo es exactamente lo que deja
 * un permiso huérfano en la ronda siguiente.
 * @param {{decision?: string, reason?: string}} input
 */
export function validateDecision({ decision, reason } = {}) {
  const d = String(decision || '').trim().toLowerCase();
  if (!DECISIONS.includes(d)) {
    throw validationError(400, 'INVALID_DECISION', `La decisión debe ser una de: ${DECISIONS.join(', ')}.`);
  }
  const r = String(reason || '').trim();
  if (!r) {
    throw validationError(400, 'MISSING_REASON', 'Toda decisión sobre un permiso requiere motivo.');
  }
  return { decision: d, reason: r };
}

/**
 * Efecto de una decisión sobre el permiso: qué rol y qué estado quedan.
 * `sostener` no cambia nada, `reducir` baja un escalón el rol, `retirar`
 * deshabilita la identidad.
 * @param {{role?: string, status?: string}} entry
 * @param {string} decision
 */
export function effectFor(entry, decision) {
  const role = String(entry?.role || '').toLowerCase();
  const status = entry?.status || 'active';
  if (decision === 'sostener') return { role, status };
  if (decision === 'reducir') {
    const i = ROLE_LADDER.indexOf(role);
    const target = i > 0 ? ROLE_LADDER[i - 1] : 'student';
    return { role: target, status };
  }
  if (decision === 'retirar') return { role, status: 'disabled' };
  throw validationError(400, 'INVALID_DECISION', `La decisión debe ser una de: ${DECISIONS.join(', ')}.`);
}

// ─── Persistencia de la ronda (tabla AccessReview) ───────────────────────────

/**
 * Ronda vigente. Si nadie abrió una, es la ronda inicial.
 */
export async function currentReviewId() {
  await ensureTable();
  const client = getTableClient(TABLE);
  try {
    const entity = await client.getEntity(META_PARTITION, CURRENT_REVIEW_KEY);
    return entity.reviewId || DEFAULT_REVIEW_ID;
  } catch {
    return DEFAULT_REVIEW_ID;
  }
}

/**
 * Abre una ronda nueva (la siguiente revisión periódica).
 * @param {{actor?: string, now?: string}} [options]
 */
export async function startReview({ actor = null, now = new Date().toISOString() } = {}) {
  await ensureTable();
  const reviewId = `ronda-${now.replace(/[:.]/g, '-')}`;
  const client = getTableClient(TABLE);
  await client.upsertEntity({
    partitionKey: META_PARTITION,
    rowKey: CURRENT_REVIEW_KEY,
    reviewId,
    startedBy: actor || null,
    startedAt: now,
  }, 'Replace');
  return reviewId;
}

/**
 * Asienta una decisión aplicada: qué se decidió, quién lo decidió, cuándo, por
 * qué y qué efecto quedó.
 */
export async function recordDecision({
  reviewId, userId, decision, reason, decidedBy, efecto, digestBefore = null, digestAfter = null,
  now = new Date().toISOString(),
}) {
  await ensureTable();
  const client = getTableClient(TABLE);
  const entity = {
    partitionKey: reviewId || DEFAULT_REVIEW_ID,
    rowKey: `${now}-${userId}`,
    userId,
    decision,
    reason,
    decidedBy: decidedBy || null,
    decidedAt: now,
    rolAntes: efecto?.rolAntes ?? null,
    rolDespues: efecto?.rolDespues ?? null,
    estadoAntes: efecto?.estadoAntes ?? null,
    estadoDespues: efecto?.estadoDespues ?? null,
    digestBefore,
    digestAfter,
  };
  await client.upsertEntity(entity, 'Replace');
  return {
    userId, decision, reason,
    decidedBy: entity.decidedBy,
    decidedAt: now,
    efecto: { rolAntes: entity.rolAntes, rolDespues: entity.rolDespues, estadoAntes: entity.estadoAntes, estadoDespues: entity.estadoDespues },
  };
}

/**
 * Decisiones asentadas en la ronda.
 */
export async function listDecisions(reviewId) {
  await ensureTable();
  const client = getTableClient(TABLE);
  const part = reviewId || DEFAULT_REVIEW_ID;
  const out = [];
  try {
    for await (const e of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${part}'` } })) {
      if (e.rowKey === SIGNATURE_KEY) continue;
      out.push({
        userId: e.userId, decision: e.decision, reason: e.reason,
        decidedBy: e.decidedBy || null, decidedAt: e.decidedAt || null,
        efecto: { rolAntes: e.rolAntes ?? null, rolDespues: e.rolDespues ?? null, estadoAntes: e.estadoAntes ?? null, estadoDespues: e.estadoDespues ?? null },
      });
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));
}

/**
 * Firma del acta de la ronda (o null si todavía no se firmó).
 */
export async function readSignature(reviewId) {
  await ensureTable();
  const client = getTableClient(TABLE);
  try {
    const e = await client.getEntity(reviewId || DEFAULT_REVIEW_ID, SIGNATURE_KEY);
    return { signedBy: e.signedBy || null, signedAt: e.signedAt || null, digest: e.digest || null, note: e.note || null, decisiones: e.decisiones ?? null };
  } catch {
    return null;
  }
}

/**
 * Firma el acta: congela el digest de lo aplicado, quién firma y cuántas
 * decisiones respalda. Un acta firmada no acepta más decisiones.
 */
export async function signReview({ reviewId, signedBy, digest, note = null, decisiones = 0, now = new Date().toISOString() }) {
  await ensureTable();
  const client = getTableClient(TABLE);
  const entity = {
    partitionKey: reviewId || DEFAULT_REVIEW_ID,
    rowKey: SIGNATURE_KEY,
    signedBy: signedBy || null,
    signedAt: now,
    digest: digest || null,
    note,
    decisiones,
  };
  await client.upsertEntity(entity, 'Replace');
  return { signedBy: entity.signedBy, signedAt: now, digest: entity.digest, note, decisiones };
}

export const _internals = { META_PARTITION, CURRENT_REVIEW_KEY, SIGNATURE_KEY, ROLE_LADDER };
