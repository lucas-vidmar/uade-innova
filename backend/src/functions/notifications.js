import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getEnrollment } from '../services/state-store.js';
import * as notificationStore from '../services/notification-store.js';
import { trackNotificationInteraction } from '../services/telemetry.js';

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(Math.max(Math.floor(parsed), 1), 50);
}

function normalizeSkip(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizeNotification(item = {}, idx = 0) {
  const type = ['grade', 'summary', 'material', 'deadline', 'teacher-reminder'].includes(item.type) ? item.type : 'material';
  return {
    id: item.id || `notif-${Date.now()}-${idx}`,
    type,
    title: String(item.title || 'Nueva notificación'),
    message: String(item.message || 'Tienes una actualización académica.'),
    createdAt: item.createdAt ?? new Date().toISOString(),
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
  const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';

  const queryUserId = request?.query?.get('userId') || null;
  const bodyUserId = body?.userId ? String(body.userId) : null;
  const requestedUserId = bodyUserId || queryUserId;

  if (principalUserId) {
    if (requestedUserId && principalUserId !== requestedUserId) {
      return { userId: null, forbidden: true };
    }
    return { userId: principalUserId, forbidden: false };
  }

  if (isDev && requestedUserId) {
    return { userId: requestedUserId, forbidden: false };
  }

  if (requestedUserId && !isDev) {
    return { userId: null, forbidden: true };
  }

  return { userId: null, forbidden: false };
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
    handler: withCorrelation(async (request, context) => {
    if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
    const principal = parseClientPrincipal(request);
    const { userId, forbidden } = resolveEffectiveUserId(request, principal);
    if (forbidden) {
      const principalUserId = principal?.userId || principal?.oid || 'none';
      const queryUserId = request?.query?.get('userId') || null;
      const attemptedId = queryUserId || 'unknown';
      context.log(`[notifications] Forbidden: userId="${attemptedId}" attempted without matching principal="${principalUserId}"`);
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Notification scope does not match authenticated user' }) };
    }

    if (!userId) {
      context.log(`[notifications] Unauthenticated request rejected`);
      return { status: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Debes iniciar sesión para ver tus notificaciones.' }) };
    }

    const subjectId = request.query.get('subjectId') || null;
    const limit = normalizeLimit(request.query.get('limit'));
    const skip = normalizeSkip(request.query.get('skip'));
    const typeFilter = request.query.get('type') || null;

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

    let data = persisted
      .filter((item) => !subjectId || item.subjectId === subjectId)
      .filter((item) => canReceiveNotification(item, userId))
      .map((item, idx) => asPublicNotification(item, idx, userId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (typeFilter) {
      const allowedTypes = typeFilter.split(',').map((t) => t.trim()).filter(Boolean);
      if (allowedTypes.length > 0) {
        data = data.filter((item) => allowedTypes.includes(item.type));
      }
    }

    data = data.slice(skip, skip + limit);

    context.log(`[notifications] returning ${data.length} records (subjectId=${subjectId || 'all'}, userId=${userId || 'anonymous'}, skip=${skip}, type=${typeFilter || 'all'})`);
    trackNotificationInteraction({ action: 'fetch_feed', status: 'success', userId, subjectId, notificationId: 'feed' }).catch((err) => context.error('[Telemetry] Error emitting NotificationInteraction:', err));
    return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }),
});

app.http('mark-notification-read', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'notifications/{id}/read',
    handler: withCorrelation(async (request, context) => {
    if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

    const notificationId = request.params?.id;
    const body = await request.json().catch(() => ({}));
    const principal = parseClientPrincipal(request);
    const { userId, forbidden } = resolveEffectiveUserId(request, principal, body);
    const subjectId = body?.subjectId ? String(body.subjectId) : null;
    if (forbidden) {
      const principalUserId = principal?.userId || principal?.oid || 'none';
      const bodyUserId = body?.userId ? String(body.userId) : 'none';
      context.log(`[notifications] Forbidden mark-read: body userId="${bodyUserId}" does not match principal="${principalUserId}"`);
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Notification scope does not match authenticated user' }) };
    }
    if (!notificationId || !subjectId || !userId) return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing required fields: notificationId, subjectId, userId' }) };
    if (!canMarkNotifications(principal, userId)) return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Student access required for own notifications' }) };

    try {
      const notifications = await notificationStore.listNotificationsBySubject(subjectId);
      const target = notifications.find((item) => item.id === notificationId);
      if (!target) return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Notification not found for subject' }) };
      if (!canReceiveNotification(target, userId)) return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Notification does not belong to user' }) };

      const { success: marked, retryAttempts } = await notificationStore.markNotificationReadForUser(subjectId, notificationId, userId);
      context.log(`[notifications] marked as read id=${notificationId} subjectId=${subjectId} userId=${userId} retryAttempts=${retryAttempts}`);
      trackNotificationInteraction({ action: 'mark_read', status: 'success', userId, subjectId, notificationId }).catch((err) => context.error('[Telemetry] Error emitting NotificationInteraction:', err));
      if (!marked) return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed to persist read status' }) };
      return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: notificationId, unread: false }) };
    } catch (err) {
      context.error(`[notifications] failed to mark read id=${notificationId} subjectId=${subjectId}: ${err.message}`);
      trackNotificationInteraction({ action: 'mark_read', status: 'error', userId, subjectId, notificationId }).catch((telemetryErr) => context.error('[Telemetry] Error emitting NotificationInteraction:', telemetryErr));
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unable to mark notification as read' }) };
    }
  }),
});

