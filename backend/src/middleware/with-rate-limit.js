import { createRateLimiter, createSharedRateLimiter, isSharedRateLimitEnabled } from '../services/rate-limiter.js';
import { getAuthenticatedUser } from '../services/auth-utils.js';
import { structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';

const limiter = createRateLimiter();
let sharedLimiter = null;
let lastSharedFallbackWarnAt = 0;

function getSharedLimiter() {
    if (!sharedLimiter) sharedLimiter = createSharedRateLimiter();
    return sharedLimiter;
}

export function resolveClientIp(request) {
    const clientIp = request?.headers?.get?.('x-azure-clientip');
    if (clientIp) return String(clientIp).trim();
    const forwarded = request?.headers?.get?.('x-forwarded-for');
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return 'unknown';
}

function extractBearerToken(request) {
    const authHeader = request?.headers?.get?.('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    return match ? match[1].trim() : null;
}

/**
 * Clave del cubo de caudal, por persona cuando la identidad es resoluble (#455).
 *
 * Orden: identidad ya resuelta por withAuth (auth corrió antes en quiz-api) →
 * principal/headers de desarrollo (getAuthenticatedUser) → sesión opaca del
 * Bearer (lookup en Sessions: con la identidad real aunque el limiter corre
 * ANTES de withAuth) → IP del cliente como último recurso.
 *
 * Async porque el lookup de sesión va a storage; si storage no responde,
 * getSession devuelve null y la clave cae a la IP (fail-open de identidad, no
 * de autorización: withAuth sigue haciendo su validación después).
 */
export async function resolveRateLimitKey(request) {
    const user = getAuthenticatedUser(request);
    const sanitizedId = user?.sanitizedId;
    if (sanitizedId && sanitizedId !== 'anonymous') {
        return `uid:${sanitizedId}`;
    }

    const token = extractBearerToken(request);
    if (token) {
        try {
            const { getSession } = await import('../services/sessions-store.js');
            const session = await getSession(token);
            const userId = session?.userId;
            if (userId) {
                return `uid:${String(userId).replace(/[^a-zA-Z0-9]/g, '_')}`;
            }
        } catch {
            // Sin storage: clave por IP.
        }
    }

    return `ip:${resolveClientIp(request)}`;
}

/**
 * Decide si el pedido entra. En prod (RATE_LIMIT_SHARED / Functions en
 * 'Production') el conteo es service-wide en Table Storage; si el almacen
 * compartido falla, se cae al limitador en memoria de la instancia para no
 * tumbar la API (#455).
 */
export async function resolveRateLimitDecision(request, tier = 'general') {
    const key = await resolveRateLimitKey(request);
    if (isSharedRateLimitEnabled()) {
        try {
            const result = await getSharedLimiter().check(key, tier);
            return { ...result, key, scope: 'shared' };
        } catch (err) {
            const now = Date.now();
            if (now - lastSharedFallbackWarnAt > 30000) {
                lastSharedFallbackWarnAt = now;
                console.warn(`[RateLimit] Shared store unavailable, falling back to in-memory: ${err?.message}`);
            }
        }
    }
    const result = limiter.check(key, tier);
    return { ...result, key, scope: 'memory' };
}

export function withRateLimit(handler, tier = 'general') {
    return async (request, context) => {
        if (request?.method === 'OPTIONS') {
            return handler(request, context);
        }

        const result = await resolveRateLimitDecision(request, tier);

        if (!result.allowed) {
            context?.log?.(`[RateLimit] Exceeded scope=${result.scope} tier=${tier} key=${result.key} retryAfterSec=${result.retryAfterSec}`);
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
