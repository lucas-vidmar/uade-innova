import { createRateLimiter } from '../services/rate-limiter.js';
import { getAuthenticatedUser } from '../services/auth-utils.js';
import { structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';

const limiter = createRateLimiter();

export function resolveClientIp(request) {
    const clientIp = request?.headers?.get?.('x-azure-clientip');
    if (clientIp) return String(clientIp).trim();
    const forwarded = request?.headers?.get?.('x-forwarded-for');
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return 'unknown';
}

export function resolveRateLimitKey(request) {
    const user = getAuthenticatedUser(request);
    const sanitizedId = user?.sanitizedId;
    if (sanitizedId && sanitizedId !== 'anonymous') {
        return `uid:${sanitizedId}`;
    }
    return `ip:${resolveClientIp(request)}`;
}

export function withRateLimit(handler, tier = 'general') {
    return async (request, context) => {
        if (request?.method === 'OPTIONS') {
            return handler(request, context);
        }

        const key = resolveRateLimitKey(request);
        const result = limiter.check(key, tier);

        if (!result.allowed) {
            context?.log?.(`[RateLimit] Exceeded tier=${tier} key=${key} retryAfterSec=${result.retryAfterSec}`);
            const response = structuredErrorResponse(
                429,
                'Demasiadas solicitudes. Intentá de nuevo en unos segundos.',
                ErrorCategory.RATE_LIMIT,
                'RATE_LIMIT_EXCEEDED'
            );
            response.headers['Retry-After'] = String(result.retryAfterSec);
            return response;
        }

        return handler(request, context);
    };
}
