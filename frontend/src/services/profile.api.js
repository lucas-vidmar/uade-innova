import {
    BASE_URL, apiFetch, fetchWithTimeout, parseApiError
} from './core.js';

export async function getProfile() {
    const res = await apiFetch(`${BASE_URL}/get-profile`);
    return res.json();
}

export async function saveProfile(data) {
    const res = await apiFetch(`${BASE_URL}/save-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo guardar el perfil`;
        try {
            const err = await res.json();
            if (err?.error) message = err.error;
        } catch (_) {}
        throw new Error(message);
    }
    return res.json();
}

export async function getTerms() {
    try {
        const res = await apiFetch(`${BASE_URL}/terms`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.success && data.data) return data.data;
        return null;
    } catch (err) {
        console.error('[API] getTerms failed:', err);
        return null;
    }
}

export async function getConsent() {
    try {
        const res = await apiFetch(`${BASE_URL}/consent`);
        if (!res.ok) return { accepted: false, acceptedAt: null, version: null };
        const data = await res.json();
        if (data?.success && data.data) return data.data;
        return { accepted: false, acceptedAt: null, version: null };
    } catch (err) {
        console.error('[API] getConsent failed:', err);
        return { accepted: false, acceptedAt: null, version: null };
    }
}

export async function saveConsent(accepted = true) {
    try {
        const res = await apiFetch(`${BASE_URL}/consent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accepted }),
        });
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: { code: 'UNKNOWN', message: res.statusText } }));
            throw new Error(errBody?.error?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (data?.success && data.data) return data.data;
        throw new Error('Respuesta inválida del servidor');
    } catch (err) {
        console.error('[API] saveConsent failed:', err);
        throw err;
    }
}

// Defaults for a caller that tolerates a failed read (the calendar). A caller
// that must not present a default as the account state passes `strict`.
export const REMINDER_PREFERENCES_DEFAULTS = { enabled: true, cadence: 'both', timeWindow: 'any', datePrefs: {} };

export async function getReminderPreferences(options = {}) {
    try {
        const res = await apiFetch(`${BASE_URL}/reminder-preferences`);
        // fix #352: `strict` callers must not be told the reminders are on when
        // the read failed — that is a claim about the account, not a default.
        if (!res.ok) {
            if (options.strict) throw await parseApiError(res, `No se pudieron leer tus preferencias (HTTP ${res.status}).`);
            return { ...REMINDER_PREFERENCES_DEFAULTS };
        }
        const data = await res.json();
        // UJ-35: antelación por fecha y franja horaria viajan en la misma fila.
        return { ...REMINDER_PREFERENCES_DEFAULTS, ...(data || {}) };
    } catch (err) {
        if (options.strict) throw err;
        console.error('[API] getReminderPreferences failed:', err);
        return { ...REMINDER_PREFERENCES_DEFAULTS };
    }
}

export async function saveReminderPreferences(data) {
    try {
        const res = await apiFetch(`${BASE_URL}/reminder-preferences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.error('[API] saveReminderPreferences failed:', err);
        return null;
    }
}
