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

    // Dev/preview-only mock identity relay (Story 1.1a): in dev and preview
    // builds where VITE_MOCK_AUTH_ENABLED=true, forward the local mock role/uid
    // so the demo persona still reaches the backend mock path. NEVER in
    // production: the server authorizes from the allowlist using the SWA-relayed
    // email, never from a client-submitted role.
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

    // Relay the SWA-resolved identity to the backend (Story 1.1a). The backend
    // authorizes from the server-side allowlist using this email — the browser
    // only mirrors what `/.auth/me` reported; it never chooses a role. When the
    // SWA `/api` proxy is enabled the trusted `x-ms-client-principal` header
    // takes precedence server-side and this header is ignored.
    try {
        const email = window.sessionStorage.getItem('edu_email');
        if (email) headers.set('x-ms-client-principal-name', email);
    } catch (_) {}

    return fetch(url, {
        ...options,
        headers,
    });
}

export function delay(ms = 600) { return new Promise(r => setTimeout(r, ms)); }

export async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 5000 } = options;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const response = await apiFetch(resource, {
        ...options,
        signal: controller.signal
    });
    clearTimeout(id);
    return response;
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
