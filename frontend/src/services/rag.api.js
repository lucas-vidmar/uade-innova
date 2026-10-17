import {
    BASE_URL, apiFetch, fetchWithTimeout, delay, parseApiError
} from './core.js';

const parseRetryAfter = (res, fallback = 60) => {
    const header = res?.headers?.get('Retry-After');
    const seconds = parseInt(header, 10);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
};

export async function ragQuery({ question, classIds, subjectId, conversationHistory = [], historyWindowSize = 4, transcriptFocus = null, sandbox = false, simulateStudent = false, botTone, botLength, includeSources }) {
    try {
        const res = await apiFetch(`${BASE_URL}/rag-query${sandbox ? '?sandbox=true' : ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, classIds, subjectId, stream: false, conversationHistory, historyWindowSize, transcriptFocus, sandbox, simulateStudent, botTone, botLength, includeSources }),
        });

        if (res.status === 429) {
            const rateLimitError = new Error('Límite de consultas alcanzado');
            rateLimitError.status = 429;
            rateLimitError.errorCategory = 'RATE_LIMIT';
            rateLimitError.retryAfterSec = parseRetryAfter(res);
            throw rateLimitError;
        }

        if (!res.ok) {
            return { answer: 'Lo siento, no pude obtener una respuesta de la IA en este momento.', sources: [] };
        }

        return res.json();
    } catch (err) {
        if (err?.errorCategory === 'RATE_LIMIT') throw err;
        console.error('[API] ragQuery failed:', err);
        return { answer: 'Error de conexión con el servicio de IA.', sources: [] };
    }
}

export async function ragQueryStream({ question, classIds, subjectId, sessionId, conversationHistory = [], historyWindowSize = 4, transcriptFocus = null, sandbox = false, simulateStudent = false, botTone, botLength, includeSources }, onEvent) {
    const response = await apiFetch(`${BASE_URL}/rag-query${sandbox ? '?sandbox=true' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, classIds, subjectId, sessionId, stream: true, conversationHistory, historyWindowSize, transcriptFocus, sandbox, simulateStudent, botTone, botLength, includeSources }),
    });

    if (response.status === 429) {
        const rateLimitError = new Error('Límite de consultas alcanzado');
        rateLimitError.status = 429;
        rateLimitError.errorCategory = 'RATE_LIMIT';
        rateLimitError.retryAfterSec = parseRetryAfter(response);
        throw rateLimitError;
    }

    if (!response.ok) {
        // Use shared parser for HTML/JSON + status-aware fallback (fixes generic UNKNOWN)
        const apiError = await parseApiError(response, `No se pudo iniciar el stream de respuesta`);
        if (!apiError.errorCategory) {
            if (response.status === 400) apiError.errorCategory = 'VALIDATION';
            else if (response.status === 401 || response.status === 403) apiError.errorCategory = 'AUTH';
            else if (response.status === 404) apiError.errorCategory = 'NOT_FOUND';
            else if (response.status === 429) apiError.errorCategory = 'RATE_LIMIT';
            else if (response.status >= 500) apiError.errorCategory = 'INTERNAL';
        }
        if (response.status === 429) {
            apiError.retryAfterSec = parseRetryAfter(response);
            apiError.errorCategory = 'RATE_LIMIT';
        }
        throw apiError;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // UJ-29 (#378): el stream puede cerrar sin evento terminal (conexión caída a
    // mitad de la respuesta). Sin esta marca, la función resolvía igual que una
    // respuesta completa y el llamador mostraba el texto parcial como si fuera
    // el final. Solo `done` y `error` cierran el turno.
    let sawTerminalEvent = false;

    const handlePart = (part) => {
        if (!part || !part.trim()) return;

        const lines = part.split('\n');
        let eventType = 'message';
        let data = null;

        for (const line of lines) {
            if (line.startsWith('event: ')) {
                eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
                try {
                    data = JSON.parse(line.slice(6));
                } catch (e) {
                    console.error('Error parseando SSE data:', line);
                }
            }
        }

        if (data && typeof onEvent === 'function') {
            if (eventType === 'done' || eventType === 'error') sawTerminalEvent = true;
            onEvent(eventType, data);
        }
    };

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop();

            if (buffer.length > 50000) {
                buffer = '';
            }

            for (const part of parts) handlePart(part);
        }
        // #378: el último evento puede llegar sin el separador final; se procesa
        // antes de decidir si el turno quedó sin cerrar (un `done` completo nunca
        // debe confundirse con un corte).
        handlePart(buffer);
        buffer = '';
    } catch (err) {
        console.error('[API] Stream interrupted:', err);
        // #378/UJ-29: el corte a mitad de la respuesta no siempre llega como
        // cierre del stream sin evento terminal; cuando la conexión se pierde
        // de verdad (red intermitente), `reader.read()` rechaza con un error de
        // transporte (p. ej. `TypeError: Failed to fetch`) sin `code` ni
        // `errorCategory`. Ese caso caía en el camino de error genérico del
        // chat: descartaba lo ya recibido y no ofrecía reintentar, obligando a
        // reescribir la pregunta. Se clasifica igual que el truncamiento para
        // conservar el tramo recibido y ofrecer el reintento.
        // Se dejan pasar los errores ya tipados (API/AUTH/…) y las
        // cancelaciones explícitas (AbortError), que no son un corte de red.
        const yaTipado = Boolean(err?.code || err?.errorCategory);
        const esCancelacion = err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
        if (yaTipado || esCancelacion) throw err;
        const interruptedError = new Error('La respuesta se interrumpió antes de completarse.');
        interruptedError.name = 'StreamInterruptedError';
        interruptedError.code = 'STREAM_INTERRUPTED';
        interruptedError.errorCategory = 'STREAM_INTERRUPTED';
        interruptedError.retryable = true;
        interruptedError.cause = err;
        throw interruptedError;
    }

    if (!sawTerminalEvent) {
        const interruptedError = new Error('La respuesta se interrumpió antes de completarse.');
        interruptedError.name = 'StreamInterruptedError';
        interruptedError.code = 'STREAM_INTERRUPTED';
        interruptedError.errorCategory = 'STREAM_INTERRUPTED';
        interruptedError.retryable = true;
        throw interruptedError;
    }
}

