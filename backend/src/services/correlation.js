import { v4 as uuidv4 } from 'uuid';

const CORRELATION_HEADER = 'x-correlation-id';
const TRACEPARENT_HEADER = 'traceparent';
const TRACESTATE_HEADER = 'tracestate';
const MAX_HEADER_LENGTH = 128;
const SAFE_HEADER_PATTERN = /^[a-zA-Z0-9-_.:]+$/;
const W3C_TRACEPARENT_PATTERN = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;

function sanitizeCorrelationId(rawValue) {
    if (!rawValue) return null;
    const trimmed = String(rawValue).trim();
    if (!trimmed || trimmed.length > MAX_HEADER_LENGTH) return null;
    if (!SAFE_HEADER_PATTERN.test(trimmed)) return null;
    return trimmed;
}

/**
 * Resolves the correlation ID from request headers, generating one if absent/invalid.
 * @param {Request} request
 * @returns {string}
 */
export function resolveCorrelationId(request) {
    const incoming = request?.headers?.get?.(CORRELATION_HEADER);
    return sanitizeCorrelationId(incoming) || uuidv4();
}

export function generateCorrelationId() {
    return uuidv4();
}

/**
 * Generates a 32-char hex trace-id from a UUID.
 * @returns {string}
 */
function generateTraceId() {
    return uuidv4().replace(/-/g, '').toLowerCase();
}

/**
 * Generates a 16-char hex span-id.
 * @returns {string}
 */
function generateSpanId() {
    return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/**
 * Parses a traceparent value, returning its trace-id.
 * @param {string} tp
 * @returns {string|null}
 */
function parseTraceId(tp) {
    if (!tp || !W3C_TRACEPARENT_PATTERN.test(tp.trim())) return null;
    return tp.trim().slice(3, 35);
}

/**
 * Builds a W3C traceparent value `{version}-{traceId}-{spanId}-{flags}`.
 * @param {string} traceId - 32 hex chars
 * @param {string} [spanId] - 16 hex chars, generated if omitted
 * @param {string} [flags] - 2 hex chars, defaults to '01'
 * @returns {string}
 */
function buildTraceParent(traceId, spanId, flags = '01') {
    return `00-${traceId}-${spanId || generateSpanId()}-${flags}`;
}

/**
 * Resolves the W3C traceparent from request headers, generating one if absent/invalid.
 * The traceparent is guaranteed valid.
 * @param {Request} request
 * @returns {{ traceparent: string, tracestate: string|null, traceId: string, spanId: string }}
 */
export function resolveTraceContext(request) {
    const incoming = request?.headers?.get?.(TRACEPARENT_HEADER);
    if (incoming && W3C_TRACEPARENT_PATTERN.test(incoming.trim())) {
        const tp = incoming.trim();
        return {
            traceparent: tp,
            tracestate: request?.headers?.get?.(TRACESTATE_HEADER) || null,
            traceId: tp.slice(3, 35),
            spanId: tp.slice(36, 52),
        };
    }
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    return {
        traceparent: buildTraceParent(traceId, spanId),
        tracestate: null,
        traceId,
        spanId,
    };
}

/**
 * Creates a child span traceparent for downstream calls, preserving the trace-id
 * but generating a new span-id.
 * @param {{ traceparent: string, traceId: string }} parentTrace - result from resolveTraceContext
 * @returns {string}
 */
export function createChildTraceParent(parentTrace) {
    const traceId = parentTrace?.traceId || generateTraceId();
    return buildTraceParent(traceId);
}

/**
 * Returns outbound dependency headers carrying correlation context and W3C trace context.
 * @param {string} correlationId
 * @param {{ traceparent: string, tracestate: string|null }} [traceContext]
 * @returns {Record<string, string>}
 */
export function buildDependencyHeaders(correlationId, traceContext) {
    const safe = sanitizeCorrelationId(correlationId) || uuidv4();
    const headers = {
        [CORRELATION_HEADER]: safe,
    };
    if (traceContext) {
        headers[TRACEPARENT_HEADER] = createChildTraceParent(traceContext);
        if (traceContext.tracestate) {
            headers[TRACESTATE_HEADER] = traceContext.tracestate;
        }
    }
    return headers;
}

/**
 * Returns response headers that expose correlation and trace context to the caller.
 * Overloaded: pass baseHeaders as second arg for backward compat,
 * or traceContext (2nd) + baseHeaders (3rd) for W3C trace.
 *
 * @param {string} correlationId
 * @param {{ traceparent: string, tracestate: string|null }|Record<string, string>} [traceContextOrBaseHeaders]
 * @param {Record<string, string>} [baseHeaders]
 * @returns {Record<string, string>}
 */
export function withCorrelationResponseHeaders(correlationId, traceContextOrBaseHeaders, baseHeaders) {
    let traceContext = null;
    if (arguments.length === 2) {
        baseHeaders = traceContextOrBaseHeaders || {};
    } else if (arguments.length >= 3) {
        traceContext = traceContextOrBaseHeaders || null;
        baseHeaders = baseHeaders || {};
    }
    const safe = sanitizeCorrelationId(correlationId) || uuidv4();
    const headers = { ...(baseHeaders || {}), [CORRELATION_HEADER]: safe };
    if (traceContext) {
        headers[TRACEPARENT_HEADER] = traceContext.traceparent;
        if (traceContext.tracestate) {
            headers[TRACESTATE_HEADER] = traceContext.tracestate;
        }
    }
    return headers;
}
