import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getEnrollment } from '../services/state-store.js';
import * as notificationStore from '../services/notification-store.js';
import { loadJson } from '../services/storage.js';
import { CONFIG } from '../services/config.js';
import { trackNotificationInteraction } from '../services/telemetry.js';
import { structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';

const CONTAINER_CLASSES = CONFIG.containers.classes;

function isTeacherOrDirector(principal) {
  const roles = Array.isArray(principal?.userRoles) ? principal.userRoles : [];
  return roles.includes('Docente') || roles.includes('Director');
}

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

function canMarkNotifications(principal, requestedUserId, contextUser = null) {
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') return true;
  if (!principal) return false;
  const roles = Array.isArray(principal.userRoles) ? principal.userRoles : [];
  if (roles.includes('Director') || roles.includes('Docente')) return true;
  // Application id resolved from the allowlist (Story 10.24) is authoritative
  // for self-scoped operations; a student can only mark their own.
  const principalUserId = contextUser?.id || principal.userId || principal.oid || null;
  return Boolean(principalUserId && requestedUserId && principalUserId === requestedUserId);
}

/**
 * Resolves the effective notification userId for a request. The allowlist-
 * resolved application id (`contextUser.id`, Story 10.24) is authoritative and
 * never overridden by a client-sent `userId`; without it, the raw principal id
 * is used and a mismatched client id is rejected.
 * @returns {{userId: string|null, forbidden: boolean}}
 */
function resolveEffectiveUserId(request, principal, body = null, contextUser = null) {
  const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';

  // Verified allowlist identity: the canonical app id (pilot data key/email).
  // The client-sent `u-<email>` never matches and must not cause a 403.
  const appUserId = contextUser?.id || null;
  if (appUserId) {
    return { userId: appUserId, forbidden: false };
  }

  const principalUserId = principal?.userId || principal?.oid || null;

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
    handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) return structuredErrorResponse(403, 'Forbidden - Invalid Front Door ID', ErrorCategory.AUTH, 'FRONTDOOR_INVALID');
    const principal = parseClientPrincipal(request);
    const { userId, forbidden } = resolveEffectiveUserId(request, principal, null, context.user);
    if (forbidden) {
      const principalUserId = principal?.userId || principal?.oid || 'none';
      const queryUserId = request?.query?.get('userId') || null;
      const attemptedId = queryUserId || 'unknown';
      context.log(`[notifications] Forbidden: userId="${attemptedId}" attempted without matching principal="${principalUserId}"`);
      return structuredErrorResponse(403, 'Forbidden - Notification scope does not match authenticated user', ErrorCategory.AUTH, 'NOTIFICATION_SCOPE');
    }

    if (!userId) {
      context.log(`[notifications] Unauthenticated request rejected`);
      return structuredErrorResponse(401, 'Debes iniciar sesión para ver tus notificaciones.', ErrorCategory.AUTH, 'AUTH_REQUIRED');
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
                    return structuredErrorResponse(403, 'No tienes acceso a las notificaciones de esta materia.', ErrorCategory.AUTH, 'ENROLLMENT_INACTIVE');
                }
            } catch (err) {
                return structuredErrorResponse(500, 'Error verificando permisos.', ErrorCategory.AUTH, 'ENROLLMENT_CHECK_FAILED');
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
  })),
});

