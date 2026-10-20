import {
    BASE_URL, apiFetch, fetchWithTimeout, delay, parseApiError
} from './core.js';

const parseRetryAfter = (res, fallback = 60) => {
    const header = res?.headers?.get('Retry-After');
    const seconds = parseInt(header, 10);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
};

export async function ragQuery({ question, classIds, subjectId, conversationHistory = [], historyWindowSize = 4, transcriptFocus = null, sandbox = false, simulateStudent = false, botTone, botLength, includeSources, promptVersion = null, lengthOverride = null }) {
    try {
        const res = await apiFetch(`${BASE_URL}/rag-query${sandbox ? '?sandbox=true' : ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // `promptVersion` sólo viaja en modo banco de pruebas: es la versión
            // PROPUESTA que se enfrenta contra la vigente sin activarla (UJ-49).
            // #479: `lengthOverride` es un pedido de longitud para ESTA consulta;
            // no modifica las preferencias guardadas de la persona.
            body: JSON.stringify({ question, classIds, subjectId, stream: false, conversationHistory, historyWindowSize, transcriptFocus, sandbox, simulateStudent, botTone, botLength, includeSources, ...(lengthOverride ? { lengthOverride } : {}), ...(sandbox && promptVersion ? { promptVersion } : {}) }),
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

// #406: un asistente que no responde (red colgada, stream que deja de fluir) no
// puede dejar la pantalla sin salida. Estos topes son deliberadamente generosos:
// no cortan una respuesta lenta legítima, sólo declaran el caso en el que ya no
// está llegando nada. `window.__uadeChatStreamTimeouts` permite acortarlos en las
// pruebas (guiones del arnés y specs e2e); en producción valen los valores por
// defecto.
const DEFAULT_FIRST_EVENT_TIMEOUT_MS = 60000;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;

function streamTimeouts() {
    let override = {};
    try {
        override = (typeof window !== 'undefined' && window.__uadeChatStreamTimeouts) || {};
    } catch { /* sin window */ }
    const pick = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    return {
        firstEventMs: pick(override.firstByteMs, DEFAULT_FIRST_EVENT_TIMEOUT_MS),
        idleMs: pick(override.idleMs, DEFAULT_IDLE_TIMEOUT_MS),
    };
}

function streamTimeoutError() {
    const err = new Error('El asistente está tardando más de lo esperado.');
    err.name = 'StreamTimeoutError';
    err.code = 'STREAM_TIMEOUT';
    err.errorCategory = 'TIMEOUT';
    err.retryable = true;
    return err;
}

export async function ragQueryStream({ question, classIds, subjectId, sessionId, conversationHistory = [], historyWindowSize = 4, transcriptFocus = null, sandbox = false, simulateStudent = false, botTone, botLength, includeSources, promptVersion = null, lengthOverride = null, signal } = {}, onEvent) {
    const { firstEventMs, idleMs } = streamTimeouts();

    // #406: la demora se corta con un AbortController propio, encadenado al del
    // llamador — así la persona puede cancelar desde la interfaz sin esperar el
    // tope, y el tope libera la pantalla aunque nadie cancele.
    const controller = new AbortController();
    let timedOut = false;
    let reader = null;
    const relayAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', relayAbort);
    }

    let watchdog = null;
    const armWatchdog = (ms) => {
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
            timedOut = true;
            // Cortar el cuerpo además de la petición: con las cabeceras ya
            // recibidas, el `read()` pendiente tiene que resolverse igual.
            try { reader?.cancel(); } catch { /* ya cerrado */ }
            controller.abort();
        }, ms);
    };
    const disarmWatchdog = () => { if (watchdog) { clearTimeout(watchdog); watchdog = null; } };
    const release = () => {
        disarmWatchdog();
        if (signal) signal.removeEventListener('abort', relayAbort);
    };

    let response;
    try {
        armWatchdog(firstEventMs);
        response = await apiFetch(`${BASE_URL}/rag-query${sandbox ? '?sandbox=true' : ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // `promptVersion` sólo viaja en modo banco de pruebas (UJ-49): es la
            // versión propuesta que se enfrenta contra la vigente sin activarla.
            // #479: `lengthOverride` es un pedido de longitud para ESTA consulta;
            // no modifica las preferencias guardadas de la persona.
            body: JSON.stringify({ question, classIds, subjectId, sessionId, stream: true, conversationHistory, historyWindowSize, transcriptFocus, sandbox, simulateStudent, botTone, botLength, includeSources, ...(lengthOverride ? { lengthOverride } : {}), ...(sandbox && promptVersion ? { promptVersion } : {}) }),
            signal: controller.signal,
        });
    } catch (err) {
        release();
        if (timedOut) throw streamTimeoutError();
        throw err;
    }

    if (response.status === 429) {
        release();
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
        release();
        throw apiError;
    }

    reader = response.body.getReader();
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

    let chunksRead = 0;
    try {
        while (true) {
            // #406: el primer evento tiene su propio tope (cubre recuperación del
            // lado del servidor + arranque del modelo); después alcanza el tope de
            // inactividad entre eventos.
            armWatchdog(chunksRead === 0 ? firstEventMs : idleMs);
            let step;
            try {
                step = await reader.read();
            } finally {
                disarmWatchdog();
            }
            if (step.done) break;

            chunksRead += 1;
            buffer += decoder.decode(step.value, { stream: true });
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
        // #406: si el corte lo provocó nuestro propio tope de demora, o la
        // persona desde la interfaz, no es un corte de red: no se disfraza de
        // interrupción ni pierde la clasificación que ya traía.
        if (timedOut) {
            release();
            throw streamTimeoutError();
        }
        if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') {
            release();
            throw err;
        }
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
        release();
        throw interruptedError;
    }

    release();

    // #406: el watchdog pudo resolver el `read()` pendiente cancelando el cuerpo
    // (el stream cierra "limpio" pero sin evento terminal). Eso es una demora
    // declarada, no una respuesta cortada.
    if (timedOut) throw streamTimeoutError();

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

/**
 * Cantidad de turnos en los hilos reales de la materia (UJ-49).
 *
 * La constancia del banco de pruebas necesita poder afirmar que la corrida no
 * agregó turnos a ningún hilo real. `getChatHistory` se traga el error y devuelve
 * `[]`, que se leería como «no cambió nada» sin haber medido nada; acá el fallo
 * devuelve `null` para que la constancia diga «no verificable».
 */
export async function contarTurnosReales(subjectId) {
    try {
        const res = await fetchWithTimeout(`${BASE_URL}/chat-history?subjectId=${encodeURIComponent(subjectId)}`, { timeout: 4000 });
        if (!res.ok) return null;
        const data = await res.json();
        return Array.isArray(data) ? data.length : null;
    } catch {
        return null;
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
