/**
 * services/error-categories.js — Standardized RAG error taxonomy
 */

export const ErrorCategory = Object.freeze({
    RETRIEVAL_FAILURE: 'RETRIEVAL_FAILURE',
    SAFETY: 'SAFETY',
    PARSING: 'PARSING',
    LLM: 'LLM',
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

export function normalizeCategorizedError(err, fallbackCategory = ErrorCategory.LLM) {
    if (err instanceof CategorizedError) return err;

    let inferred = fallbackCategory;
    if (isSafetySignal(err)) inferred = ErrorCategory.SAFETY;
    else if (isParsingSignal(err)) inferred = ErrorCategory.PARSING;
    else if (isRetrievalSignal(err)) inferred = ErrorCategory.RETRIEVAL_FAILURE;

    return new CategorizedError(err?.message || 'Unexpected error', {
        errorCategory: inferred,
        code: err?.code || 'UNKNOWN_ERROR',
        status: Number.isInteger(err?.status) ? err.status : 500,
        details: err?.details || err?.error || null,
        cause: err,
    });
}