app.http('dispatch-class-publish-notification', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'notifications',
    handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) return structuredErrorResponse(403, 'Forbidden - Invalid Front Door ID', ErrorCategory.AUTH, 'FRONTDOOR_INVALID');

    const principal = parseClientPrincipal(request);
    const isDev = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
    if (!isDev && !isTeacherOrDirector(principal)) {
      return structuredErrorResponse(403, 'Forbidden - Docente o Director requerido', ErrorCategory.AUTH, 'FORBIDDEN');
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return structuredErrorResponse(400, 'Invalid JSON payload', ErrorCategory.VALIDATION, 'INVALID_JSON');
    }

    const subjectId = body?.subjectId ? String(body.subjectId) : null;
    const classId = body?.classId ? String(body.classId) : null;
    if (!subjectId || !classId) {
      return structuredErrorResponse(400, 'Missing required fields: subjectId, classId', ErrorCategory.VALIDATION, 'MISSING_FIELDS');
    }

    const userId = context.user?.id || principal?.userId || principal?.oid || 'anonymous';
    const isDirector = principal?.userRoles?.includes('Director');
    if (!isDev && !isDirector) {
      try {
        const enrollment = await getEnrollment(subjectId, userId);
        if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
          context.log(`[notifications] Publish dispatch denied: userId=${userId} subjectId=${subjectId}`);
          return structuredErrorResponse(403, 'No tienes permisos para publicar notificaciones en esta materia.', ErrorCategory.AUTH, 'ENROLLMENT_INACTIVE');
        }
      } catch (err) {
        return structuredErrorResponse(500, 'Error verificando permisos.', ErrorCategory.AUTH, 'ENROLLMENT_CHECK_FAILED');
      }
    }

    try {
      const classes = await loadJson(CONTAINER_CLASSES, `${subjectId}.json`);
      const classData = Array.isArray(classes) ? classes.find((c) => String(c.id) === classId) : null;
      if (!classData) {
        return structuredErrorResponse(404, 'Clase no encontrada', ErrorCategory.NOT_FOUND, 'NOT_FOUND');
      }

      const result = await notificationStore.dispatchClassSummaryNotification({ subjectId, classData, origin: 'class-publish' });
      const notificationId = notificationStore.notificationIdForClass(subjectId, classId);
      context.log(`[notifications] Publish dispatch subjectId=${subjectId} classId=${classId} notificationId=${notificationId} recipients=${result.recipientCount} retries=${result.retryAttempts}`);
      trackNotificationInteraction({ action: 'dispatch_class_publish', status: result.success ? 'success' : 'error', userId, subjectId, notificationId }).catch((err) => context.error('[Telemetry] Error emitting NotificationInteraction:', err));
      if (!result.success) {
        return structuredErrorResponse(500, 'Failed to persist notification', ErrorCategory.STORAGE, 'STORAGE');
      }
      return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, notificationId, recipients: result.recipientCount }) };
    } catch (err) {
      context.error(`[notifications] Publish dispatch failed subjectId=${subjectId} classId=${classId}: ${err.message}`);
      return structuredErrorResponse(500, 'Unable to dispatch notification', ErrorCategory.INTERNAL, 'INTERNAL_ERROR');
    }
  })),
});

app.http('mark-notification-read', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'notifications/{id}/read',
    handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) return structuredErrorResponse(403, 'Forbidden - Invalid Front Door ID', ErrorCategory.AUTH, 'FRONTDOOR_INVALID');

    const notificationId = request.params?.id;
    const body = await request.json().catch(() => ({}));
    const principal = parseClientPrincipal(request);
    const { userId, forbidden } = resolveEffectiveUserId(request, principal, body, context.user);
    const subjectId = body?.subjectId ? String(body.subjectId) : null;
    if (forbidden) {
      const principalUserId = principal?.userId || principal?.oid || 'none';
      const bodyUserId = body?.userId ? String(body.userId) : 'none';
      context.log(`[notifications] Forbidden mark-read: body userId="${bodyUserId}" does not match principal="${principalUserId}"`);
      return structuredErrorResponse(403, 'Forbidden - Notification scope does not match authenticated user', ErrorCategory.AUTH, 'NOTIFICATION_SCOPE');
    }
    if (!notificationId || !subjectId || !userId) return structuredErrorResponse(400, 'Missing required fields: notificationId, subjectId, userId', ErrorCategory.VALIDATION, 'MISSING_FIELDS');
    if (!canMarkNotifications(principal, userId, context.user)) return structuredErrorResponse(403, 'Forbidden - Student access required for own notifications', ErrorCategory.AUTH, 'FORBIDDEN');

    try {
      const notifications = await notificationStore.listNotificationsBySubject(subjectId);
      const target = notifications.find((item) => item.id === notificationId);
      if (!target) return structuredErrorResponse(404, 'Notification not found for subject', ErrorCategory.NOT_FOUND, 'NOT_FOUND');
      if (!canReceiveNotification(target, userId)) return structuredErrorResponse(403, 'Forbidden - Notification does not belong to user', ErrorCategory.AUTH, 'NOTIFICATION_SCOPE');

      const { success: marked, retryAttempts } = await notificationStore.markNotificationReadForUser(subjectId, notificationId, userId);
      context.log(`[notifications] marked as read id=${notificationId} subjectId=${subjectId} userId=${userId} retryAttempts=${retryAttempts}`);
      trackNotificationInteraction({ action: 'mark_read', status: 'success', userId, subjectId, notificationId }).catch((err) => context.error('[Telemetry] Error emitting NotificationInteraction:', err));
      if (!marked) return structuredErrorResponse(500, 'Failed to persist read status', ErrorCategory.STORAGE, 'STORAGE');
      return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: notificationId, unread: false }) };
    } catch (err) {
      context.error(`[notifications] failed to mark read id=${notificationId} subjectId=${subjectId}: ${err.message}`);
      trackNotificationInteraction({ action: 'mark_read', status: 'error', userId, subjectId, notificationId }).catch((telemetryErr) => context.error('[Telemetry] Error emitting NotificationInteraction:', telemetryErr));
      return structuredErrorResponse(500, 'Unable to mark notification as read', ErrorCategory.INTERNAL, 'INTERNAL_ERROR');
    }
  })),
});

