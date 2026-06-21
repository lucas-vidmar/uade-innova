import {
    USE_MOCK, BASE_URL, apiFetch, fetchWithTimeout, delay
} from './core.js';

import { getMock } from './mocks/accessor.js';

export async function getDirectorStats() {
    if (USE_MOCK) { await delay(500); return getMock('MOCK_DIRECTOR_STATS', {}); }
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/director/stats`, { timeout: 4000 });
        if (!res.ok) return getMock('MOCK_DIRECTOR_STATS', {});
        const text = await res.text();
        if (!text) return getMock('MOCK_DIRECTOR_STATS', {});
        return JSON.parse(text);
    } catch (err) {
        console.error('[API] getDirectorStats failed:', err);
        return getMock('MOCK_DIRECTOR_STATS', {});
    }
}

export async function getDirectorKpiExport(format) {
    const qs = `?format=${encodeURIComponent(format)}`;
    const url = `${BASE_URL}/director/kpi-export${qs}`;
    if (USE_MOCK) {
        await delay(500);
        const stats = await getMock('MOCK_DIRECTOR_STATS', {});
        if (format === 'csv') {
            const lines = [
                'seccion,metrica,valor',
                `General,Usuarios activos (hoy),${stats.dau}`,
                `General,Clases procesadas,${stats.classesProcessed}`,
                `General,Interacciones RAG,${stats.ragInteractions}`,
                `General,Adopcion global,${stats.adoptionRate}%`,
                '',
                'seccion,materia,costo_usd',
                ...(stats.costBySubject || []).map(s => {
                    const total = (s.dailyCost || []).reduce((sum, d) => sum + (d.cost || 0), 0);
                    return `Costo por materia,${s.subjectName || s.subjectId},${total.toFixed(6)}`;
                }),
                '',
                'seccion,materia,usuarios_semana_actual',
                ...(stats.wausBySubject || []).map(s => `WAUS,${s.subjectName || s.subjectId},${s.currentWeek || 0}`),
            ];
            return new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
        }
        return new Blob([JSON.stringify({ export: 'kpi-snapshot', generatedAt: new Date().toISOString(), data: stats }, null, 2)], { type: 'application/json' });
    }
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
    if (USE_MOCK) {
        await delay(400);
        return {
            source: { mode: 'mock', storage: 'local', table: 'SessionMetrics' },
            updatedAt: new Date().toISOString(),
            windowDays: days,
            daily: [],
        };
    }

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

export async function getAdminUsers() {
    if (USE_MOCK) {
        await delay(400);
        return [
            { id: 'alu-001', name: 'Valentina Rodríguez', email: 'valentina.rodriguez@uade.edu.ar', role: 'student', theme: 'light', language: 'es', consentAccepted: true, lastActive: '2026-03-17T12:00:00Z' },
            { id: 'doc-001', name: 'Dr. Martín Ferreiro', email: 'mferreiro@uade.edu.ar', role: 'teacher', theme: 'dark', language: 'es', consentAccepted: true, lastActive: '2026-03-17T11:45:00Z' },
            { id: 'alu-new', name: 'Alumno Nuevo', email: 'nuevo@uade.edu.ar', role: 'student', theme: 'light', language: 'es', consentAccepted: false, lastActive: '2026-03-17T10:30:00Z' }
        ];
    }
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/manage/users`, { timeout: 4000 });
        if (!res.ok) {
            console.warn(`[API] getAdminUsers returned ${res.status}. Falling back to empty list.`);
            return [];
        }
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error('[API] getAdminUsers failed:', err);
        return [];
    }
}

export async function getVectorHealth() {
    if (USE_MOCK) {
        await delay(250);
        return {
            provider: 'pinecone',
            indexName: 'dashboard-edu-pilot',
            stats: {
                totalVectorCount: 0,
                indexFullness: 0,
                namespaces: {},
            },
            latencyMs: { p50: 95, p95: 280 },
            failureRatio: 0.02,
            metricsWindow: 5,
            metricsSampleCount: 85,
            timestamp: new Date().toISOString(),
        };
    }

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
    if (USE_MOCK) {
        await delay(350);
        return {
            totalArchiveBlobs: 0,
            totalArchiveSizeGB: 0,
            bySubject: [],
            bySemester: [],
            lastUpdatedAt: new Date().toISOString(),
            dataSource: 'Mock data — no real Azure Storage connection',
        };
    }
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
    if (USE_MOCK) {
        await delay(300);
        return { rules: [{ name: 'DeleteArchiveAfter2Years', enabled: true, action: 'delete', retentionDays: 730, prefixes: ['class-materials/', 'processed/'] }, { name: 'ArchiveOldSemesterMaterials', enabled: true, action: 'tierToArchive', retentionDays: 180, prefixes: ['class-materials/semester-', 'processed/semester-'] }], softDeleteDays: 7, evaluatedAt: new Date().toISOString() };
    }
    const res = await fetchWithTimeout(`${BASE_URL}/compliance/retention-policy`, { timeout: 4000 });
    if (!res.ok) return null;
    return res.json();
}

export async function getRetentionExport(format) {
    const qs = `?format=${encodeURIComponent(format)}`;
    const url = `${BASE_URL}/compliance/retention-export${qs}`;
    if (USE_MOCK) {
        await delay(500);
        const policy = await getRetentionPolicy();
        if (format === 'csv') {
            const header = 'rule_name,enabled,action,retention_days,prefixes';
            const rows = policy.rules.map(r => `${r.name},${r.enabled},${r.action},${r.retentionDays},"${r.prefixes.join(';')}"`);
            const footer = `generated_at,${new Date().toISOString()}`;
            return new Blob([header + '\n' + rows.join('\n') + '\n' + footer], { type: 'text/csv' });
        }
        return new Blob([JSON.stringify({ export: { rules: policy.rules, softDeletePolicy: { enabled: true, days: policy.softDeleteDays }, generatedAt: new Date().toISOString() } }, null, 2)], { type: 'application/json' });
    }
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
