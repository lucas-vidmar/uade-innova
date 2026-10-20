import { BASE_URL, apiFetch } from './core.js';

export async function generateQuiz({ subjectId, classId, questionCount, subjectName, className, scope = 'class', classIds, topics }) {
    // UJ-30 (pasos 1 y 2): el pedido lleva su alcance. `class` es la práctica de
    // una clase (lo de siempre); `unit` reúne los temas de varias y puede venir
    // acotado a las clases elegidas y a los temas que la persona quiere priorizar.
    const payload = { subjectId, questionCount };
    if (scope === 'unit') {
        payload.scope = 'unit';
        if (Array.isArray(classIds)) payload.classIds = classIds;
        if (Array.isArray(topics) && topics.length) payload.topics = topics;
        if (className) payload.unitName = className;
    } else {
        payload.classId = classId;
        if (className) payload.className = className;
    }
    if (subjectName) payload.subjectName = subjectName;

    const res = await apiFetch(`${BASE_URL}/generate-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

// UJ-30: el alcance elegido selecciona la clave de lectura. La práctica de la
// unidad tiene su propio resultado e historial (`scope=unit`), separado del de
// cada clase, sin romper los intentos ya guardados por clase.
function scopeParams(subjectId, classId, { scope } = {}) {
    const params = new URLSearchParams({ subjectId });
    if (scope === 'unit') params.set('scope', 'unit');
    else if (classId) params.set('classId', classId);
    return params;
}

export async function getQuizResult(subjectId, classId, { scope } = {}) {
    const params = scopeParams(subjectId, classId, { scope });
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

export async function getQuizAttempts(subjectId, classId, { scope } = {}) {
    const params = scopeParams(subjectId, classId, { scope });
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

// UJ-30 (paso 7): los temas flojos que la persona marca, por persona y unidad.
// Se guardan en el servidor para que sobrevivan al cierre de la pestaña.
export async function getQuizWeakTopics(subjectId, classId, { scope } = {}) {
    const params = scopeParams(subjectId, classId, { scope });
    try {
        const res = await apiFetch(`${BASE_URL}/quiz-weak-topics?${params}`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.topics) ? data.topics : [];
    } catch (err) {
        console.warn('[API] getQuizWeakTopics failed:', err);
        return [];
    }
}

export async function saveQuizWeakTopics({ subjectId, classId, topics, scope }) {
    const body = scope === 'unit' ? { subjectId, scope: 'unit', topics } : { subjectId, classId, topics };
    const res = await apiFetch(`${BASE_URL}/quiz-weak-topics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const apiError = new Error(`Error ${res.status}: No se pudieron guardar los temas flojos`);
        apiError.status = res.status;
        throw apiError;
    }
    const data = await res.json();
    return Array.isArray(data?.topics) ? data.topics : [];
}

/**
 * UJ-30 (paso 1): anuncio del alcance de la práctica de la unidad. Devuelve las
 * clases publicadas con sus temas y materiales, más los temas que la persona ya
 * marcó como flojos. No genera preguntas: es lectura.
 */
