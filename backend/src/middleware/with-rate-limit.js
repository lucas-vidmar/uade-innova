import { createRateLimiter, createSharedRateLimiter, isSharedRateLimitEnabled } from '../services/rate-limiter.js';
import { getAuthenticatedUser } from '../services/auth-utils.js';
import { structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';
import { CONFIG } from '../services/config.js';
import {
    CAUDAL_CLASS,
    CAUDAL_REASON,
    alertThresholdPct,
    classifyCaudal,
    identityTierOf,
    routeOf,
    serviceCaps,
    serviceTierOf,
} from '../services/caudal-policy.js';
import { buildCaudalEventRow, claimThresholdEvent, recordCaudalEvent } from '../services/caudal-events.js';

const limiter = createRateLimiter();
let sharedLimiter = null;
let lastSharedFallbackWarnAt = 0;

function getSharedLimiter() {
    if (!sharedLimiter) sharedLimiter = createSharedRateLimiter();
    return sharedLimiter;
}

// Contadores del tope de servicio (#458): una entidad por clase, compartida
// entre instancias con el mismo almacén que #455. El techo de cada clase se
// deriva del total y de la reserva, así que los limitadores se cachean por
// firma de esos dos números.
const serviceLimiters = { memory: new Map(), shared: new Map() };

function getServiceLimiter(caps, shared) {
    const signature = `${caps.interactive}:${caps.essential}`;
    const cache = shared ? serviceLimiters.shared : serviceLimiters.memory;
    if (!cache.has(signature)) {
        const tiers = {
            [CAUDAL_CLASS.INTERACTIVE]: caps.interactive,
            [CAUDAL_CLASS.ESSENTIAL]: caps.essential,
        };
        cache.set(signature, shared ? createSharedRateLimiter({ tiers }) : createRateLimiter({ tiers }));
    }
    return cache.get(signature);
}

export function _resetRateLimitForTests() {
    sharedLimiter = null;
    lastSharedFallbackWarnAt = 0;
    serviceLimiters.memory.clear();
    serviceLimiters.shared.clear();
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
 * 'Production') el conteo es service-wide en Table Storage; si el almacén
 * compartido falla, se cae al limitador en memoria de la instancia para no
 * tumbar la API (#455).
 */
export async function resolveRateLimitDecision(request, tier = 'general', options = {}) {
    const key = options.key ?? await resolveRateLimitKey(request);
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

/**
 * Caudal del servicio: cuánto lleva consumido la clase en esta ventana.
 *
 * `service` es una sola clave para todas las identidades juntas, así que el
 * agregado de la víspera se ve en un contador. La clase esencial tiene su
 * propio techo (la reserva) y el interactivo el resto: un pico del asistente no
 * puede comerse la capacidad que deja el material a mano.
 */
async function checkServiceCounter(caudalClass, caps) {
    const tier = serviceTierOf(caudalClass);
    if (isSharedRateLimitEnabled()) {
        try {
            const result = await getServiceLimiter(caps, true).check('service', tier);
            return { ...result, scope: 'shared' };
        } catch (err) {
            const now = Date.now();
            if (now - lastSharedFallbackWarnAt > 30000) {
                lastSharedFallbackWarnAt = now;
                console.warn(`[RateLimit] Shared service counter unavailable, falling back to in-memory: ${err?.message}`);
            }
        }
    }
    const result = getServiceLimiter(caps, false).check('service', tier);
    return { ...result, scope: 'memory' };
}

/**
 * Lectura del caudal de servicio de una clase, sin consumir nada. La usa la
 * superficie de operación para decir qué se degradó sin pedirle a nadie que
 * reproduzca la carga.
 */
export async function readServiceUsage(caudalClass, overrides = {}) {
    const caps = serviceCaps(overrides);
    const tier = serviceTierOf(caudalClass);
    if (isSharedRateLimitEnabled()) {
        try {
            const usage = await getServiceLimiter(caps, true).usage('service', tier);
            return { ...usage, caps, scope: 'shared' };
        } catch {
            // Sin almacén compartido: se informa lo que ve esta instancia.
        }
    }
    const usage = getServiceLimiter(caps, false).usage('service', tier);
    return { ...usage, caps, scope: 'memory' };
}

function buildAnnouncementHeaders(decision) {
    const headers = {
        'X-Caudal-Class': decision.caudalClass,
        'X-Caudal-Service-Used': String(decision.service.used ?? 0),
        'X-Caudal-Service-Limit': String(decision.service.limit ?? 0),
        'X-Caudal-Service-Total': String(decision.caps.total),
        'X-Caudal-Reserve-Limit': String(decision.caps.essential),
        'X-Caudal-Window-Idx': String(decision.windowIdx ?? ''),
    };
    if (decision.threshold.crossed) {
        headers['Warning'] = `299 - "caudal de servicio al ${decision.threshold.pct}% del tope (${decision.caudalClass})"`;
        headers['X-Caudal-Threshold'] = 'umbral';
    } else {
        headers['X-Caudal-Threshold'] = 'ok';
    }
    if (decision.reason) headers['X-Caudal-Reason'] = decision.reason;
    return headers;
}

function withAnnouncement(response, decision) {
    if (!response || typeof response !== 'object') return response;
    response.headers = { ...buildAnnouncementHeaders(decision), ...(response.headers || {}) };
    return response;
}

/**
 * Registro + aviso (#458).
 *
 * Se espera la escritura: la constancia tiene que estar anotada antes de que la
 * respuesta salga, o una invocación que muere justo después deja la noche sin
 * registro. Los errores los traga `caudal-events.js` (la API no se cae por no
 * poder anotar), y el umbral se reclama una sola vez por ventana y clase: al
 * resto de los pedidos de esa ventana les sale gratis (`localClaims`).
 */
async function publishCaudalSignal({ context, decision, kind }) {
    const row = buildCaudalEventRow({
        kind,
        reason: decision.reason || 'THRESHOLD',
        at: decision.at,
        caudalClass: decision.caudalClass,
        tier: decision.tier,
        route: decision.route,
        method: decision.method,
        key: decision.key,
        windowIdx: decision.windowIdx,
        windowMs: decision.windowMs,
        used: decision.service.used,
        limit: decision.service.limit,
        retryAfterSec: decision.retryAfterSec,
        correlationId: context?.correlationId,
        instance: process.env.WEBSITE_INSTANCE_ID || process.env.HOSTNAME || '',
    });

    const claimed = kind === 'threshold' ? await claimThresholdEvent(row) : await recordCaudalEvent(row);
    // El umbral ya se avisó en esta ventana y clase: ni log ni evento repetido.
    if (kind === 'threshold' && !claimed) return;

    const label = kind === 'threshold' ? 'UMBRAL' : 'DENEGADO';
    const line = `[Caudal] ${label} class=${decision.caudalClass} reason=${decision.reason || 'THRESHOLD'} tier=${decision.tier} route=${decision.route} key=${decision.key} used=${decision.service.used}/${decision.service.limit} total=${decision.caps.total} reserve=${decision.caps.essential} window=${decision.windowIdx}`;
    if (typeof context?.warn === 'function') context.warn(line);
    else if (typeof context?.log === 'function') context.log(line);
    else console.warn(line);

    // Import dinámico: `telemetry.js` arrastra el cliente de Table Storage y
    // muchos tests de functions mockean `storage.js` con una superficie
    // parcial. El aviso no puede romper el 429 ni el import de un endpoint.
    try {
        const { trackCaudalEvent } = await import('../services/telemetry.js');
        await trackCaudalEvent({
            kind,
            reason: decision.reason || 'THRESHOLD',
            caudalClass: decision.caudalClass,
            tier: decision.tier,
            route: decision.route,
            key: decision.key,
            used: decision.service.used,
            limit: decision.service.limit,
            retryAfterSec: decision.retryAfterSec,
            windowIdx: decision.windowIdx,
            correlationId: context?.correlationId,
        });
    } catch {
        // Sin App Insights: el log de la invocación y el registro ya quedaron.
    }
}

/**
 * Decide el caudal del pedido con los dos ejes (#458): la identidad primero y
 * el servicio después. La identidad va primero porque una persona que ya se
 * pasó de su tope no debe consumir el caudal compartido del servicio.
 */
export async function resolveCaudalDecision(request, options = {}) {
    const tier = options.tier || 'general';
    const caudalClass = classifyCaudal(request, options);
    const caps = serviceCaps(options.caps);
    const thresholdPct = alertThresholdPct(options);
    const windowMs = Number(CONFIG.rateLimit.windowMs) || 60000;

    const identityKey = await resolveRateLimitKey(request);
    const identityTier = identityTierOf(caudalClass, tier);

    const base = {
        at: new Date().toISOString(),
        key: identityKey,
        caudalClass,
        tier: identityTier,
        route: options.route ?? routeOf(request),
        method: String(request?.method || '').toUpperCase(),
        windowMs,
        caps,
        thresholdPct,
    };

    const identity = await resolveRateLimitDecision(request, identityTier, { key: identityKey });
    if (!identity.allowed) {
        return {
            ...base,
            allowed: false,
            reason: CAUDAL_REASON.IDENTITY_CAP,
            scope: identity.scope,
            retryAfterSec: identity.retryAfterSec,
            windowIdx: Math.floor(Date.now() / windowMs),
            identity,
            service: { used: Number(identity.used) || 0, limit: Number(identity.limit) || 0, remaining: 0, scope: identity.scope },
            threshold: { crossed: false, pct: 0 },
        };
    }

    const service = await checkServiceCounter(caudalClass, caps);
    const windowIdx = service.windowIdx ?? Math.floor(Date.now() / windowMs);
    const limit = Number(service.limit) || caps[serviceTierOf(caudalClass)] || 0;
    const pct = limit > 0 ? Math.min(100, Math.floor((Number(service.used) || 0) * 100 / limit)) : 0;
    const threshold = { crossed: pct >= thresholdPct, pct };

    if (!service.allowed) {
        const reason = caudalClass === CAUDAL_CLASS.ESSENTIAL
            ? CAUDAL_REASON.RESERVE_EXHAUSTED
            : CAUDAL_REASON.SERVICE_CAP;
        return {
            ...base,
            allowed: false,
            reason,
            scope: service.scope,
            retryAfterSec: service.retryAfterSec,
            windowIdx,
            identity,
            service,
            threshold,
        };
    }

    return {
        ...base,
        allowed: true,
        reason: null,
        scope: service.scope,
        retryAfterSec: 0,
        windowIdx,
        identity,
        service,
        threshold,
    };
}

export function withRateLimit(handler, tier = 'general', options = {}) {
    return async (request, context) => {
        if (request?.method === 'OPTIONS') {
            return handler(request, context);
        }

        const decision = await resolveCaudalDecision(request, { ...options, tier });

        if (!decision.allowed) {
            await publishCaudalSignal({ context, decision, kind: 'denial' });
            const response = structuredErrorResponse(
                429,
                'Demasiadas solicitudes. Intentá de nuevo en unos segundos.',
                ErrorCategory.RATE_LIMIT,
                'RATE_LIMIT_EXCEEDED'
            );
            response.headers['Retry-After'] = String(decision.retryAfterSec);
            const payload = JSON.parse(response.body);
            // La denegación dice por qué eje y con qué caudal, para que quien
            // opera no tenga que adivinar cuál de los dos topes cortó.
            payload.caudal = {
                reason: decision.reason,
                class: decision.caudalClass,
                tier: decision.tier,
                used: decision.service.used ?? 0,
                limit: decision.service.limit ?? 0,
                serviceTotal: decision.caps.total,
                reserve: decision.caps.essential,
                retryAfterSec: decision.retryAfterSec,
            };
            response.body = JSON.stringify(payload);
            return withAnnouncement(response, decision);
        }

        if (decision.threshold.crossed) {
            await publishCaudalSignal({ context, decision, kind: 'threshold' });
        }

        const response = await handler(request, context);
        return withAnnouncement(response, decision);
    };
}
