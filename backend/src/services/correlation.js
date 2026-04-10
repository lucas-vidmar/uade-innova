import { v4 as uuidv4 } from 'uuid';

const CORRELATION_HEADER = 'x-correlation-id';
const MAX_HEADER_LENGTH = 128;
const SAFE_HEADER_PATTERN = /^[a-zA-Z0-9-_.:]+$/;

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
 * Returns outbound dependency headers carrying correlation context.
 * @param {string} correlationId
 * @returns {Record<string, string>}
 */
export function buildDependencyHeaders(correlationId) {
    const safe = sanitizeCorrelationId(correlationId) || uuidv4();
    return {
        [CORRELATION_HEADER]: safe,
    };
}

/**
 * Returns response headers that expose correlation context to the caller.
 * @param {string} correlationId
 * @param {Record<string, string>} [baseHeaders]
 * @returns {Record<string, string>}
 */
export function withCorrelationResponseHeaders(correlationId, baseHeaders = {}) {
    const safe = sanitizeCorrelationId(correlationId) || uuidv4();
    return {
        ...baseHeaders,
        [CORRELATION_HEADER]: safe,
    };
}
