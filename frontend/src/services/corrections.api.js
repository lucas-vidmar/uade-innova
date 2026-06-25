import {
    BASE_URL, apiFetch, fetchWithTimeout
} from './core.js';

export async function getStudentReports(subjectId) {
    if (!subjectId) return [];
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
    const params = new URLSearchParams({ subjectId });
    if (correctionId) params.append('correctionId', correctionId);
    const res = await fetchWithTimeout(`${BASE_URL}/corrections-pending?${params}`, { timeout: 4000 });
    if (!res.ok) throw new Error('Error cargando corrección');
    const json = await res.json();
    const data = json.data || [];
    return correctionId ? data.find(c => c.correctionId === correctionId) || null : data;
}

export async function getCorrectionChatContext(subjectId, correctionId) {
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

export async function submitGradeDispute({ taskId, reason }) {
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
