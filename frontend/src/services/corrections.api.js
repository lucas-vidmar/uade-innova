import {
    USE_MOCK, BASE_URL, apiFetch, fetchWithTimeout, delay,
    readLocalJson, writeLocalJson
} from './core.js';

const MOCK_REPORTS_KEY = 'uade.mock.ai-reports';

function readMockReports(subjectId, studentId) {
    const reports = readLocalJson(MOCK_REPORTS_KEY, []);
    return reports.filter((r) => {
        if (r.subjectId !== subjectId) return false;
        if (studentId && r.studentId && r.studentId !== studentId) return false;
        return true;
    });
}

export async function getStudentReports(subjectId) {
    if (!subjectId) return [];
    if (USE_MOCK) {
        await delay(250);
        const studentId = sessionStorage.getItem('edu_uid') || 'alu-001';
        return readMockReports(subjectId, studentId).map((r) => ({
            correctionId: r.correctionId,
            question: r.question,
            issueDetail: r.issueDetail,
            status: r.status,
            classId: r.classId,
            createdAt: r.createdAt,
            resolvedAt: r.resolvedAt,
        }));
    }
    try {
        const params = new URLSearchParams({ subjectId });
        const res = await fetchWithTimeout(`${BASE_URL}/student-reports?${params.toString()}`, { timeout: 4000 });
        if (!res.ok) return [];
        const json = await res.json();
        return json.data || [];
    } catch (err) {
        console.error('[API] getStudentReports failed:', err);
        return [];
    }
}

export async function getTeacherAiFeedbackAlerts(subjectId, limit = 10) {
    if (!subjectId) return [];
    if (USE_MOCK) {
        await delay(250);
        return [];
    }

    try {
        const params = new URLSearchParams({
            subjectId,
            limit: String(Math.min(Math.max(Number(limit) || 10, 1), 50)),
        });
        const res = await fetchWithTimeout(`${BASE_URL}/teacher/ai-feedback-alerts?${params.toString()}`, { timeout: 3500 });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error('[API] getTeacherAiFeedbackAlerts failed:', err);
        return [];
    }
}

export async function getCorrectionsPending(subjectId, classId, status) {
    if (!subjectId) return [];
    if (USE_MOCK) {
        await delay(250);
        let data = readMockReports(subjectId);
        if (status && status !== 'all') {
            data = data.filter((r) => r.status === status);
        } else if (!status) {
            data = data.filter((r) => r.status === 'pending');
        }
        if (classId) data = data.filter((r) => r.classId === classId);
        return data.map((r) => ({
            correctionId: r.correctionId,
            studentId: r.studentId,
            question: r.question,
            originalAnswer: r.originalAnswer,
            issueDetail: r.issueDetail,
            classId: r.classId,
            status: r.status,
            createdAt: r.createdAt,
        }));
    }
    try {
        const params = new URLSearchParams({ subjectId });
        if (classId) params.append('classId', classId);
        if (status) params.append('status', status);
        const res = await fetchWithTimeout(`${BASE_URL}/corrections-pending?${params.toString()}`, { timeout: 4000 });
        if (!res.ok) {
            throw new Error(`Error del servidor (${res.status}) al cargar correcciones.`);
        }
        const json = await res.json();
        return json.data || [];
    } catch (err) {
        console.error('[API] getCorrectionsPending failed:', err);
        throw err;
    }
}

