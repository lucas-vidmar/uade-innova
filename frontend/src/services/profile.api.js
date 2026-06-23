import {
    USE_MOCK, BASE_URL, apiFetch, fetchWithTimeout, delay
} from './core.js';

export async function getProfile() {
    if (USE_MOCK) {
        await delay(300);
        return { theme: 'light', language: 'es', consentAccepted: false };
    }
    const res = await apiFetch(`${BASE_URL}/get-profile`);
    return res.json();
}

export async function saveProfile(data) {
    if (USE_MOCK) return;
    const res = await apiFetch(`${BASE_URL}/save-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

export async function getTerms() {
    if (USE_MOCK) {
        await delay(300);
        return { content: '# Términos de Uso\n\nTexto de ejemplo para consentimiento.', version: 'v1' };
    }
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
    if (USE_MOCK) {
        await delay(200);
        return { accepted: false, acceptedAt: null, version: null };
    }
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
    if (USE_MOCK) return { saved: true, accepted };
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

export async function getReminderPreferences() {
    if (USE_MOCK) {
        await delay(200);
        return { enabled: true, cadence: 'both' };
    }
    try {
        const res = await apiFetch(`${BASE_URL}/reminder-preferences`);
        if (!res.ok) return { enabled: true, cadence: 'both' };
        return await res.json();
    } catch (err) {
        console.error('[API] getReminderPreferences failed:', err);
        return { enabled: true, cadence: 'both' };
    }
}

export async function saveReminderPreferences(data) {
    if (USE_MOCK) return { saved: true };
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
