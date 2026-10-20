import {
    BASE_URL, apiFetch, fetchWithTimeout, readList, delay, parseApiError
} from './core.js';

export async function getTasks(studentId, options = {}) {
    // fix #352: with `strict: true` a failed read throws instead of looking
    // like "this student has no pending work".
    return readList(`${BASE_URL}/sga/tasks?studentId=${encodeURIComponent(studentId)}`, {
        timeout: 4000,
        strict: options.strict,
        label: '[API] getTasks',
    });
}

// #467: acá vivían getEarlyAlerts, getAttendanceStats y getTeacherAlerts. Sus
// endpoints (GET /api/sga/early-alerts, /attendance, /teacher-alerts) devuelven
// listas fijas vacías o `{ average: null, ... }` porque no hay fuente: no leen
// ninguna tabla ni blob. Los clientes además inventaban ceros al fallar
// (`average: 0, trend: 'stable'`), que se leían como una medición real. Sin
// consumidor en la interfaz y sin fuente, se retiran del cliente hasta que la
// integración con el sistema académico exista.

export async function getTeacherAnalytics(subjectId) {
    const res = await apiFetch(`${BASE_URL}/analytics?subjectId=${subjectId}`);
    if (!res.ok) throw await parseApiError(res, `Error ${res.status}: no se pudieron cargar los datos de analítica.`);
    return res.json();
}

function sessionMockingEnabled() {
    try {
        return sessionStorage.getItem('edu_logged_in') !== 'false'
            && !!sessionStorage.getItem('edu_role');
    } catch { return false; }
}

function loadDynamicEnrollments() {
    try {
        const raw = localStorage.getItem('uade.dynamic.enrollments');
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveDynamicEnrollments(map) {
    try { localStorage.setItem('uade.dynamic.enrollments', JSON.stringify(map)); } catch {}
}

function saveDynamicEnrollment(userId, enrollment) {
    const dynamic = loadDynamicEnrollments();
    const userEnrollments = dynamic[userId] || [];
    const exists = userEnrollments.some(e => e.subjectId === enrollment.subjectId && e.role === enrollment.role);
    if (!exists) {
        userEnrollments.push(enrollment);
    }
    dynamic[userId] = userEnrollments;
    saveDynamicEnrollments(dynamic);
}

function removeDynamicEnrollment(userId, subjectId) {
    const dynamic = loadDynamicEnrollments();
    const userEnrollments = (dynamic[userId] || []).filter(e => e.subjectId !== subjectId);
    dynamic[userId] = userEnrollments;
    saveDynamicEnrollments(dynamic);
}

function mergeWithDynamicEnrollments(userId, base) {
    const dynamic = loadDynamicEnrollments();
    const dyn = dynamic[userId] || [];
    const combined = [...(base || []), ...dyn];
    const seen = new Set();
    return combined.filter(e => {
        const key = `${e.subjectId}-${e.role}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export async function getEnrollments(userId) {
    if (!userId) return [];
    try {
        const res = await apiFetch(`${BASE_URL}/enrollments?userId=${encodeURIComponent(userId)}`);
        if (!res.ok) {
            if (sessionMockingEnabled()) {
                console.warn('[API] getEnrollments failed, using dynamic enrollments.');
                await delay(200);
                return mergeWithDynamicEnrollments(userId, []);
            }
            return [];
        }
        const data = await res.json();
        const apiData = data?.success && Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
        return mergeWithDynamicEnrollments(userId, apiData);
    } catch (err) {
        console.error('[API] getEnrollments failed:', err);
        if (sessionMockingEnabled()) {
            await delay(200);
            return mergeWithDynamicEnrollments(userId, []);
        }
        return [];
    }
}

export async function checkEnrollment(userId, subjectId) {
    if (!userId || !subjectId) return { enrolled: false, role: null, status: null };
    try {
        const res = await fetchWithTimeout(
            `${BASE_URL}/enrollments/check?userId=${encodeURIComponent(userId)}&subjectId=${encodeURIComponent(subjectId)}`,
            { timeout: 3500 }
        );
        if (!res.ok) return { enrolled: false, role: null, status: null };
        const data = await res.json();
        if (data?.success && data.data) return data.data;
        return data || { enrolled: false, role: null, status: null };
    } catch (err) {
        console.error('[API] checkEnrollment failed:', err);
        return { enrolled: false, role: null, status: null };
    }
}

export async function getEnrollmentsBySubject(subjectId, options = {}) {
    if (!subjectId) return [];
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/enrollments?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
        if (!res.ok) {
            // fix #352/#500: strict callers must not receive an empty list as if
            // the subject simply had no enrollments (the participants screen
            // would assert "0 INSCRIPTOS" for a unit that does have students).
            if (options.strict) throw await parseApiError(res, `No se pudieron leer las matrículas (HTTP ${res.status}).`);
            return [];
        }
        const data = await res.json();
        if (data?.success && Array.isArray(data.data)) return data.data;
        return Array.isArray(data) ? data : [];
    } catch (err) {
        if (options.strict) throw err;
        console.error('[API] getEnrollmentsBySubject failed:', err);
        return [];
    }
}

export async function getInterventions({ subjectId, state, risk } = {}) {
    const params = new URLSearchParams();
    if (subjectId) params.set('subjectId', subjectId);
    if (state) params.set('state', state);
    if (risk) params.set('risk', risk);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetchWithTimeout(`${BASE_URL}/interventions${qs}`, { timeout: 4000 });
    if (!res.ok) return [];
    const json = await res.json();
    return json?.data || [];
}

export async function updateIntervention(id, subjectId, state, note = '') {
    const res = await apiFetch(`${BASE_URL}/interventions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, subjectId, state, note }),
    });
    return res.json();
}