export async function globalSearch({ query, subjectId, userId }) {
    const res = await apiFetch(`${BASE_URL}/global-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, subjectId, userId }),
    });

    if (!res.ok) {
        let errorMessage = 'Error en búsqueda global';
        let errorCategory = null;
        try {
            const errorData = await res.json();
            if (errorData && errorData.error) errorMessage = errorData.error;
            if (errorData && errorData.errorCategory) errorCategory = errorData.errorCategory;
        } catch {}
        const apiError = new Error(`Error ${res.status}: ${errorMessage}`);
        apiError.status = res.status;
        apiError.errorCategory = errorCategory;
        throw apiError;
    }

    const data = await res.json();
    return data && Array.isArray(data.results) ? data : { query, subjectId, total: 0, results: [] };
}

export async function getChatHistory(subjectId) {
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/chat-history?subjectId=${subjectId}`, { timeout: 4000 });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error('[API] getChatHistory failed:', err);
        return [];
    }
}

export async function clearChatHistory(subjectId) {
    try {
        const res = await apiFetch(`${BASE_URL}/chat-history?subjectId=${subjectId}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error(`Error ${res.status}: clearChatHistory`);
        return res.json();
    } catch (err) {
        console.error('[API] clearChatHistory failed:', err);
        throw err;
    }
}

// Borrado de un solo hilo. El listado de "Chats recientes" se arma con los
// blobs de chat-logs, así que borrar el hilo tiene que alcanzarlos: el
// endpoint recibe el sessionId y borra sus turnos y su conversación guardada.
export async function deleteChatSession(sessionId, subjectId) {
    const res = await apiFetch(`${BASE_URL}/chat-history?subjectId=${encodeURIComponent(subjectId)}&sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE'
    });
    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo eliminar el hilo`;
        try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function sendChatFeedback({ messageId, subjectId, isPositive }) {
    const res = await apiFetch(`${BASE_URL}/chat-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, subjectId, isPositive })
    });
    // #330: surface server errors instead of throwing a raw SyntaxError on a
    // non-JSON body — callers show an explicit toast.
    let data = null;
    try {
        data = await res.json();
    } catch {
        throw new Error(`Error ${res.status}: no se pudo guardar tu valoración. Intentá de nuevo.`);
    }
    if (!res.ok) {
        const message = data?.error || `Error ${res.status}: no se pudo guardar tu valoración. Intentá de nuevo.`;
        const err = new Error(message);
        err.status = res.status;
        throw err;
    }
    return data;
}

