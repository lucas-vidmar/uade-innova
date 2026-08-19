/* ============================================================
   Auth API — email/password login + session endpoints (Story 1.1a)
   ============================================================ */
import {
    BASE_URL, apiFetch, parseApiError
} from './core.js';

export async function login(email, password) {
    const res = await apiFetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw await parseApiError(res, 'No se pudo iniciar sesión.');
    return res.json();
}

export async function logout() {
    try {
        await apiFetch(`${BASE_URL}/auth/logout`, { method: 'POST' });
    } catch (err) {
        console.warn('[AuthAPI] logout endpoint unreachable (session cleared client-side):', err);
    }
}

export async function changePassword(currentPassword, newPassword) {
    const res = await apiFetch(`${BASE_URL}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) throw await parseApiError(res, 'No se pudo cambiar la contraseña.');
    return res.json();
}

export async function getMe() {
    const res = await apiFetch(`${BASE_URL}/auth/me`);
    if (!res.ok) throw await parseApiError(res, 'No se pudo resolver la sesión.');
    return res.json();
}
