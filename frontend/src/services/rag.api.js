import {
    USE_MOCK, BASE_URL, apiFetch, fetchWithTimeout, delay,
    readLocalJson, writeLocalJson
} from './core.js';

const MOCK_REPORTS_KEY = 'uade.mock.ai-reports';

import { getMock } from './mocks/accessor.js';

export async function ragQuery({ question, classIds, subjectId, conversationHistory = [], historyWindowSize = 4, transcriptFocus = null }) {
    if (USE_MOCK) {
        await delay(1200);
        const q = question.toLowerCase();
        const responses = await getMock('MOCK_RAG_RESPONSES', []);
        const match = responses.find(r => r.question.some(kw => q.includes(kw)));
        const response = match || {
            answer: `Basándome en las clases seleccionadas (${classIds.length} clase${classIds.length !== 1 ? 's' : ''}), no encontré una respuesta específica para tu consulta sobre "${question}". Sin embargo, te recomiendo revisar los apuntes de las clases sobre patrones arquitectónicos y el resumen de la Clase 1.`,
            sources: [],
        };
        return { ...response, verified: response.verified || false };
    }
    try {
        const res = await apiFetch(`${BASE_URL}/rag-query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, classIds, subjectId, stream: false, conversationHistory, historyWindowSize, transcriptFocus }),
        });

        if (res.status === 429) {
            throw new Error('The AI tutor is resting, please try again in a few minutes');
        }

        if (!res.ok) {
            return { answer: 'Lo siento, no pude obtener una respuesta de la IA en este momento.', sources: [] };
        }

        return res.json();
    } catch (err) {
        console.error('[API] ragQuery failed:', err);
        return { answer: 'Error de conexión con el servicio de IA.', sources: [] };
    }
}

export async function ragQueryStream({ question, classIds, subjectId, sessionId, conversationHistory = [], historyWindowSize = 4, transcriptFocus = null }, onEvent) {
    if (USE_MOCK) {
        await delay(400);
        if (typeof onEvent === 'function') onEvent('metadata', {
            interactionId: 'mock-id-' + Date.now(),
            sources: [
                { materialType: 'transcript', sourceFilename: 'clase3_transcript.txt', classId: 'class-03' },
                { materialType: 'presentation', sourceFilename: 'clase3_slides.pdf', classId: 'class-03' }
            ],
            verified: false,
        });
        const mockText = "Esta es una respuesta simulada por stream. La arquitectura hexagonal permite desacoplar la lógica de negocio de los detalles técnicos.";
        const words = mockText.split(' ');
        for (const word of words) {
            await delay(50);
            if (typeof onEvent === 'function') onEvent('delta', { content: word + ' ' });
        }
        if (typeof onEvent === 'function') onEvent('done', { answer: mockText });
        return;
    }

    const response = await apiFetch(`${BASE_URL}/rag-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, classIds, subjectId, sessionId, stream: true, conversationHistory, historyWindowSize, transcriptFocus }),
    });

    if (response.status === 429) {
        const rateLimitError = new Error('The AI tutor is resting, please try again in a few minutes');
        rateLimitError.errorCategory = 'LLM';
        throw rateLimitError;
    }

    if (!response.ok) {
        let errorMessage = `No se pudo iniciar el stream de respuesta`;
        let errorCategory = null;
        try {
            const errorData = await response.json();
            if (errorData && errorData.error) {
                errorMessage = errorData.error;
            }
            if (errorData && errorData.errorCategory) {
                errorCategory = errorData.errorCategory;
            }
        } catch (e) {
            errorMessage = response.statusText || errorMessage;
        }
        const apiError = new Error(`Error ${response.status}: ${errorMessage}`);
        apiError.status = response.status;
        if (errorCategory) apiError.errorCategory = errorCategory;
        throw apiError;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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

            for (const part of parts) {
                if (!part.trim()) continue;

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
                    onEvent(eventType, data);
                }
            }
        }
    } catch (err) {
        console.error('[API] Stream interrupted:', err);
        throw err;
    }
}