export async function sendChatRating({ sessionId, messageId, subjectId, classId, rating, comment }) {
    const res = await apiFetch(`${BASE_URL}/chat-rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, messageId, subjectId, classId, rating, comment: comment || '' })
    });
    // #330: same hardening as sendChatFeedback — never throw a raw
    // SyntaxError on a non-JSON body; surface an actionable Error instead.
    let data = null;
    try {
        data = await res.json();
    } catch {
        throw new Error(`Error ${res.status}: no se pudo guardar tu calificación. Intentá de nuevo.`);
    }
    if (!res.ok) {
        const message = data?.error || `Error ${res.status}: no se pudo guardar tu calificación. Intentá de nuevo.`;
        const err = new Error(message);
        err.status = res.status;
        throw err;
    }
    return data;
}

export async function getSatAnalytics({ subjectId, classId, days }) {
    let url = `${BASE_URL}/sat-analytics?subjectId=${encodeURIComponent(subjectId)}`;
    if (classId) url += `&classId=${encodeURIComponent(classId)}`;
    if (days) url += `&days=${Number(days)}`;
    const res = await apiFetch(url);
    return res.json();
}

export async function reportChatIssue({ messageId, subjectId, classId, issueDetail, question, answer }) {
    const res = await apiFetch(`${BASE_URL}/chat-report-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `classId` viaja con el reporte: si el asistente no llegó a dejar su
        // log de chat, es lo único que permite ubicar el caso en su encuentro.
        body: JSON.stringify({ messageId, subjectId, classId: classId || '', issueDetail: String(issueDetail || '').trim(), question: question || '', answer: answer || '' })
    });
    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo reportar el problema`;
        try {
            const err = await res.json();
            if (err?.error) message = err.error;
        } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function reportMissingInfo({ messageId, subjectId, classId, expectedInfo, question }) {
    const res = await apiFetch(`${BASE_URL}/chat-report-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messageId,
            subjectId,
            issueDetail: String(expectedInfo || '').trim(),
            question: question || '',
            type: 'missing-info',
            classId: classId || '',
        })
    });
    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo reportar`;
        try {
            const err = await res.json();
            if (err?.error) message = err.error;
        } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function reportMissingKeyword({ messageId, subjectId, classId, keyword, question, answer }) {
    const res = await apiFetch(`${BASE_URL}/chat-report-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messageId,
            subjectId,
            issueDetail: String(keyword || '').trim(),
            question: question || '',
            answer: answer || '',
            type: 'missing-keyword',
            classId: classId || '',
        })
    });
    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo reportar`;
        try {
            const err = await res.json();
            if (err?.error) message = err.error;
        } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function saveConversation({ conversationId, subjectId, messages }) {
    const res = await apiFetch(`${BASE_URL}/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, messages }),
    });
    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo guardar la conversación`;
        try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function listConversations(subjectId) {
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/conversations?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error('[API] listConversations failed:', err);
        return [];
    }
}

export async function getConversation(conversationId, subjectId) {
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/conversations/${encodeURIComponent(conversationId)}?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
        if (!res.ok) return null;
        return res.json();
    } catch (err) {
        console.error('[API] getConversation failed:', err);
        return null;
    }
}

export async function deleteConversation(conversationId, subjectId) {
    const res = await apiFetch(`${BASE_URL}/conversations/${encodeURIComponent(conversationId)}?subjectId=${encodeURIComponent(subjectId)}`, {
        method: 'DELETE',
    });
    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo eliminar la conversación`;
        try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
        throw new Error(message);
    }
    return res.json();
}
