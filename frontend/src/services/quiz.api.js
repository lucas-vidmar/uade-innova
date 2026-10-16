import { BASE_URL, apiFetch } from './core.js';

export async function generateQuiz({ subjectId, classId, questionCount, subjectName, className }) {
    const res = await apiFetch(`${BASE_URL}/generate-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, classId, questionCount, subjectName, className }),
    });

    if (res.status === 429) {
        const rateLimitError = new Error('Límite de intentos alcanzado. Esperá unos segundos.');
        rateLimitError.status = 429;
        rateLimitError.errorCategory = 'RATE_LIMIT';
        throw rateLimitError;
    }

    if (!res.ok) {
        let message = `Error ${res.status}: No se pudo generar el cuestionario`;
        let errorCategory = null;
        let code = null;
        try {
            const data = await res.json();
            if (data?.error) message = typeof data.error === 'string' ? data.error : data.error?.message || message;
            if (data?.errorCategory) errorCategory = data.errorCategory;
            // #338: preserve the machine-readable code (CONSENT_REQUIRED)
            // so the quiz UI can offer the terms CTA instead of failing silently.
            code = typeof data?.error === 'object' ? data.error?.code : data?.code;
            if (!errorCategory && typeof data?.error === 'object') errorCategory = data.error?.errorCategory || null;
        } catch {}
        const apiError = new Error(message);
        apiError.status = res.status;
        if (errorCategory) apiError.errorCategory = errorCategory;
        if (code) apiError.code = code;
        throw apiError;
    }

    return res.json();
}

export async function saveQuizResult(payload) {
    const res = await apiFetch(`${BASE_URL}/quiz-result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const apiError = new Error(`Error ${res.status}: No se pudo guardar el resultado`);
        apiError.status = res.status;
        throw apiError;
    }
    return res.json();
}

export async function getQuizResult(subjectId, classId) {
    const params = new URLSearchParams({ subjectId, classId });
    try {
        const res = await apiFetch(`${BASE_URL}/quiz-result?${params}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data?.result || null;
    } catch (err) {
        console.warn('[API] getQuizResult failed:', err);
        return null;
    }
}

export async function getQuizAttempts(subjectId, classId) {
    const params = new URLSearchParams({ subjectId, classId });
    try {
        const res = await apiFetch(`${BASE_URL}/quiz-attempts?${params}`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.attempts) ? data.attempts : [];
    } catch (err) {
        console.warn('[API] getQuizAttempts failed:', err);
        return [];
    }
}
