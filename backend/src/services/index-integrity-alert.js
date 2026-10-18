/**
 * Alerta de integridad del índice de conocimiento.
 *
 * Cuando una consulta descarta fragmentos porque su material no figura en el
 * registro autoritativo de la unidad (vectores que quedaron en el índice con el
 * `subjectId` equivocado, los que el propio índice clasifica `orphan`), el
 * docente y la dirección tienen que enterarse: esos fragmentos no se citan más,
 * pero el índice sigue sucio y hay que regularizarlo.
 *
 * El aviso va por el canal de notificaciones por unidad que el producto ya usa
 * (el mismo por el que viajan las disputas de nota), con un identificador
 * determinista por unidad: las detecciones sucesivas ACTUALIZAN el mismo aviso
 * en vez de acumular uno por consulta, y hay una ventana de enfriamiento para no
 * escribir en cada pregunta.
 */
import { getEnrollmentsBySubject } from './state-store.js';
import { listUsers } from './users-store.js';
import {
  listNotificationsBySubject,
  upsertNotificationForSubject,
} from './notification-store.js';

export const INDEX_INTEGRITY_COOLDOWN_MS = 30 * 60 * 1000;

export function indexIntegrityNotificationId(subjectId) {
  return `integridad-indice-${String(subjectId)}`;
}

/**
 * Destinatarios: docentes activos de la unidad + dirección y administración.
 * @returns {Promise<string[]>}
 */
export async function resolveIndexIntegrityRecipients(subjectId) {
  const destinatarios = new Set();

  try {
    const matriculas = await getEnrollmentsBySubject(subjectId);
    matriculas
      .filter((e) => e.role === 'teacher' && e.status === 'active')
      .forEach((e) => { if (e.userId) destinatarios.add(String(e.userId)); });
  } catch {
    // sin matrículas legibles seguimos con dirección
  }

  try {
    const usuarios = await listUsers();
    usuarios
      .filter((u) => (u.role === 'director' || u.role === 'admin') && u.status === 'active')
      .forEach((u) => { if (u.userId) destinatarios.add(String(u.userId)); });
  } catch {
    // dirección es complementaria: si no se puede leer, el aviso sale igual
  }

  return [...destinatarios];
}

/**
 * Deja (o refresca) el aviso de integridad de la unidad. Best-effort: nunca
 * interrumpe la respuesta al usuario.
 *
 * @param {object} params
 * @param {string} params.subjectId
 * @param {string[]} params.droppedMaterialIds materiales descartados en esta consulta
 * @param {object} [params.context] contexto de la Function, para el log
 * @param {string} [params.now] ISO timestamp
 * @returns {Promise<{ notified: boolean, reason?: string, recipients?: number }>}
 */
export async function alertIndexIntegrity({ subjectId, droppedMaterialIds = [], droppedClassIds = [], context, now = new Date().toISOString() } = {}) {
  if (!subjectId || (droppedMaterialIds.length === 0 && droppedClassIds.length === 0)) {
    return { notified: false, reason: 'sin-datos' };
  }

  try {
    const id = indexIntegrityNotificationId(subjectId);
    const actuales = await listNotificationsBySubject(subjectId);
    const previo = actuales.find((n) => n.id === id);

    if (previo?.createdAt) {
      const edad = Date.parse(now) - Date.parse(previo.createdAt);
      if (Number.isFinite(edad) && edad >= 0 && edad < INDEX_INTEGRITY_COOLDOWN_MS) {
        return { notified: false, reason: 'enfriamiento' };
      }
    }

    const recipients = await resolveIndexIntegrityRecipients(subjectId);
    const detalle = [];
    if (droppedMaterialIds.length > 0) {
      const muestra = droppedMaterialIds.slice(0, 3).join(', ');
      const resto = droppedMaterialIds.length > 3 ? ` y ${droppedMaterialIds.length - 3} más` : '';
      detalle.push(`${droppedMaterialIds.length} material/es que no figuran en la unidad (${muestra}${resto})`);
    }
    if (droppedClassIds.length > 0) {
      const muestra = droppedClassIds.slice(0, 3).join(', ');
      const resto = droppedClassIds.length > 3 ? ` y ${droppedClassIds.length - 3} más` : '';
      detalle.push(`${droppedClassIds.length} clase/s que no existen en la unidad (${muestra}${resto})`);
    }

    await upsertNotificationForSubject(subjectId, {
      id,
      type: 'integrity',
      title: 'El índice de la unidad tiene material que no le pertenece',
      message: `Se descartaron fragmentos al responder: ${detalle.join(' y ')}. No se citan en las respuestas hasta regularizarlos.`,
      createdAt: now,
      unread: true,
      targetHash: '#/teacher/dashboard',
      subjectId,
      recipientUserIds: recipients,
      origin: 'rag-registry-filter',
    });

    context?.log?.(`[IndexIntegrity] aviso dejado para ${recipients.length} destinatario/s (subjectId=${subjectId}, materiales=${droppedMaterialIds.length}, clases=${droppedClassIds.length})`);
    return { notified: true, recipients: recipients.length };
  } catch (err) {
    context?.error?.('[IndexIntegrity] No se pudo dejar el aviso de integridad:', err);
    return { notified: false, reason: 'error' };
  }
}
