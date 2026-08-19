import {
    BASE_URL, apiFetch, fetchWithTimeout, delay, parseApiError
} from './core.js';

function normalizeTeacherAlert(item = {}, idx = 0) {
    const type = item.type === 'material_report' ? 'material_report' : 'low_engagement';
    const severity = item.severity === 'high' ? 'high' : 'medium';
    return {
        id: item.id || `teacher-alert-${idx}`,
        type,
        severity,
        subjectId: item.subjectId || null,
        classId: item.classId || null,
        studentId: item.studentId || null,
        studentName: item.studentName || null,
        materialId: item.materialId || null,
        materialType: item.materialType || null,
        title: String(item.title || (type === 'low_engagement' ? 'Alerta de baja participación' : 'Alerta de material reportado')),
        description: String(item.description || ''),
        attendance: item.attendance || null,
        avgGrade: typeof item.avgGrade === 'number' ? item.avgGrade : null,
        reportCount: typeof item.reportCount === 'number' ? item.reportCount : 0,
        createdAt: item.createdAt || new Date().toISOString(),
        recommendedAction: String(item.recommendedAction || ''),
    };
}

function normalizeEarlyAlert(item = {}) {
    const normalizeRisk = (value) => (['low', 'medium', 'high'].includes(value) ? value : 'medium');
    const normalizeInterventionFlag = (value, risk) => {
        if (['stable', 'watchlist', 'at_risk'].includes(value)) return value;
        if (risk === 'high') return 'at_risk';
        if (risk === 'medium') return 'watchlist';
        return 'stable';
    };
    const risk = normalizeRisk(item.risk);
    return {
        id: String(item.id || ''),
        studentId: String(item.studentId || ''),
        name: String(item.name || 'Alumno sin nombre'),
        subjectId: String(item.subjectId || ''),
        subject: String(item.subject || 'Materia no informada'),
        risk,
        interventionFlag: normalizeInterventionFlag(item.interventionFlag, risk),
        attendance: String(item.attendance || '0%'),
        avgGrade: typeof item.avgGrade === 'number' ? item.avgGrade : 0,
    };
}

export async function getTasks(studentId) {
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/sga/tasks?studentId=${encodeURIComponent(studentId)}`, { timeout: 4000 });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error('[API] getTasks failed:', err);
        return [];
    }
}

export async function getEarlyAlerts(subjectId, options = {}) {
    const resolvedSubjectId = typeof subjectId === 'string' ? subjectId : (subjectId && typeof subjectId === 'object' ? subjectId.subjectId : undefined);
    const interventionOnly = typeof subjectId === 'object' && subjectId !== null
        ? Boolean(subjectId.interventionOnly)
        : Boolean(options.interventionOnly);

    try {
        const params = new URLSearchParams();
        if (resolvedSubjectId) params.set('subjectId', resolvedSubjectId);
        if (interventionOnly) params.set('interventionOnly', 'true');
        const query = params.toString() ? `?${params.toString()}` : '';
        const res = await fetchWithTimeout(`${BASE_URL}/sga/early-alerts${query}`, { timeout: 4000 });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data.map(normalizeEarlyAlert) : [];
    } catch (err) {
        console.error('[API] getEarlyAlerts failed:', err);
        return [];
    }
}

export async function getAttendanceStats(subjectId) {
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/sga/attendance?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
        if (!res.ok) return { average: 0, critical: 0, trend: 'stable', subjectId, updatedAt: new Date().toISOString() };
        return await res.json();
    } catch (err) {
        console.error('[API] getAttendanceStats failed:', err);
        return { average: 0, critical: 0, trend: 'stable', subjectId, updatedAt: new Date().toISOString() };
    }
}

export async function getTeacherAnalytics(subjectId) {
    const res = await apiFetch(`${BASE_URL}/analytics?subjectId=${subjectId}`);
    if (!res.ok) throw await parseApiError(res, `Error ${res.status}: no se pudieron cargar los datos de analítica.`);
    return res.json();
}

export async function getTeacherAlerts(subjectId) {
    if (!subjectId) return [];
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/sga/teacher-alerts?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
        if (!res.ok) throw await parseApiError(res, `Error ${res.status}: no se pudieron cargar las alertas docentes.`);
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data.map((item, idx) => normalizeTeacherAlert(item, idx));
    } catch (err) {
        if (err?.retryable === false || err?.status === 401 || err?.status === 403) throw err;
        console.error('[API] getTeacherAlerts failed:', err);
        return [];
    }
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
        const res = await fetchWithTimeout(`${BASE_URL}/enrollments?userId=${encodeURIComponent(userId)}`, { timeout: 4000 });
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

export async function getEnrollmentsBySubject(subjectId) {
    if (!subjectId) return [];
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/enrollments?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
        if (!res.ok) return [];
        const data = await res.json();
        if (data?.success && Array.isArray(data.data)) return data.data;
        return Array.isArray(data) ? data : [];
    } catch (err) {
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
