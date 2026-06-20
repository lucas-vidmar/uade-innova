import { app } from '@azure/functions';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getTableClient } from '../services/storage.js';
import { downloadFile } from '../services/storage.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { v4 as uuidv4 } from 'uuid';

const CONSENT_TABLE = 'UserConsent';
const LEGAL_CONTAINER = 'legal';

function jsonResponse(status, payload) {
    return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    };
}

let consentTableEnsured = false;
async function ensureConsentTable() {
    if (consentTableEnsured) return;
    const client = getTableClient(CONSENT_TABLE);
    try {
        await client.createTable();
        consentTableEnsured = true;
    } catch (err) {
        if (err.statusCode !== 409) throw err;
        consentTableEnsured = true;
    }
}

async function getConsentRecord(userId) {
    const client = getTableClient(CONSENT_TABLE);
    try {
        return await client.getEntity(userId, 'consent');
    } catch {
        return null;
    }
}

app.http('consent-get', {
    methods: ['GET'],
    route: 'consent',
    authLevel: 'anonymous',
    handler: withCorrelation(async (request, context) => {
        const correlationId = context.correlationId;
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

        const principal = parseClientPrincipal(request);
        const userId = principal?.oid || request.headers.get('x-edu-uid') || 'pilot-user';
        context.log(`[Consent] GET consent for userId=${userId}`);

        try {
            const record = await getConsentRecord(userId);
            if (record) {
                return jsonResponse(200, {
                    success: true,
                    data: {
                        accepted: true,
                        acceptedAt: record.acceptedAt,
                        version: record.version,
                    },
                    meta: { timestamp: new Date().toISOString(), requestId: correlationId },
                });
            }
            return jsonResponse(200, {
                success: true,
                data: {
                    accepted: false,
                    acceptedAt: null,
                    version: null,
                },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            });
        } catch (error) {
            context.error(`[Consent] Error reading consent for userId=${userId}:`, error);
            return jsonResponse(500, {
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Error al leer el consentimiento.' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            });
        }
    }),
});

app.http('consent-post', {
    methods: ['POST'],
    route: 'consent',
    authLevel: 'anonymous',
    handler: withCorrelation(async (request, context) => {
        const correlationId = context.correlationId;
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

        const principal = parseClientPrincipal(request);
        const userId = principal?.oid || request.headers.get('x-edu-uid') || 'pilot-user';
        const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-azure-client-ip') || '';

        context.log(`[Consent] POST consent for userId=${userId}`);

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse(400, {
                success: false,
                error: { code: 'INVALID_BODY', message: 'Cuerpo de solicitud inválido.' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            });
        }
        if (body?.accepted !== true) {
            return jsonResponse(400, {
                success: false,
                error: { code: 'CONSENT_NOT_ACCEPTED', message: 'Debés aceptar los términos para continuar.' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            });
        }

        try {
            await ensureConsentTable();
            const client = getTableClient(CONSENT_TABLE);
            const entity = {
                partitionKey: userId,
                rowKey: 'consent',
                acceptedAt: new Date().toISOString(),
                version: 'v1',
                ipAddress,
            };
            await client.upsertEntity(entity, 'Replace');

            return jsonResponse(200, {
                success: true,
                data: { saved: true },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            });
        } catch (error) {
            context.error(`[Consent] Error saving consent for userId=${userId}:`, error);
            return jsonResponse(500, {
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Error al guardar el consentimiento.' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            });
        }
    }),
});

app.http('terms-get', {
    methods: ['GET'],
    route: 'terms',
    authLevel: 'anonymous',
    handler: withCorrelation(async (request, context) => {
        const correlationId = context.correlationId;
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

        context.log(`[Consent] GET terms`);

        try {
            const content = await downloadFile(LEGAL_CONTAINER, 'terms-v1.md');
            if (!content) {
                return jsonResponse(404, {
                    success: false,
                    error: { code: 'TERMS_NOT_FOUND', message: 'No se encontraron los términos de uso.' },
                    meta: { timestamp: new Date().toISOString(), requestId: correlationId },
                });
            }
            const text = content.toString('utf-8');
            return jsonResponse(200, {
                success: true,
                data: { content: text, version: 'v1' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            });
        } catch (error) {
            context.error('[Consent] Error fetching terms:', error);
            return jsonResponse(500, {
                success: false,
                error: { code: 'TERMS_NOT_FOUND', message: 'No se encontraron los términos de uso.' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            });
        }
    }),
});
