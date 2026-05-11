import { app } from '@azure/functions';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getEnrollment } from '../services/state-store.js';
import * as notificationStore from '../services/notification-store.js';
import { trackNotificationInteraction } from '../services/telemetry.js';

const MOCK_NOTIFICATIONS = [
  { id: 'notif-grade-001', type: 'grade', title: 'Nueva nota publicada', message: 'Quiz Online — Estilos Arquitectónicos: 8.5', createdAt: '2026-03-20T11:10:00Z', unread: true, targetHash: '#/student/tasks', subjectId: 'arq-software-2026' },
  { id: 'notif-summary-001', type: 'summary', title: 'Resumen validado por docente', message: 'Clase 2 — Estilos Arquitectónicos ya tiene resumen validado.', createdAt: '2026-03-18T09:00:00Z', unread: true, targetHash: '#/student/dashboard', subjectId: 'arq-software-2026' },
  { id: 'notif-material-001', type: 'material', title: 'Nuevo material disponible', message: 'Se cargó clase2_estilos.pptx en Clase 2.', createdAt: '2026-03-17T18:45:00Z', unread: false, targetHash: '#/student/class/class-02', subjectId: 'arq-software-2026' },
  { id: 'notif-summary-002', type: 'summary', title: 'Resumen validado por docente', message: 'Clase 1 — Introducción ya tiene resumen validado.', createdAt: '2026-03-16T15:20:00Z', unread: false, targetHash: '#/student/dashboard', subjectId: 'diseno-sistemas-2026' },
];

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(Math.max(Math.floor(parsed), 1), 50);
}

function normalizeNotification(item = {}, idx = 0) {
  const type = ['grade', 'summary', 'material', 'deadline'].includes(item.type) ? item.type : 'material';
  return {
    id: item.id || `notif-${Date.now()}-${idx}`,
    type,
    title: String(item.title || 'Nueva notificación'),
    message: String(item.message || 'Tienes una actualización académica.'),
    createdAt: item.createdAt || new Date().toISOString(),
    unread: item.unread !== false,
    targetHash: item.targetHash || '#/student/dashboard',
    subjectId: item.subjectId || null,
    recipientUserIds: Array.isArray(item.recipientUserIds) ? item.recipientUserIds : [],
    readByUserIds: Array.isArray(item.readByUserIds) ? item.readByUserIds : [],
    origin: item.origin || 'seed',
  };
}

function canReceiveNotification(item, userId) {
  if (!userId) return true;
  const recipients = Array.isArray(item?.recipientUserIds) ? item.recipientUserIds : [];
  if (recipients.length === 0) return true;
  return recipients.includes(userId);
}

function canMarkNotifications(principal, requestedUserId) {
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') return true;
  if (!principal) return false;
  const roles = Array.isArray(principal.userRoles) ? principal.userRoles : [];
  if (roles.includes('Director') || roles.includes('Docente')) return true;
  const principalUserId = principal.userId || principal.oid || null;
  return Boolean(principalUserId && requestedUserId && principalUserId === requestedUserId);
}

function resolveEffectiveUserId(request, principal, body = null) {
  const principalUserId = principal?.userId || principal?.oid || null;
  const queryUserId = request?.query?.get('userId') || null;
  const bodyUserId = body?.userId ? String(body.userId) : null;
  const requestedUserId = bodyUserId || queryUserId;
  const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
  
  // Pilot Phase: allow requestedUserId if principal is missing (since we are using CORS directly to functions)
  if (!isDev && requestedUserId && !principalUserId) {
    return { userId: requestedUserId, forbidden: false };
  }
  
  if (!isDev && principalUserId && requestedUserId && principalUserId !== requestedUserId) return { userId: null, forbidden: true };
  return { userId: principalUserId || requestedUserId || null, forbidden: false };
}

async function ensureSeedNotificationPersisted(subjectId, notificationId) {
  const seed = MOCK_NOTIFICATIONS.find((item) => item.id === notificationId && item.subjectId === subjectId);
  if (!seed || typeof notificationStore.upsertNotificationForSubject !== 'function') return false;
  await notificationStore.upsertNotificationForSubject(subjectId, seed);
  return true;
}

function isReadForUser(item, userId) {
  if (!userId) return item.unread === false;
  const readBy = Array.isArray(item?.readByUserIds) ? item.readByUserIds : [];
  return readBy.includes(userId) || item.unread === false;
}

function asPublicNotification(item = {}, idx = 0, userId = null) {
  const normalized = normalizeNotification(item, idx);
  return { ...normalized, unread: !isReadForUser(normalized, userId), readByUserIds: undefined };
}

