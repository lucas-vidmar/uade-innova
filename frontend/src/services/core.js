import { safeSetItem } from './local-storage.js';

export const LOCAL_SUBJECTS_KEY = 'uade.local.subjects';
export const LOCAL_CLASSES_KEY = 'uade.local.classes-by-subject';

const configuredBaseUrl = (typeof import.meta !== 'undefined' && import.meta.env)
    ? String(import.meta.env.VITE_API_BASE_URL || '').trim()
    : '';

const isLocalRuntime = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const isLocalApiUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(configuredBaseUrl);

if (import.meta.env.DEV && !isLocalRuntime && configuredBaseUrl && isLocalApiUrl) {
    console.warn('[API] Ignoring local VITE_API_BASE_URL in remote runtime:', configuredBaseUrl);
}

export const BASE_URL = (!isLocalRuntime && isLocalApiUrl)
    ? '/api'
    : (configuredBaseUrl
        || (isLocalRuntime
            ? 'http://localhost:7071/api'
            : '/api'));

export const CORRELATION_HEADER = 'x-correlation-id';
export const TRACEPARENT_HEADER = 'traceparent';
export const TRACESTATE_HEADER = 'tracestate';

function fallbackUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

const _sessionCorrelationId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : fallbackUuid();

export function nextCorrelationId() {
    return _sessionCorrelationId;
}

function generateSpanId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function generateTraceParent() {
    const traceId = nextCorrelationId().replace(/-/g, '').toLowerCase().padEnd(32, '0').slice(0, 32);
    const spanId = generateSpanId();
    return `00-${traceId}-${spanId}-01`;
}

export function withCorrelationHeaders(headers = {}) {
    const normalized = new Headers(headers || {});
    if (!normalized.has(CORRELATION_HEADER)) {
        normalized.set(CORRELATION_HEADER, nextCorrelationId());
    }
    if (!normalized.has(TRACEPARENT_HEADER)) {
        const stored = window.sessionStorage.getItem('w3c_traceparent');
        normalized.set(TRACEPARENT_HEADER, stored || generateTraceParent());
    }

    return normalized;
}

export async function apiFetch(resource, options = {}) {
    let url = resource;

    const headers = withCorrelationHeaders(options.headers);

    // Dev/preview-only mock identity relay: in dev and preview builds where
    // VITE_MOCK_AUTH_ENABLED=true, forward the local mock role/uid so the demo
    // persona still reaches the backend mock path. NEVER in production: the
    // server authorizes from the opaque session token, never from a client
    // submitted role.
    const devMock = (() => {
        try {
            return import.meta.env.DEV || import.meta.env.VITE_MOCK_AUTH_ENABLED === 'true';
        } catch {
            return false;
        }
    })();
    if (devMock) {
        const params = new URLSearchParams();
        const mockRole = sessionStorage.getItem('edu_role');
        if (mockRole) params.set('_mock_role', mockRole);
        const eduUid = sessionStorage.getItem('edu_uid');
        if (eduUid) params.set('_mock_uid', eduUid);
        const qs = params.toString();
        if (qs) url = resource + (resource.includes('?') ? '&' : '?') + qs;
    }

    // Attach the opaque session token (Authorization: Bearer) when present
    // (Story 1.1a rewrite). The server resolves role/scope from the Users +
    // Enrollments tables — never from a client-submitted email/role.
    try {
        const token = window.sessionStorage.getItem('edu_token');
        if (token) headers.set('Authorization', `Bearer ${token}`);
    } catch (_) {}

    return fetch(url, {
        ...options,
        headers,
    });
}

export function delay(ms = 600) { return new Promise(r => setTimeout(r, ms)); }

/**
 * True for request cancellations (timeout aborts, SSE stream stops on route
 * change). Callers should silence these instead of logging console errors
 * (fix #346: AbortError noise on subject switch / navigation).
 * @param {*} err
 */
export function isAbortError(err) {
    return !!err && (err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.code === 20);
}

/**
 * Parses a non-ok response into a structured Error carrying `status`, `code`
 * and `errorCategory` so pages can distinguish auth/config denials (403) from
 * transient/5xx failures (Story 10.24). Handles both the shared contract
 * `{ error, errorCategory, code }` and the corrections shape
 * `{ success:false, error:{ code, message } }`. When the body is HTML
 * (e.g. SWA without linked backend → 404/405) or empty, maps the HTTP
 * status to an actionable fallback instead of bubbling the generic one.
 * @param {Response} res
 * @param {string} fallbackMessage
 * @returns {Promise<Error>}
 */
