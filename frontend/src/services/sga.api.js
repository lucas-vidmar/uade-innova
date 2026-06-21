import {
    USE_MOCK, BASE_URL, apiFetch, fetchWithTimeout, delay
} from './core.js';

import { getMock } from './mocks/accessor.js';

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
    if (USE_MOCK) {
        await delay(400);
        const mocks = await getMock('MOCK_TASKS', []);
        return mocks.map(t => ({ ...t, studentId }));
    }

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

    if (USE_MOCK) {
        await delay(400);
        const mockAlerts = await getMock('MOCK_EARLY_ALERTS', []);
        const bySubject = resolvedSubjectId ? mockAlerts.filter(a => a.subjectId === resolvedSubjectId) : mockAlerts;
        const filtered = interventionOnly ? bySubject.filter((a) => a.interventionFlag === 'at_risk') : bySubject;
        return filtered.map(normalizeEarlyAlert);
    }

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
    if (USE_MOCK) {
        await delay(400);
        return { average: 78, critical: 3, trend: 'stable', subjectId, updatedAt: new Date().toISOString() };
    }

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
    if (USE_MOCK) { await delay(400); return await getMock('MOCK_TEACHER_ANALYTICS', {}); }
    const res = await apiFetch(`${BASE_URL}/analytics?subjectId=${subjectId}`);
    return res.json();
}

export async function getTeacherAlerts(subjectId) {
    if (!subjectId) return [];
    if (USE_MOCK) {
        await delay(300);
        const alerts = await getMock('MOCK_TEACHER_ALERTS', []);
        return alerts.filter((item) => item.subjectId === subjectId).map(normalizeTeacherAlert);
    }

    try {
        const res = await fetchWithTimeout(`${BASE_URL}/sga/teacher-alerts?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data.map((item, idx) => normalizeTeacherAlert(item, idx));
    } catch (err) {
        console.error('[API] getTeacherAlerts failed:', err);
        return [];
    }
}

export async function getEnrollments(userId) {
    if (!userId) return [];
    if (USE_MOCK) {
        await delay(200);
        return [
            { subjectId: 'arq-soft-2026', role: 'student', status: 'active' },
            { subjectId: 'ing-datos-2026', role: 'student', status: 'active' },
        ];
    }
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/enrollments?userId=${encodeURIComponent(userId)}`, { timeout: 4000 });
        if (!res.ok) return [];
        const data = await res.json();
        if (data?.success && Array.isArray(data.data)) return data.data;
        if (Array.isArray(data)) return data;
        return [];
    } catch (err) {
        console.error('[API] getEnrollments failed:', err);
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

export async function getInterventions({ subjectId, state, risk } = {}) {
    if (USE_MOCK) {
        await delay(400);
        return [
            { id: 'int-001', subjectId: 'arq-software-2026', studentId: 'alu-012', risk: 'high', score: 8, reason: 'Sin login en 21 días; sin actividad', state: 'assigned', notes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            { id: 'int-002', subjectId: 'arq-software-2026', studentId: 'alu-008', risk: 'medium', score: 5, reason: 'Sin login en 14 días; menos de 2 consultas en 7 días', state: 'assigned', notes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ];
    }
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
    if (USE_MOCK) {
        await delay(300);
        return { success: true, data: { id, subjectId, state, updatedAt: new Date().toISOString() } };
    }
    const res = await apiFetch(`${BASE_URL}/interventions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, subjectId, state, note }),
    });
    return res.json();
}

export async function computeInterventions(subjectId) {
    if (USE_MOCK) {
        await delay(800);
        return { success: true, data: { computed: 2, interventions: [] } };
    }
    const qs = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
    const res = await apiFetch(`${BASE_URL}/interventions/compute${qs}`, { method: 'POST' });
    return res.json();
}

export async function getRiskThresholds(subjectId) {
    if (USE_MOCK) {
        await delay(300);
        return { success: true, data: { subjectId: subjectId || 'default', thresholds: { attendanceWarning: 70, attendanceCritical: 50, engagementWarning: 60, engagementCritical: 40, gradeWarning: 6, noLoginDaysLow: 7, noLoginDaysMedium: 14, noLoginDaysHigh: 21, minQueriesMedium: 2, minQueriesHigh: 5, queryWindowDays: 7, queryWindowHighDays: 14 }, source: 'default' } };
    }
    const qs = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
    const res = await fetchWithTimeout(`${BASE_URL}/risk-thresholds${qs}`, { timeout: 4000 });
    if (!res.ok) return { success: false, error: 'Error' };
    return res.json();
}

export async function updateRiskThresholds(subjectId, thresholds) {
    if (USE_MOCK) {
        await delay(300);
        return { success: true, data: { subjectId, thresholds } };
    }
    const res = await apiFetch(`${BASE_URL}/risk-thresholds`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, thresholds }),
    });
    return res.json();
}
