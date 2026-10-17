import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { validateFrontDoorId, getAuthenticatedUser } from '../services/auth-utils.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { resolveRagPrompt } from '../services/prompts.js';
import { resolveModelForTask, getModelDisplayName } from '../services/ai.js';
import { CONFIG } from '../config.js';
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

/**
 * Motor que GOBIERNA las respuestas del asistente en este momento (UJ-55 paso 9:
 * lo registrado tiene que coincidir con lo que efectivamente quedó activo).
 *
 * Se resuelve por el mismo camino que usa el chat RAG (`rag-query.js`), no por
 * el scope `model` de esta pantalla: la selección persistida acá todavía no
 * alimenta al motor, así que la superficie no puede reportarla como si rigiera.
 * Es una lectura: no cambia qué motor responde.
 */
async function resolveEffectiveEngine() {
    const active = await resolveRagPrompt().catch(() => null);
    const deployment = await resolveModelForTask('rag-master').catch(() => null)
        || CONFIG.ai.models?.['rag-master']
        || CONFIG.ai.deepSeekModel
        || null;
    return {
        deployment,
        model: getModelDisplayName(deployment),
        // 'prompt-version' cuando el motor lo fija la versión activa del prompt
        // del asistente; 'default' cuando sale de la configuración del servicio.
        source: active?.model ? 'prompt-version' : 'default',
        promptVersion: active?.id || null,
    };
}

async function toResponse(scope, result) {
    const body = {
        data: result.data,
        defaults: result.defaults,
        updatedAt: result.updatedAt,
        updatedBy: result.updatedBy,
    };
    // El motor vigente sólo se informa en el scope que gobierna las respuestas:
    // quien opera necesita distinguir "lo que guardé" de "lo que responde".
    if (scope === 'model') {
        body.effective = await resolveEffectiveEngine();
    }
    return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
            return toResponse(scope, result);
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
            return toResponse(scope, result);
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
            return toResponse(scope, result);
        } catch (err) {
            if (err instanceof AdminSettingsValidationError) {
                return errorResponse(400, err.message);
            }
            context.error(`[AdminConfig] Error resetting config (scope=${scope}):`, err);
            return errorResponse(500, 'Error al restablecer la configuración.');
        }
    }, { roles: ADMIN_ROLES }))
});