export async function parseApiError(res, fallbackMessage = `Error ${res.status}`) {
    let payload = null;
    let rawText = '';
    try {
        // Clone so we can try json then text without consuming the stream twice.
        const clone = typeof res.clone === 'function' ? res.clone() : res;
        payload = await clone.json();
    } catch {
        try {
            const clone2 = typeof res.clone === 'function' ? res.clone() : res;
            rawText = await clone2.text();
        } catch { /* ignore */ }
    }
    const nested = payload?.error;
    const hasNestedShape = nested && typeof nested === 'object';
    const code = hasNestedShape ? nested.code : (payload?.code || 'UNKNOWN_ERROR');
    let message = hasNestedShape ? nested.message : (nested || payload?.error || null);
    // Fallback is HTML (SWA 404/405/502) — don't leak markup into the UI.
    if (rawText && !message && /^\s*<!doctype|^\s*<html/i.test(rawText)) {
        message = null;
    }
    const errorCategory = hasNestedShape ? nested.errorCategory : (payload?.errorCategory || null);

    const status = Number(res?.status) || 500;
    // Status-aware actionable fallback when the body carried no message
    // (HTML, empty, or non-JSON). Keep a server-provided message when present.
    const statusFallback = (() => {
        if (status === 400) return 'Revisá los datos ingresados.';
        if (status === 401) return 'Credenciales inválidas. Verificá tu email y contraseña.';
        if (status === 403) return 'Tu cuenta está deshabilitada. Contactá a administración.';
        if (status === 429) return 'Demasiados intentos. Intentá de nuevo en unos minutos.';
        if (status === 404 || status === 405) return 'Servicio de autenticación no disponible. Verificá tu conexión e intentá de nuevo.';
        if (status >= 500) return 'Servicio no disponible. Intentá de nuevo en unos minutos.';
        return null;
    })();
    const resolvedMessage = String(message || statusFallback || fallbackMessage);

    const err = new Error(resolvedMessage);
    err.status = status;
    err.code = code;
    if (errorCategory) err.errorCategory = errorCategory;
    err.retryable = err.status >= 500;
    if (rawText) err.rawBodyPreview = rawText.slice(0, 400);
    return err;
}

export async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 5000 } = options;

    const controller = new AbortController();
    let timedOut = false;
    const id = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);

    try {
        return await apiFetch(resource, {
            ...options,
            signal: controller.signal
        });
    } catch (err) {
        // #379 (UJ-28/UJ-29): un timeout propio no es un fallo de la página. Se
        // clasifica como error de conexión reintentable para que la interfaz pueda
        // mostrar un mensaje claro en vez del error crudo del navegador
        // ("signal is aborted without reason") ni reemplazar la pantalla entera.
        if (timedOut && err?.name === 'AbortError') {
            const timeoutError = new Error('La conexión tardó demasiado. Revisá tu conexión e intentá de nuevo.');
            timeoutError.name = 'TimeoutError';
            timeoutError.code = 'TIMEOUT';
            timeoutError.errorCategory = 'TIMEOUT';
            timeoutError.retryable = true;
            timeoutError.status = 408;
            throw timeoutError;
        }
        throw err;
    } finally {
        clearTimeout(id);
    }
}

/**
 * Shared read path for list endpoints (fix #352).
 *
 * Without `strict`, a failed read degrades to `fallback` (the historical
 * behaviour kept for the many callers that only need best-effort data).
 * With `strict: true` the failure is propagated as a structured error, so a
 * page can tell "no hay datos" apart from "no se pudieron leer los datos"
 * instead of telling the student there is nothing pending.
 *
 * @param {string} resource
 * @param {{timeout?: number, strict?: boolean, fallback?: any[], label?: string}} options
 * @returns {Promise<any[]>}
 */
export async function readList(resource, { timeout = 5000, strict = false, fallback = [], label = '[API]' } = {}) {
    let res;
    try {
        res = await fetchWithTimeout(resource, { timeout });
    } catch (err) {
        if (strict) throw err;
        console.error(`${label} failed:`, err);
        return fallback;
    }
    if (!res.ok) {
        if (strict) throw await parseApiError(res, `No se pudieron leer los datos (HTTP ${res.status}).`);
        console.error(`${label} failed: HTTP ${res.status}`);
        return fallback;
    }
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? data : [];
}

export function readLocalJson(key, fallbackValue) {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallbackValue;
        const parsed = JSON.parse(raw);
        return parsed ?? fallbackValue;
    } catch {
        return fallbackValue;
    }
}

export function writeLocalJson(key, value) {
    safeSetItem(key, JSON.stringify(value));
}