export async function getQuizScope(subjectId) {
    const params = new URLSearchParams({ subjectId });
    const res = await apiFetch(`${BASE_URL}/quiz-scope?${params}`);
    if (!res.ok) {
        const err = new Error(`Error ${res.status}: no se pudo cargar el alcance de la unidad`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

/* ── Práctica compartida del grupo (#445 / UJ-32) ──────────────────
   Arriba de la práctica individual hay una práctica del grupo: un solo conjunto
   emitido para las personas con matrícula activa de la materia, que cada una
   responde por separado y que después se compara pregunta por pregunta. Estas
   llamadas no tocan la práctica individual (otras rutas, otro estado). */

function quizError(message, res, data) {
    const err = new Error(message);
    err.status = res.status;
    const code = typeof data?.error === 'object' ? data.error?.code : data?.code;
    if (code) err.code = code;
    const category = data?.errorCategory || (typeof data?.error === 'object' ? data.error?.errorCategory : null);
    if (category) err.errorCategory = category;
    return err;
}

function groupScopeParams(subjectId, { scope = 'class', classId } = {}) {
    const params = new URLSearchParams({ subjectId });
    if (scope === 'unit') params.set('scope', 'unit');
    else if (classId) params.set('classId', classId);
    return params;
}

/**
 * Estado de la práctica compartida de un alcance: cuántas personas forman el
 * grupo, si ya hay una práctica abierta, qué respondió quien consulta y si el
 * grupo ya asentó un resultado común. No genera nada.
 */
export async function getGroupQuiz({ subjectId, scope = 'class', classId } = {}) {
    const params = groupScopeParams(subjectId, { scope, classId });
    const res = await apiFetch(`${BASE_URL}/group-quiz?${params}`);
    if (!res.ok) {
        let data = null;
        try { data = await res.json(); } catch {}
        throw quizError(data?.error?.message || `Error ${res.status}: no se pudo leer la práctica del grupo`, res, data);
    }
    return res.json();
}

/**
 * Abre la práctica compartida. Si ya hay una abierta para ese alcance la
 * devuelve tal cual (`reused: true`): el conjunto es el mismo para todo el
 * grupo y sólo la primera apertura gasta una generación.
 */
export async function createGroupQuiz({ subjectId, scope = 'class', classId, classIds, topics, subjectName, unitName, questionCount }) {
    const payload = { subjectId, scope };
    if (scope === 'unit') {
        if (Array.isArray(classIds)) payload.classIds = classIds;
        if (Array.isArray(topics) && topics.length) payload.topics = topics;
        if (unitName) payload.unitName = unitName;
    } else if (classId) {
        payload.classId = classId;
    }
    if (subjectName) payload.subjectName = subjectName;
    if (questionCount) payload.questionCount = questionCount;

    const res = await apiFetch(`${BASE_URL}/group-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        let data = null;
        try { data = await res.json(); } catch {}
        if (res.status === 429) {
            const err = quizError('Límite de intentos alcanzado. Esperá unos segundos.', res, data);
            err.errorCategory = 'RATE_LIMIT';
            throw err;
        }
        throw quizError(data?.error?.message || `Error ${res.status}: no se pudo abrir la práctica del grupo`, res, data);
    }
    return res.json();
}

/** La respuesta individual a la práctica común. Se corrige en el servidor. */
export async function saveGroupQuizResponse({ subjectId, groupQuizId, answers }) {
    const res = await apiFetch(`${BASE_URL}/group-quiz-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, groupQuizId, answers }),
    });
    if (!res.ok) {
        let data = null;
        try { data = await res.json(); } catch {}
        throw quizError(data?.error?.message || `Error ${res.status}: no se pudo guardar tu respuesta`, res, data);
    }
    return res.json();
}

/**
 * La comparación del grupo. El servidor la cierra con 409
 * `GROUP_QUIZ_NOT_ANSWERED` hasta que la persona respondió la suya.
 */
export async function getGroupQuizComparison({ subjectId, groupQuizId }) {
    const params = new URLSearchParams({ subjectId, groupQuizId });
    const res = await apiFetch(`${BASE_URL}/group-quiz-comparison?${params}`);
    if (!res.ok) {
        let data = null;
        try { data = await res.json(); } catch {}
        throw quizError(data?.error?.message || `Error ${res.status}: no se pudo cargar la comparación del grupo`, res, data);
    }
    return res.json();
}

/** Asienta el resultado común del grupo con los temas que no pudo acordar. */
export async function saveGroupQuizRecord({ subjectId, groupQuizId }) {
    const res = await apiFetch(`${BASE_URL}/group-quiz-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, groupQuizId }),
    });
    if (!res.ok) {
        let data = null;
        try { data = await res.json(); } catch {}
        throw quizError(data?.error?.message || `Error ${res.status}: no se pudo asentar el resultado común`, res, data);
    }
    return res.json();
}
