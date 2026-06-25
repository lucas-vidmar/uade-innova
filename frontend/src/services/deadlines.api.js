import {
    BASE_URL, apiFetch, fetchWithTimeout
} from './core.js';

export async function getDeadlines(subjectId) {
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
    const res = await apiFetch(`${BASE_URL}/deadlines/${deadlineId}?subjectId=${encodeURIComponent(subjectId)}`, {
        method: 'DELETE',
    });

    if (!res.ok) {
        throw new Error(`Error ${res.status}: No se pudo eliminar el deadline`);
    }

    return res.json();
}

export async function getDeadlineReminders(subjectId, today) {
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
