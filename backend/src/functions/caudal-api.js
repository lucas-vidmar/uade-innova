/**
 * functions/caudal-api.js — superficie de operación del caudal (#458)
 *
 * Quien opera necesita, sin reproducir la carga y sin ser quien la sufrió,
 * poder responder: ¿el servicio está en su tope?, ¿se cruzó el umbral?, ¿la
 * reserva de lo esencial sigue entera?, ¿a quién se le negó y por qué eje?
 *
 *   GET /api/dashboard-admin/caudal?date=YYYY-MM-DD&limit=100
 *
 * Lee los contadores de servicio del almacén compartido (no consume caudal) y
 * el registro de la noche (`RateLimitEvents`). Es de sólo lectura.
 */
import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { validateFrontDoorId } from '../services/auth-utils.js';
import { CONFIG } from '../services/config.js';
import { CAUDAL_CLASS, alertThresholdPct, essentialRoutes, serviceCaps } from '../services/caudal-policy.js';
import { readServiceUsage } from '../middleware/with-rate-limit.js';
import { listCaudalEvents } from '../services/caudal-events.js';

const OPERATOR_ROLES = ['Admin', 'Director', 'Security'];

function jsonResponse(status, payload) {
    return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    };
}

function stateOf({ used, limit }, thresholdPct, caudalClass) {
    if (limit <= 0) return 'ok';
    if (used >= limit) return caudalClass === CAUDAL_CLASS.ESSENTIAL ? 'reserva-agotada' : 'tope';
    const pct = Math.floor((used * 100) / limit);
    return pct >= thresholdPct ? 'umbral' : 'ok';
}

function viewOf(usage, thresholdPct, caudalClass) {
    const used = Number(usage?.used) || 0;
    const limit = Number(usage?.limit) || 0;
    const pct = limit > 0 ? Math.min(100, Math.floor((used * 100) / limit)) : 0;
    return {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        pct,
        state: stateOf({ used, limit }, thresholdPct, caudalClass),
        scope: usage?.scope || 'unknown',
    };
}

function summarizeEvents(rows) {
    const byReason = {};
    let denials = 0;
    let thresholds = 0;
    for (const row of rows) {
        if (row.kind === 'threshold') {
            thresholds += 1;
            continue;
        }
        denials += 1;
        const reason = row.reason || 'unknown';
        byReason[reason] = (byReason[reason] || 0) + 1;
    }
    return { total: rows.length, denials, thresholds, byReason };
}

app.http('caudal-operations', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'dashboard-admin/caudal',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return jsonResponse(403, { success: false, error: { code: 'FRONTDOOR_INVALID', message: 'Forbidden - Invalid Front Door ID' } });
        }

        const caps = serviceCaps();
        const thresholdPct = alertThresholdPct();
        const windowMs = Number(CONFIG.rateLimit.windowMs) || 60000;
        const now = Date.now();
        const windowIdx = Math.floor(now / windowMs);
        const date = request.query?.get?.('date') || new Date(now).toISOString().slice(0, 10);
        const limit = request.query?.get?.('limit') || '100';

        let service = {};
        try {
            const [interactive, essential] = await Promise.all([
                readServiceUsage(CAUDAL_CLASS.INTERACTIVE),
                readServiceUsage(CAUDAL_CLASS.ESSENTIAL),
            ]);
            service = {
                interactive: viewOf(interactive, thresholdPct, CAUDAL_CLASS.INTERACTIVE),
                essential: viewOf(essential, thresholdPct, CAUDAL_CLASS.ESSENTIAL),
            };
        } catch (err) {
            context?.error?.(`[CaudalAPI] No se pudo leer el caudal del servicio: ${err?.message}`);
            service = {
                interactive: { used: 0, limit: caps.interactive, remaining: caps.interactive, pct: 0, state: 'desconocido', scope: 'unavailable' },
                essential: { used: 0, limit: caps.essential, remaining: caps.essential, pct: 0, state: 'desconocido', scope: 'unavailable' },
            };
        }

        let events = { date, rows: [], total: 0, denials: 0, thresholds: 0, byReason: {} };
        let eventsError = null;
        try {
            const rows = await listCaudalEvents({ date, limit: Number(limit) || 100 });
            events = { date, rows, ...summarizeEvents(rows) };
        } catch (err) {
            eventsError = err?.message || 'No se pudo leer el registro';
        }

        const degraded = service.interactive?.state !== 'ok' || service.essential?.state !== 'ok';
        const overallState = service.interactive?.state === 'tope' || service.essential?.state === 'reserva-agotada'
            ? 'tope'
            : (degraded ? 'umbral' : 'ok');

        return jsonResponse(200, {
            success: true,
            data: {
                generatedAt: new Date(now).toISOString(),
                instance: process.env.WEBSITE_INSTANCE_ID || process.env.HOSTNAME || 'unknown',
                state: overallState,
                window: {
                    windowMs,
                    windowIdx,
                    startsAt: new Date(windowIdx * windowMs).toISOString(),
                    endsAt: new Date((windowIdx + 1) * windowMs).toISOString(),
                },
                limits: {
                    identityTiers: CONFIG.rateLimit.tiers,
                    service: {
                        totalPerWindow: caps.total,
                        reservePct: caps.reservePct,
                        essential: caps.essential,
                        interactive: caps.interactive,
                        alertThresholdPct: thresholdPct,
                    },
                    essentialRoutes: essentialRoutes(),
                },
                service,
                events,
                ...(eventsError ? { eventsError } : {}),
            },
        });
    }, { roles: OPERATOR_ROLES })),
});