app.http('stream-notifications', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'notifications/stream',
    handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) return structuredErrorResponse(403, 'Forbidden - Invalid Front Door ID', ErrorCategory.AUTH, 'FRONTDOOR_INVALID');
    const principal = parseClientPrincipal(request);
    const { userId, forbidden } = resolveEffectiveUserId(request, principal, null, context.user);
    if (forbidden) {
      return structuredErrorResponse(403, 'Forbidden - Notification scope does not match authenticated user', ErrorCategory.AUTH, 'NOTIFICATION_SCOPE');
    }
    if (!userId) {
      return structuredErrorResponse(401, 'Debes iniciar sesión para recibir notificaciones.', ErrorCategory.AUTH, 'AUTH_REQUIRED');
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
            return structuredErrorResponse(403, 'No tienes acceso a las notificaciones de esta materia.', ErrorCategory.AUTH, 'ENROLLMENT_INACTIVE');
          }
        } catch {
          return structuredErrorResponse(500, 'Error verificando permisos.', ErrorCategory.AUTH, 'ENROLLMENT_CHECK_FAILED');
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
  })),
});

app.http('mark-notifications-read', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'notifications/read',
    handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) return structuredErrorResponse(403, 'Forbidden - Invalid Front Door ID', ErrorCategory.AUTH, 'FRONTDOOR_INVALID');
    const principal = parseClientPrincipal(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return structuredErrorResponse(400, 'Invalid JSON payload', ErrorCategory.VALIDATION, 'INVALID_JSON');

    const { userId, forbidden } = resolveEffectiveUserId(request, principal, body, context.user);
    const subjectId = body?.subjectId ? String(body.subjectId) : null;
    const notificationIds = Array.isArray(body?.notificationIds) ? Array.from(new Set(body.notificationIds.map((item) => String(item || '').trim()).filter(Boolean))) : [];

    if (forbidden) {
      const principalUserId = principal?.userId || principal?.oid || 'none';
      const bodyUserId = body?.userId ? String(body.userId) : 'none';
      context.log(`[notifications] Forbidden bulk-mark-read: body userId="${bodyUserId}" does not match principal="${principalUserId}"`);
      return structuredErrorResponse(403, 'Forbidden - Notification scope does not match authenticated user', ErrorCategory.AUTH, 'NOTIFICATION_SCOPE');
    }
    if (!subjectId || !userId) return structuredErrorResponse(400, 'Missing required fields: subjectId, userId', ErrorCategory.VALIDATION, 'MISSING_FIELDS');
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
      return structuredErrorResponse(500, 'Unable to mark notifications as read', ErrorCategory.INTERNAL, 'INTERNAL_ERROR');
    }
  })),
});