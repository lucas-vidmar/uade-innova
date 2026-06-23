import {
    USE_MOCK, BASE_URL, apiFetch, fetchWithTimeout, delay
} from './core.js';

import { getMock } from './mocks/accessor.js';

export async function getDeadlines(subjectId) {
    if (USE_MOCK) {
        await delay(350);
        const mocks = await getMock('MOCK_DEADLINES', []);
        return mocks.filter(item => item.subjectId === subjectId);
    }

    try {
        const res = await fetchWithTimeout(`${BASE_URL}/deadlines?subjectId=${subjectId}`, { timeout: 3000 });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error('[API] getDeadlines failed:', err);
        return [];
    }
}

export async function saveDeadline(payload) {
    if (USE_MOCK) {
        return {
            ...payload,
            id: payload.id || `deadline-${Date.now()}`,
            createdAt: payload.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
    }

    const res = await apiFetch(`${BASE_URL}/deadlines`, {
        method: payload.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        throw new Error(`Error ${res.status}: No se pudo guardar el deadline`);
    }

    return res.json();
}

export async function deleteDeadline(subjectId, deadlineId) {
    if (USE_MOCK) {
        await delay(300);
        return { success: true };
    }

    const res = await apiFetch(`${BASE_URL}/deadlines/${deadlineId}?subjectId=${encodeURIComponent(subjectId)}`, {
        method: 'DELETE',
    });

    if (!res.ok) {
        throw new Error(`Error ${res.status}: No se pudo eliminar el deadline`);
    }

    return res.json();
}

export async function getDeadlineReminders(subjectId, today) {
    if (USE_MOCK) {
        const target = today || new Date().toISOString().slice(0, 10);
        const dayBefore = target === '2026-04-29';
        const dayOf = target === '2026-04-30';
        const mocks = await getMock('MOCK_DEADLINES', []);
        return mocks.filter(d => d.subjectId === subjectId && ((dayBefore && d.notifyOnDayBefore) || (dayOf && d.notifyOnDayOf)));
    }

    try {
        const params = new URLSearchParams({ subjectId });
        if (today) params.set('today', today);
        const res = await apiFetch(`${BASE_URL}/deadline-reminders?${params.toString()}`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error('[API] getDeadlineReminders failed:', err);
        return [];
    }
}