app.http('stream-notifications', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'notifications/stream',
    handler: withCorrelation(async (request, context) => {
    if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
    const principal = parseClientPrincipal(request);
    const { userId, forbidden } = resolveEffectiveUserId(request, principal);
    if (forbidden) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Notification scope does not match authenticated user' }) };
    }
    if (!userId) {
      return { status: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Debes iniciar sesión para recibir notificaciones.' }) };
    }

    const subjectId = request.query.get('subjectId') || null;
    const lastPolledAt = request.query.get('since') || null;

    if (subjectId) {
      const roles = principal?.userRoles || [];
      const isDirector = roles.includes('Director');
      if (!isDirector) {
        try {
          const enrollment = await getEnrollment(subjectId, userId).catch(() => null);
          if (!enrollment || enrollment.status !== 'active') {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No tienes acceso a las notificaciones de esta materia.' }) };
          }
        } catch {
          return { status: 500, body: JSON.stringify({ error: 'Error verificando permisos.' }) };
        }
      }
    }

    const encoder = new TextEncoder();
    let closed = false;
    let pollCount = 0;
    let sinceTimestamp = lastPolledAt || new Date(Date.now() - 5000).toISOString();
    let pollInterval = null;

    const sendEvent = (controller, event, data) => {
      if (closed) return;
      try {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      } catch (err) {
        context.error(`[notifications/stream] sendEvent error: ${err.message}`);
        closed = true;
      }
    };

    const stream = new ReadableStream({
      async start(controller) {
        let snapshot;
        if (subjectId) {
          const allItems = await notificationStore.listNotificationsBySubject(subjectId).catch(() => []);
          const nonNull = Array.isArray(allItems) ? allItems : [];
          const snapshotItems = nonNull
            .filter((item) => item.subjectId === subjectId)
            .filter((item) => canReceiveNotification(item, userId))
            .map((item, idx) => asPublicNotification(item, idx, userId))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          snapshot = snapshotItems;
        } else {
          snapshot = [];
        }

        sendEvent(controller, 'snapshot', { notifications: snapshot, userId });

        const cleanup = () => {
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        };

        pollInterval = setInterval(async () => {
          if (closed) { cleanup(); return; }
          pollCount += 1;

          const since = sinceTimestamp;
          let newItems = [];
          if (subjectId) {
            try {
              const persisted = await notificationStore.listNotificationsSince(subjectId, since);
              newItems = persisted
                .filter((item) => canReceiveNotification(item, userId))
                .map((item, idx) => asPublicNotification(item, idx, userId));
              sinceTimestamp = new Date().toISOString();
            } catch (err) {
              context.error(`[notifications/stream] poll error: ${err.message}`);
            }
          }

          for (const item of newItems) {
            if (closed) break;
            sendEvent(controller, 'notification', item);
          }

          if (pollCount % 6 === 0) {
            sendEvent(controller, 'keepalive', { ts: new Date().toISOString() });
          }
        }, 5000);

        request?.signal?.addEventListener('abort', () => {
          closed = true;
          cleanup();
          context.log('[notifications/stream] client disconnected');
        });
      },
      cancel() {
        closed = true;
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      },
    });

    context.log(`[notifications/stream] started userId=${userId} subjectId=${subjectId || 'all'}`);
    return {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      body: stream,
    };
  }),
});

app.http('mark-notifications-read', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'notifications/read',
    handler: withCorrelation(async (request, context) => {
    if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
    const principal = parseClientPrincipal(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON payload' }) };

    const { userId, forbidden } = resolveEffectiveUserId(request, principal, body);
    const subjectId = body?.subjectId ? String(body.subjectId) : null;
    const notificationIds = Array.isArray(body?.notificationIds) ? Array.from(new Set(body.notificationIds.map((item) => String(item || '').trim()).filter(Boolean))) : [];

    if (forbidden) {
      const principalUserId = principal?.userId || principal?.oid || 'none';
      const bodyUserId = body?.userId ? String(body.userId) : 'none';
      context.log(`[notifications] Forbidden bulk-mark-read: body userId="${bodyUserId}" does not match principal="${principalUserId}"`);
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Notification scope does not match authenticated user' }) };
    }
    if (!subjectId || !userId) return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing required fields: subjectId, userId' }) };
    if (notificationIds.length === 0) return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updated: 0 }) };

    try {
      let updated = 0;
      for (const notificationId of notificationIds) {
        const notifications = await notificationStore.listNotificationsBySubject(subjectId);
        const target = notifications.find((item) => item.id === notificationId);
        if (!target || !canReceiveNotification(target, userId)) continue;
        const { success: marked } = await notificationStore.markNotificationReadForUser(subjectId, notificationId, userId);
        if (marked) updated += 1;
      }

      trackNotificationInteraction({ action: 'mark_read_bulk', status: 'success', userId, subjectId, notificationId: `count:${updated}` }).catch((err) => context.error('[Telemetry] Error emitting NotificationInteraction:', err));
      return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updated }) };
    } catch (err) {
      context.error(`[notifications] bulk mark read failed subjectId=${subjectId} userId=${userId}: ${err.message}`);
      trackNotificationInteraction({ action: 'mark_read_bulk', status: 'error', userId, subjectId, notificationId: 'bulk' }).catch((telemetryErr) => context.error('[Telemetry] Error emitting NotificationInteraction:', telemetryErr));
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unable to mark notifications as read' }) };
    }
  }),
});