app.http('get-notifications', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'notifications',
  handler: async (request, context) => {
    if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
    const principal = parseClientPrincipal(request);
    const { userId, forbidden } = resolveEffectiveUserId(request, principal);
    if (forbidden) return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Notification scope does not match authenticated user' }) };

    const subjectId = request.query.get('subjectId') || null;
    const limit = normalizeLimit(request.query.get('limit'));

    // Security Check: Enrollment-based access control
    if (subjectId) {
        const roles = principal?.userRoles || [];
        const isDirector = roles.includes('Director');
        if (!isDirector) {
            try {
                const enrollment = await getEnrollment(subjectId, userId).catch(() => null);
                if (!enrollment || enrollment.status !== 'active') {
                    context.log(`[Enrollment] Notifications access denied: userId=${userId}, subjectId=${subjectId}`);
                    return {
                        status: 403,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ error: 'No tienes acceso a las notificaciones de esta materia.' })
                    };
                }
            } catch (err) {
                return { status: 500, body: JSON.stringify({ error: 'Error verificando permisos.' }) };
            }
        }
    }

    let persisted = [];
    if (subjectId) {
      try { persisted = await notificationStore.listNotificationsBySubject(subjectId); } catch (err) { context.error(`[notifications] error loading persisted notifications for ${subjectId}: ${err.message}`); }
    }

    const data = [...persisted, ...MOCK_NOTIFICATIONS]
      .filter((item) => !subjectId || item.subjectId === subjectId)
      .filter((item) => canReceiveNotification(item, userId))
      .map((item, idx) => asPublicNotification(item, idx, userId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    context.log(`[notifications] returning ${data.length} records (subjectId=${subjectId || 'all'}, userId=${userId || 'anonymous'})`);
    trackNotificationInteraction({ action: 'fetch_feed', status: 'success', userId, subjectId, notificationId: 'feed' }).catch((err) => context.error('[Telemetry] Error emitting NotificationInteraction:', err));
    return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  },
});

app.http('mark-notification-read', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'notifications/{id}/read',
  handler: async (request, context) => {
    if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

    const notificationId = request.params?.id;
    const body = await request.json().catch(() => ({}));
    const principal = parseClientPrincipal(request);
    const { userId, forbidden } = resolveEffectiveUserId(request, principal, body);
    const subjectId = body?.subjectId ? String(body.subjectId) : null;
    if (forbidden) return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Notification scope does not match authenticated user' }) };
    if (!notificationId || !subjectId || !userId) return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing required fields: notificationId, subjectId, userId' }) };
    if (!canMarkNotifications(principal, userId)) return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Student access required for own notifications' }) };

    try {
      let notifications = await notificationStore.listNotificationsBySubject(subjectId);
      let target = notifications.find((item) => item.id === notificationId);
      if (!target) {
        const seeded = await ensureSeedNotificationPersisted(subjectId, notificationId);
        if (!seeded) return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Notification not found for subject' }) };
        notifications = await notificationStore.listNotificationsBySubject(subjectId);
        target = notifications.find((item) => item.id === notificationId);
      }
      if (!target) return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Notification not found for subject' }) };
      if (!canReceiveNotification(target, userId)) return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Notification does not belong to user' }) };

      await notificationStore.markNotificationReadForUser(subjectId, notificationId, userId);
      context.log(`[notifications] marked as read id=${notificationId} subjectId=${subjectId} userId=${userId}`);
      trackNotificationInteraction({ action: 'mark_read', status: 'success', userId, subjectId, notificationId }).catch((err) => context.error('[Telemetry] Error emitting NotificationInteraction:', err));
      return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: notificationId, unread: false }) };
    } catch (err) {
      context.error(`[notifications] failed to mark read id=${notificationId} subjectId=${subjectId}: ${err.message}`);
      trackNotificationInteraction({ action: 'mark_read', status: 'error', userId, subjectId, notificationId }).catch((telemetryErr) => context.error('[Telemetry] Error emitting NotificationInteraction:', telemetryErr));
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unable to mark notification as read' }) };
    }
  },
});

app.http('mark-notifications-read', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'notifications/read',
  handler: async (request, context) => {
    if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
    const principal = parseClientPrincipal(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON payload' }) };

    const { userId, forbidden } = resolveEffectiveUserId(request, principal, body);
    const subjectId = body?.subjectId ? String(body.subjectId) : null;
    const notificationIds = Array.isArray(body?.notificationIds) ? Array.from(new Set(body.notificationIds.map((item) => String(item || '').trim()).filter(Boolean))) : [];

    if (forbidden) return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Notification scope does not match authenticated user' }) };
    if (!subjectId || !userId) return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing required fields: subjectId, userId' }) };
    if (notificationIds.length === 0) return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updated: 0 }) };

    try {
      let updated = 0;
      for (const notificationId of notificationIds) {
        let notifications = await notificationStore.listNotificationsBySubject(subjectId);
        let target = notifications.find((item) => item.id === notificationId);
        if (!target) {
          await ensureSeedNotificationPersisted(subjectId, notificationId);
          notifications = await notificationStore.listNotificationsBySubject(subjectId);
          target = notifications.find((item) => item.id === notificationId);
        }
        if (!target || !canReceiveNotification(target, userId)) continue;
        const marked = await notificationStore.markNotificationReadForUser(subjectId, notificationId, userId);
        if (marked) updated += 1;
      }

      trackNotificationInteraction({ action: 'mark_read_bulk', status: 'success', userId, subjectId, notificationId: `count:${updated}` }).catch((err) => context.error('[Telemetry] Error emitting NotificationInteraction:', err));
      return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updated }) };
    } catch (err) {
      context.error(`[notifications] bulk mark read failed subjectId=${subjectId} userId=${userId}: ${err.message}`);
      trackNotificationInteraction({ action: 'mark_read_bulk', status: 'error', userId, subjectId, notificationId: 'bulk' }).catch((telemetryErr) => context.error('[Telemetry] Error emitting NotificationInteraction:', telemetryErr));
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unable to mark notifications as read' }) };
    }
  },
});