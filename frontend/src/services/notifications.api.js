import {
    BASE_URL, apiFetch, fetchWithTimeout, parseApiError
} from './core.js';

function normalizeNotification(item = {}, idx = 0) {
    const fallbackId = item.id || `notif-${Date.now()}-${idx}`;
    const type = ['grade', 'summary', 'material', 'deadline'].includes(item.type) ? item.type : 'material';
    return {
        id: fallbackId,
        type,
        title: String(item.title || 'Nueva notificación'),
        message: String(item.message || 'Tienes una actualización académica.'),
        createdAt: item.createdAt || new Date().toISOString(),
        unread: item.unread !== false,
        targetHash: item.targetHash || '#/student/dashboard',
        subjectId: item.subjectId || null,
    };
}

export async function getNotifications({ userId, subjectId, limit = 10, skip = 0, type } = {}) {
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    if (subjectId) params.set('subjectId', subjectId);
    if (limit) params.set('limit', String(limit));
    if (skip > 0) params.set('skip', String(skip));
    if (type) params.set('type', type);

    const query = params.toString();
    const res = await fetchWithTimeout(`${BASE_URL}/notifications${query ? `?${query}` : ''}`, { timeout: 3500 });

    if (!res.ok) throw await parseApiError(res, `Error ${res.status}: no se pudieron cargar las notificaciones.`);

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
        .map((item, idx) => normalizeNotification(item, idx))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, Math.min(Math.max(Number(limit) || 10, 1), 50));
}

export async function markNotificationRead({ notificationId, userId, subjectId } = {}) {
    if (!notificationId || !userId || !subjectId) {
        throw new Error('Missing required fields: notificationId, userId, subjectId');
    }

    const res = await apiFetch(`${BASE_URL}/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, subjectId }),
    });

    if (!res.ok) {
        throw await parseApiError(res, `Error ${res.status}: No se pudo marcar la notificación como leída`);
    }

    return res.json();
}

export async function markNotificationsRead({ notificationIds = [], userId, subjectId } = {}) {
    if (!userId || !subjectId) {
        throw new Error('Missing required fields: userId, subjectId');
    }

    const ids = Array.isArray(notificationIds)
        ? Array.from(new Set(notificationIds.map((item) => String(item || '').trim()).filter(Boolean)))
        : [];

    const res = await apiFetch(`${BASE_URL}/notifications/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, subjectId, notificationIds: ids }),
    });

    if (!res.ok) {
        throw await parseApiError(res, `Error ${res.status}: No se pudieron marcar las notificaciones como leídas`);
    }

    return res.json();
}

export async function dispatchClassPublishNotification({ subjectId, classId } = {}) {
    if (!subjectId || !classId) {
        throw new Error('Missing required fields: subjectId, classId');
    }

    const res = await apiFetch(`${BASE_URL}/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, classId }),
    });

    if (!res.ok) {
        let message = `Error ${res.status}: No se pudo enviar la notificación de publicación`;
        try {
            const payload = await res.json();
            if (payload?.error) message = payload.error;
        } catch {}
        throw new Error(message);
    }

    return res.json();
}

export async function subscribeNotificationStream({ userId, subjectId, signal } = {}, onEvent) {
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    if (subjectId) params.set('subjectId', subjectId);

    const query = params.toString();
    const response = await apiFetch(`${BASE_URL}/notifications/stream${query ? `?${query}` : ''}`, { signal });

    if (!response.ok) {
        // Structured error carrying status + server code so the stream layer
        // can distinguish a hard 403 (stop reconnecting) from transient errors.
        throw await parseApiError(response, `Stream connection failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            if (signal?.aborted) break;
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop();

            if (buffer.length > 50000) {
                buffer = '';
            }

            for (const part of parts) {
                if (!part.trim()) continue;
                const lines = part.split('\n');
                let eventType = 'message';
                let data = null;

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        try {
                            data = JSON.parse(line.slice(6));
                        } catch {}
                    }
                }

                if (data && typeof onEvent === 'function') {
                    onEvent(eventType, data);
                }
            }
        }
    } catch (err) {
        if (signal?.aborted) return;
        throw err;
    }
}
