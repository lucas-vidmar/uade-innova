import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { validateFrontDoorId, getAuthenticatedUser } from '../services/auth-utils.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import {
    getAdminSettings,
    upsertAdminSettings,
    resetAdminSettings,
    AdminSettingsValidationError,
    VALID_SCOPES,
} from '../services/admin-settings.js';

const ADMIN_ROLES = ['Director', 'Admin'];

function isInvalidScope(scope) {
    return !scope || !VALID_SCOPES.includes(scope);
}

function scopeError(scope) {
    return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Scope inválido: "${scope}". Válidos: ${VALID_SCOPES.join(', ')}.` }) };
}

function errorResponse(status, message) {
    return { status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: message }) };
}

function toResponse(result) {
    return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            data: result.data,
            defaults: result.defaults,
            updatedAt: result.updatedAt,
            updatedBy: result.updatedBy,
        }),
    };
}

app.http('admin-config-get', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'dashboard-admin/config/{scope}',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const scope = request.params.scope;
        if (isInvalidScope(scope)) return scopeError(scope);
        try {
            const result = await getAdminSettings(scope);
            return toResponse(result);
        } catch (err) {
            context.error(`[AdminConfig] Error getting config (scope=${scope}):`, err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al obtener la configuración.' }) };
        }
    }, { roles: ADMIN_ROLES }))
});

app.http('admin-config-put', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'dashboard-admin/config/{scope}',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const scope = request.params.scope;
        if (isInvalidScope(scope)) return scopeError(scope);
        let body;
        try {
            body = await request.json();
        } catch {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Body JSON inválido.' }) };
        }
        const values = body?.values || body;
        const { userId } = getAuthenticatedUser(request);
        try {
            const result = await upsertAdminSettings(scope, values, userId);
            return toResponse(result);
        } catch (err) {
            if (err instanceof AdminSettingsValidationError) {
                return errorResponse(400, err.message);
            }
            context.error(`[AdminConfig] Error persisting config (scope=${scope}):`, err);
            return errorResponse(500, 'Error al guardar la configuración.');
        }
    }, { roles: ADMIN_ROLES }))
});

app.http('admin-config-delete', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'dashboard-admin/config/{scope}',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        const scope = request.params.scope;
        if (isInvalidScope(scope)) return scopeError(scope);
        try {
            const result = await resetAdminSettings(scope);
            return toResponse(result);
        } catch (err) {
            if (err instanceof AdminSettingsValidationError) {
                return errorResponse(400, err.message);
            }
            context.error(`[AdminConfig] Error resetting config (scope=${scope}):`, err);
            return errorResponse(500, 'Error al restablecer la configuración.');
        }
    }, { roles: ADMIN_ROLES }))
});
