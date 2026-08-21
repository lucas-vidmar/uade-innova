/**
 * services/error-categories.js — Standardized system-wide error taxonomy
 */

export const ErrorCategory = Object.freeze({
    RETRIEVAL_FAILURE: 'RETRIEVAL_FAILURE',
    SAFETY: 'SAFETY',
    PARSING: 'PARSING',
    LLM: 'LLM',
    VALIDATION: 'VALIDATION',
    AUTH: 'AUTH',
    STORAGE: 'STORAGE',
    NOT_FOUND: 'NOT_FOUND',
    RATE_LIMIT: 'RATE_LIMIT',
    INTERNAL: 'INTERNAL',
});

export class CategorizedError extends Error {
    constructor(message, {
        errorCategory = ErrorCategory.LLM,
        code = 'UNSPECIFIED_ERROR',
        status = 500,
        details = null,
        cause,
    } = {}) {
        super(message);
        this.name = 'CategorizedError';
        this.errorCategory = errorCategory;
        this.code = code;
        this.status = status;
        this.details = details;
        if (cause) this.cause = cause;
    }
}

function textFromError(err) {
    if (!err) return '';
    const raw = [
        err.message,
        err.code,
        err.type,
        err.error?.message,
        err.error?.code,
    ]
        .filter(Boolean)
        .join(' ');
    return raw.toLowerCase();
}

function isSafetySignal(err) {
    const text = textFromError(err);
    return (
        err?.code === 'content_filter' ||
        err?.error?.code === 'content_filter' ||
        err?.type === 'content_filter' ||
        text.includes('content_filter') ||
        text.includes('content filter') ||
        text.includes('safety') ||
        text.includes('policy violation') ||
        text.includes('blocked by our safety system')
    );
}

function isParsingSignal(err) {
    const text = textFromError(err);
    return (
        text.includes('parse') ||
        text.includes('parser') ||
        text.includes('pdf') ||
        text.includes('pptx') ||
        text.includes('docx') ||
        text.includes('tipo de archivo no soportado')
    );
}

function isRetrievalSignal(err) {
    const text = textFromError(err);
    return (
        text.includes('vector') ||
        text.includes('search') ||
        text.includes('retrieval') ||
        text.includes('pinecone') ||
        text.includes('index') ||
        text.includes('querysimilar') ||
        text.includes('base vectorial')
    );
}

function isAiInfraSignal(err) {
    const text = textFromError(err);
    return (
        text.includes('subscription key') ||
        text.includes('invalid subscription') ||
        text.includes('wrong api endpoint') ||
        text.includes('access denied due to invalid subscription') ||
        (text.includes('openai') && (text.includes('401') || text.includes('403') || text.includes('invalid') || text.includes('api key'))) ||
        (text.includes('embedding') && text.includes('401'))
    );
}

function isValidationSignal(err) {
    const text = textFromError(err);
    // AI infra "invalid subscription key" must NOT be treated as client VALIDATION — it's a server config error (LLM).
    if (isAiInfraSignal(err)) return false;
    return (
        text.includes('validation') ||
        text.includes('invalid') ||
        text.includes('required') ||
        text.includes('missing') ||
        text.includes('bad request')
    );
}

function isAuthSignal(err) {
    const text = textFromError(err);
    // AI infra 401s (Azure OpenAI / OpenAI) are NOT user auth — keep them as LLM/INTERNAL.
    // Exclude infra key/endpoint signals so they fall through to fallbackCategory (LLM) or VALIDATION/INTERNAL as appropriate.
    const isAiInfraAuth = text.includes('subscription key') ||
        text.includes('invalid subscription') ||
        text.includes('wrong api endpoint') ||
        text.includes('access denied due to invalid subscription') ||
        text.includes('api key') ||
        text.includes('openai') ||
        text.includes('embedding');
    if (isAiInfraAuth) return false;
    return (
        err?.status === 401 ||
        err?.status === 403 ||
        text.includes('forbidden') ||
        text.includes('unauthorized') ||
        text.includes('auth') ||
        text.includes('permiso') ||
        text.includes('acceso')
    );
}

function isStorageSignal(err) {
    const text = textFromError(err);
    return (
        text.includes('storage') ||
        text.includes('blob') ||
        text.includes('table') ||
        text.includes('upload') ||
        text.includes('ETIMEDOUT') ||
        text.includes('ECONNREFUSED')
    );
}

export function normalizeCategorizedError(err, fallbackCategory = ErrorCategory.LLM) {
    if (err instanceof CategorizedError) return err;

    let inferred = fallbackCategory;
    if (isSafetySignal(err)) inferred = ErrorCategory.SAFETY;
    else if (isParsingSignal(err)) inferred = ErrorCategory.PARSING;
    else if (isRetrievalSignal(err)) inferred = ErrorCategory.RETRIEVAL_FAILURE;
    else if (isAuthSignal(err)) inferred = ErrorCategory.AUTH;
    else if (isValidationSignal(err)) inferred = ErrorCategory.VALIDATION;
    else if (isStorageSignal(err)) inferred = ErrorCategory.STORAGE;

    return new CategorizedError(err?.message || 'Unexpected error', {
        errorCategory: inferred,
        code: err?.code || 'UNKNOWN_ERROR',
        status: Number.isInteger(err?.status) ? err.status : 500,
        details: err?.details || err?.error || null,
        cause: err,
    });
}

export function buildStructuredErrorBody(message, errorCategory = ErrorCategory.INTERNAL, code = 'UNSPECIFIED_ERROR') {
    const body = { error: message, errorCategory };
    if (code) body.code = code;
    return body;
}

/**
 * Resuelve el estado de la Tasa Fallo Seguro según el porcentaje de
 * completado seguro. Umbrales definidos en la user story #212.
 * @param {number} percent - safetyRatePercent (0-100)
 * @returns {'green'|'yellow'|'red'}
 */
export function resolveSafetyStatus(percent) {
    const value = Number(percent);
    if (!Number.isFinite(value)) return 'green';
    if (value >= 99) return 'green';
    if (value >= 95) return 'yellow';
    return 'red';
}

export const SAFETY_RATE_THRESHOLDS = Object.freeze({
    GREEN_PERCENT: 99,
    YELLOW_PERCENT: 95,
});

export function structuredErrorResponse(status, message, errorCategory = ErrorCategory.INTERNAL, code = 'UNSPECIFIED_ERROR') {
    return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildStructuredErrorBody(message, errorCategory, code)),
    };
}