export async function verifyAnswer(payload) {
    if (USE_MOCK) {
        await delay(500);
        return { success: true, data: { correctionId: payload.correctionId, status: 'verified' } };
    }
    const res = await apiFetch(`${BASE_URL}/corrections-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        let message = 'Error al publicar corrección';
        try { const err = await res.json(); if (err?.error?.message) message = err.error.message; } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function reviewCorrection(subjectId, correctionId, status, comments) {
    if (USE_MOCK) {
        await delay(300);
        return { success: true, data: { correctionId, status } };
    }
    const res = await apiFetch(`${BASE_URL}/corrections-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correctionId, subjectId, status, comments }),
    });
    if (!res.ok) {
        let message = `Error del servidor (${res.status})`;
        try { const err = await res.json(); if (err?.error?.message) message = err.error.message; } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function updateCorrectionStatus(subjectId, correctionId, status) {
    if (USE_MOCK) {
        await delay(300);
        return { success: true, data: { correctionId, status } };
    }
    const res = await apiFetch(`${BASE_URL}/corrections-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correctionId, subjectId, status }),
    });
    if (!res.ok) {
        let message = `Error del servidor (${res.status})`;
        try { const err = await res.json(); if (err?.error?.message) message = err.error.message; } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function getCorrection(subjectId, correctionId) {
    if (USE_MOCK) {
        await delay(300);
        return {
            correctionId,
            studentId: 'J.P.',
            question: '¿Qué es la arquitectura hexagonal?',
            originalAnswer: 'La arquitectura hexagonal es un patrón de diseño de software que separa el dominio de la infraestructura...',
            issueDetail: 'La respuesta no menciona puertos y adaptadores',
            classId: 'class-03',
            status: 'pending',
            createdAt: '2026-05-31T10:00:00Z',
        };
    }
    const params = new URLSearchParams({ subjectId });
    if (correctionId) params.append('correctionId', correctionId);
    const res = await fetchWithTimeout(`${BASE_URL}/corrections-pending?${params}`, { timeout: 4000 });
    if (!res.ok) throw new Error('Error cargando corrección');
    const json = await res.json();
    const data = json.data || [];
    return correctionId ? data.find(c => c.correctionId === correctionId) || null : data;
}

export async function getCorrectionChatContext(subjectId, correctionId) {
    if (USE_MOCK) {
        await delay(300);
        return {
            messages: [
                { role: 'user', content: '¿Qué es la arquitectura hexagonal?' },
                { role: 'assistant', content: 'La arquitectura hexagonal es un patrón de diseño...' },
                { role: 'user', content: '¿Y cómo se relaciona con DDD?' },
                { role: 'assistant', content: 'Se relaciona porque ambos buscan aislar el dominio...' },
            ],
        };
    }
    try {
        const res = await fetchWithTimeout(
            `${BASE_URL}/corrections-chat-context?subjectId=${encodeURIComponent(subjectId)}&correctionId=${encodeURIComponent(correctionId)}`,
            { timeout: 5000 }
        );
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const json = await res.json();
        return json?.data || { messages: [] };
    } catch (err) {
        console.error('[API] getCorrectionChatContext failed:', err);
        throw err;
    }
}

export async function getGlossary(subjectId) {
    if (!subjectId) return null;
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/glossary?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
        if (!res.ok) return null;
        const json = await res.json();
        return json?.data || null;
    } catch (err) {
        console.error('[API] getGlossary failed:', err);
        return null;
    }
}

export async function updateGlossary(subjectId, terms) {
    if (!subjectId) throw new Error('subjectId is required');
    const res = await apiFetch(`${BASE_URL}/glossary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, terms }),
    });
    if (!res.ok) {
        let message = 'Error al actualizar el glosario';
        try { const err = await res.json(); if (err?.error?.message) message = err.error.message; } catch {}
        throw new Error(message);
    }
    const json = await res.json();
    return json?.data || null;
}

export async function getTranscriptionSuggestions(subjectId, status = 'pending') {
    if (!subjectId) return [];
    try {
        const params = new URLSearchParams({ subjectId });
        if (status) params.set('status', status);
        const res = await fetchWithTimeout(`${BASE_URL}/corrections-transcription?${params.toString()}`, { timeout: 4000 });
        if (!res.ok) return [];
        const json = await res.json();
        return json?.data || [];
    } catch (err) {
        console.error('[API] getTranscriptionSuggestions failed:', err);
        return [];
    }
}

export async function applyTranscriptionCorrection(suggestionId, subjectId) {
    if (!suggestionId || !subjectId) throw new Error('suggestionId and subjectId are required');
    const res = await apiFetch(`${BASE_URL}/corrections-transcription/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId, subjectId }),
    });
    if (!res.ok) {
        let message = 'Error al aplicar corrección';
        try { const err = await res.json(); if (err?.error?.message) message = err.error.message; } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function rejectTranscriptionSuggestion(suggestionId, subjectId) {
    if (!suggestionId || !subjectId) throw new Error('suggestionId and subjectId are required');
    const res = await apiFetch(`${BASE_URL}/corrections-transcription/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId, subjectId }),
    });
    if (!res.ok) {
        let message = 'Error al rechazar sugerencia';
        try { const err = await res.json(); if (err?.error?.message) message = err.error.message; } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function submitGradeDispute({ taskId, reason }) {
    if (USE_MOCK) {
        await delay(300);
        const disputes = readLocalJson('uade.mock.disputes', []);
        disputes.unshift({
            id: `dispute-${Date.now()}`,
            taskId,
            reason: String(reason || '').trim(),
            status: 'pending',
            studentId: sessionStorage.getItem('edu_uid') || 'alu-001',
            createdAt: new Date().toISOString(),
        });
        writeLocalJson('uade.mock.disputes', disputes);
        return { success: true };
    }
    const res = await apiFetch(`${BASE_URL}/grade-dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, reason: String(reason || '').trim() }),
    });
    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo enviar la disputa`;
        try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
        throw new Error(message);
    }
    return res.json();
}