export async function computeInterventions(subjectId) {
    const qs = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
    const res = await apiFetch(`${BASE_URL}/interventions/compute${qs}`, { method: 'POST' });
    return res.json();
}

export async function getRiskThresholds(subjectId) {
    const qs = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
    const res = await fetchWithTimeout(`${BASE_URL}/risk-thresholds${qs}`, { timeout: 4000 });
    if (!res.ok) return { success: false, error: 'Error' };
    return res.json();
}

export async function updateRiskThresholds(subjectId, thresholds) {
    const res = await apiFetch(`${BASE_URL}/risk-thresholds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, thresholds }),
    });
    return res.json();
}

function persistEnrollmentLocally(subjectId, userId, role, status) {
    saveDynamicEnrollment(userId, { subjectId, userId, role, status, enrolledAt: new Date().toISOString() });
}

export async function createEnrollment(subjectId, userId, role, status = 'active') {
    if (!subjectId || !userId || !role) {
        throw new Error('subjectId, userId, and role are required');
    }
    try {
        const res = await apiFetch(`${BASE_URL}/enrollments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subjectId, userId, role, status }),
        });
        if (!res.ok) {
            persistEnrollmentLocally(subjectId, userId, role, status);
            return { success: true, data: { subjectId, userId, role, status }, fallback: true };
        }
        return res.json();
    } catch (err) {
        console.error('[API] createEnrollment failed, saving locally:', err);
        persistEnrollmentLocally(subjectId, userId, role, status);
        return { success: true, data: { subjectId, userId, role, status }, fallback: true };
    }
}

export async function deleteEnrollment(subjectId, userId) {
    if (!subjectId || !userId) {
        throw new Error('subjectId and userId are required');
    }
    try {
        const res = await apiFetch(`${BASE_URL}/enrollments?userId=${encodeURIComponent(userId)}&subjectId=${encodeURIComponent(subjectId)}`, {
            method: 'DELETE',
        });
        if (!res.ok) {
            removeDynamicEnrollment(userId, subjectId);
            return { success: true, data: { deleted: true }, fallback: true };
        }
        return res.json();
    } catch (err) {
        console.error('[API] deleteEnrollment failed, removing locally:', err);
        removeDynamicEnrollment(userId, subjectId);
        return { success: true, data: { deleted: true }, fallback: true };
    }
}