export async function globalSearch({ query, subjectId }) {
    if (USE_MOCK) {
        await delay(450);
        const needle = String(query || '').toLowerCase();
        const searchResults = await getMock('MOCK_GLOBAL_SEARCH_RESULTS', []);
        const results = searchResults.filter(item =>
            item.snippet.toLowerCase().includes(needle) || item.sourceFilename.toLowerCase().includes(needle)
        );
        return { query, subjectId, total: results.length, results };
    }

    const res = await apiFetch(`${BASE_URL}/global-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, subjectId }),
    });

    if (!res.ok) {
        let errorMessage = 'Error en búsqueda global';
        let errorCategory = null;
        try {
            const errorData = await res.json();
            if (errorData && errorData.error) errorMessage = errorData.error;
            if (errorData && errorData.errorCategory) errorCategory = errorData.errorCategory;
        } catch { /* ignore parse errors */ }
        const apiError = new Error(`Error ${res.status}: ${errorMessage}`);
        apiError.status = res.status;
        apiError.errorCategory = errorCategory;
        throw apiError;
    }

    const data = await res.json();
    return data && Array.isArray(data.results) ? data : { query, subjectId, total: 0, results: [] };
}

export async function getChatHistory(subjectId) {
    if (USE_MOCK) {
        await delay(600);
        return [
            { id: 'h1', question: '¿Qué es la arquitectura hexagonal?', answer: 'La arquitectura hexagonal...', createdAt: '2026-04-10T10:00:00Z' },
            { id: 'h2', question: 'Diferencia entre CQRS y Event Sourcing', answer: 'CQRS separa lectura de escritura...', createdAt: '2026-04-11T11:00:00Z' },
            { id: 'h3', question: '¿Cómo funciona SAGA pattern?', answer: 'El patrón SAGA gestiona transacciones...', createdAt: '2026-04-12T12:00:00Z' },
            { id: 'h4', question: '¿Para qué sirve DDD?', answer: 'DDD organiza el dominio en modelos...', createdAt: '2026-04-13T09:30:00Z' },
            { id: 'h5', question: '¿Qué es el bounded context?', answer: 'Es un limite semantico del modelo...', createdAt: '2026-04-14T15:20:00Z' }
        ];
    }
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
    if (USE_MOCK) return { success: true, count: 0 };
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

export async function sendChatFeedback({ messageId, subjectId, isPositive }) {
    if (USE_MOCK) return { success: true };
    const res = await apiFetch(`${BASE_URL}/chat-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, subjectId, isPositive })
    });
    return res.json();
}

export async function sendChatRating({ sessionId, messageId, subjectId, classId, rating, comment }) {
    if (USE_MOCK) return { success: true };
    const res = await apiFetch(`${BASE_URL}/chat-rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, messageId, subjectId, classId, rating, comment: comment || '' })
    });
    return res.json();
}

export async function getSatAnalytics({ subjectId, classId, days }) {
    if (USE_MOCK) {
        await delay(300);
        const segments = [
            { promptVersion: 'v1', rated: 12, positive: 9, satScore: 0.75 },
            { promptVersion: 'v2', rated: 8, positive: 7, satScore: 0.875 },
        ];
        const filtered = classId ? segments.filter(() => false) : [];
        return {
            segments: filtered,
            total: filtered.reduce((s, x) => s + x.rated, 0),
            filter: { subjectId, classId: classId || null, windowDays: days || 30 },
            winner: { state: 'insufficient_data', reason: 'insufficient_data_both' },
        };
    }
    let url = `${BASE_URL}/sat-analytics?subjectId=${encodeURIComponent(subjectId)}`;
    if (classId) url += `&classId=${encodeURIComponent(classId)}`;
    if (days) url += `&days=${Number(days)}`;
    const res = await apiFetch(url);
    return res.json();
}

export async function reportChatIssue({ messageId, subjectId, issueDetail, question, answer }) {
    if (USE_MOCK) {
        await delay(200);
        const correctionId = `corr-${Date.now()}`;
        const alertId = `ai-issue-${messageId || Date.now()}`;
        const reports = readLocalJson(MOCK_REPORTS_KEY, []);
        reports.unshift({
            correctionId,
            subjectId,
            messageId,
            question: question || '',
            originalAnswer: answer || '',
            issueDetail: String(issueDetail || '').trim(),
            status: 'pending',
            classId: 'unknown',
            studentId: sessionStorage.getItem('edu_uid') || 'alu-001',
            createdAt: new Date().toISOString(),
        });
        writeLocalJson(MOCK_REPORTS_KEY, reports);
        return { success: true, alertId, correctionId };
    }
    const res = await apiFetch(`${BASE_URL}/chat-report-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, subjectId, issueDetail: String(issueDetail || '').trim(), question: question || '', answer: answer || '' })
    });
    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo reportar el problema`;
        try {
            const err = await res.json();
            if (err?.error) message = err.error;
        } catch {
            // no-op
        }
        throw new Error(message);
    }
    return res.json();
}

export async function saveConversation({ conversationId, subjectId, messages }) {
    if (USE_MOCK) {
        await delay(300);
        return { success: true, conversationId };
    }
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
    if (USE_MOCK) { await delay(300); return []; }
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
    if (USE_MOCK) { await delay(300); return null; }
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
    if (USE_MOCK) { await delay(200); return { success: true }; }
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
