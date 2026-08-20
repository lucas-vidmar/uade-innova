import {
    BASE_URL, apiFetch, fetchWithTimeout, parseApiError
} from './core.js';

export async function getDirectorStats() {
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/director/stats`, { timeout: 4000 });
        if (!res.ok) return null;
        const text = await res.text();
        if (!text) return null;
        return JSON.parse(text);
    } catch (err) {
        console.error('[API] getDirectorStats failed:', err);
        return null;
    }
}

export async function getDirectorKpiExport(format) {
    const qs = `?format=${encodeURIComponent(format)}`;
    const url = `${BASE_URL}/director/kpi-export${qs}`;
    try {
        const res = await fetchWithTimeout(url, { timeout: 8000 });
        if (!res.ok) return null;
        if (format === 'csv') return res.blob();
        return res.blob();
    } catch (err) {
        console.error('[API] getDirectorKpiExport failed:', err);
        return null;
    }
}

export async function getDirectorPowerBiMetrics(days = 14) {
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/director/powerbi-metrics?days=${encodeURIComponent(days)}`, { timeout: 4000 });
        if (!res.ok) {
            return {
                source: { mode: 'fallback', storage: 'Azure Table Storage', table: 'SessionMetrics' },
                updatedAt: null,
                windowDays: days,
                daily: [],
            };
        }
        return await res.json();
    } catch (err) {
        console.error('[API] getDirectorPowerBiMetrics failed:', err);
        return {
            source: { mode: 'fallback', storage: 'Azure Table Storage', table: 'SessionMetrics' },
            updatedAt: null,
            windowDays: days,
            daily: [],
        };
    }
}

export async function getSafetyRate(subjectId, days = 30) {
    const params = new URLSearchParams();
    if (subjectId) params.set('subjectId', subjectId);
    params.set('days', days);
    const res = await fetchWithTimeout(`${BASE_URL}/safety-rate?${params.toString()}`, { timeout: 4000 });
    if (!res.ok) throw await parseApiError(res, `Error ${res.status}: no se pudo calcular la Tasa Fallo Seguro.`);
    return res.json();
}

export async function getAdminUsers() {
    try {
        const res = await apiFetch(`${BASE_URL}/dashboard-admin/users`);
        if (!res.ok) {
            console.warn(`[API] getAdminUsers returned ${res.status}.`);
            return [];
        }
        const data = await res.json();
        const users = Array.isArray(data) ? data : (data?.data || []);
        return Array.isArray(users) ? users : [];
    } catch (err) {
        console.error('[API] getAdminUsers failed:', err);
        return [];
    }
}

export async function createAdminUser(payload) {
    const res = await apiFetch(`${BASE_URL}/dashboard-admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw await parseApiError(res, 'No se pudo crear el usuario.');
    return res.json();
}

export async function updateAdminUser(userId, payload) {
    const res = await apiFetch(`${BASE_URL}/dashboard-admin/users/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw await parseApiError(res, 'No se pudo actualizar el usuario.');
    return res.json();
}

export async function deleteAdminUser(userId) {
    const res = await apiFetch(`${BASE_URL}/dashboard-admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw await parseApiError(res, 'No se pudo eliminar el usuario.');
    return res.json();
}

export async function resetAdminUserPassword(userId, password) {
    const res = await apiFetch(`${BASE_URL}/dashboard-admin/users/${encodeURIComponent(userId)}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(password ? { password } : {}),
    });
    if (!res.ok) throw await parseApiError(res, 'No se pudo resetear la contraseña.');
    return res.json();
}

export async function getVectorHealth() {
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/vector-health`, { timeout: 3500 });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || typeof data !== 'object') return null;
        return data;
    } catch (err) {
        console.error('[API] getVectorHealth failed:', err);
        return null;
    }
}

export async function getArchiveUsage(subjectId, semester) {
    try {
        const params = new URLSearchParams();
        if (subjectId) params.set('subjectId', subjectId);
        if (semester) params.set('semester', semester);
        const qs = params.toString();
        const url = `${BASE_URL}/archive-usage${qs ? '?' + qs : ''}`;
        const res = await fetchWithTimeout(url, { timeout: 10000 });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.error('[API] getArchiveUsage failed:', err);
        return null;
    }
}

export async function getRetentionPolicy() {
    const res = await fetchWithTimeout(`${BASE_URL}/compliance/retention-policy`, { timeout: 4000 });
    if (!res.ok) return null;
    return res.json();
}

export async function saveRetentionPolicy(policy) {
    const res = await apiFetch(`${BASE_URL}/compliance/retention-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
    });
    if (!res.ok) {
        let message = 'Error al guardar la política de retención';
        try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function getRetentionExport(format) {
    const qs = `?format=${encodeURIComponent(format)}`;
    const url = `${BASE_URL}/compliance/retention-export${qs}`;
    const res = await fetchWithTimeout(url, { timeout: 8000 });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob;
}

export async function getSubjectWeights(subjectId) {
    if (!subjectId) return { data: { notes: 1.35, bibliography: 1.1, transcript: 1.0, presentation: 0.95 }, defaults: true };
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/subject-weights/${encodeURIComponent(subjectId)}`, { timeout: 4000 });
        if (!res.ok) return null;
        const json = await res.json();
        return { data: json?.data, defaults: json?.defaults };
    } catch (err) {
        console.error('[API] getSubjectWeights failed:', err);
        return null;
    }
}

export async function saveSubjectWeights(subjectId, weights) {
    if (!subjectId) throw new Error('subjectId is required');
    const res = await apiFetch(`${BASE_URL}/subject-weights/${encodeURIComponent(subjectId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weights }),
    });
    if (!res.ok) {
        let message = 'Error al guardar la ponderación de fuentes';
        try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function getAdminConfig(scope) {
    const res = await fetchWithTimeout(`${BASE_URL}/dashboard-admin/config/${encodeURIComponent(scope)}`, { timeout: 4000 });
    if (!res.ok) return null;
    return res.json();
}

export async function saveAdminConfig(scope, values) {
    const res = await apiFetch(`${BASE_URL}/dashboard-admin/config/${encodeURIComponent(scope)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
    });
    if (!res.ok) {
        let message = 'Error al guardar la configuración';
        try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function resetAdminConfig(scope) {
    const res = await apiFetch(`${BASE_URL}/dashboard-admin/config/${encodeURIComponent(scope)}`, {
        method: 'DELETE',
    });
    if (!res.ok) {
        let message = 'Error al restablecer la configuración';
        try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
        throw new Error(message);
    }
    return res.json();
}
