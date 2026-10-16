import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { validateFrontDoorId, resolveIdentityKey, hasResolvedIdentity } from '../services/auth-utils.js';
import { getTableClient } from '../services/storage.js';
import { downloadFile } from '../services/storage.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    handler: withCorrelation(withAuth(async (request, context) => {
        const correlationId = context.correlationId;
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

        // No identity resolved → there is no consent to read and none to record.
        // Serving the shared 'pilot-user' row here returned `accepted:true` to a
        // caller without a session (#434).
        if (!hasResolvedIdentity(context.user)) {
            return jsonResponse(401, {
                success: false,
                error: { code: 'AUTH_REQUIRED', message: 'Se requiere autenticación para acceder al consentimiento.' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            });
        }

        // Single per-user identity (#327): session-token principals have no
        // oid, so key by the resolved session identity — never principal.oid.
        const userId = resolveIdentityKey(request, context);
        context.log(`[Consent] GET consent for userId=${userId}`);

        try {
            const record = await getConsentRecord(userId);
            if (record) {
                return jsonResponse(200, {
                    success: true,
                    data: {
                        accepted: record.accepted === 'true',
                        acceptedAt: record.accepted === 'true' ? record.acceptedAt : null,
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
    })),
});

app.http('consent-post', {
    methods: ['POST'],
    route: 'consent',
    authLevel: 'anonymous',
    handler: withCorrelation(withAuth(async (request, context) => {
        const correlationId = context.correlationId;
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

        // Same guard as the GET (#434): an anonymous caller must not write a
        // consent decision onto the shared 'pilot-user' row.
        if (!hasResolvedIdentity(context.user)) {
            return jsonResponse(401, {
                success: false,
                error: { code: 'AUTH_REQUIRED', message: 'Se requiere autenticación para registrar el consentimiento.' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            });
        }

        // Single per-user identity (#327): see GET handler above.
        const userId = resolveIdentityKey(request, context);
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
        if (typeof body?.accepted !== 'boolean') {
            return jsonResponse(400, {
                success: false,
                error: { code: 'INVALID_CONSENT', message: 'El campo accepted debe ser un booleano.' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            });
        }

        try {
            await ensureConsentTable();
            const client = getTableClient(CONSENT_TABLE);
            const entity = {
                partitionKey: userId,
                rowKey: 'consent',
                accepted: body.accepted ? 'true' : 'false',
                acceptedAt: body.accepted ? new Date().toISOString() : null,
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
    })),
});

function loadTermsFromDisk() {
    const localPaths = [
        resolve(__dirname, '../../../legal/terms-v1.md'),
        resolve(process.cwd(), 'legal/terms-v1.md'),
    ];
    for (const p of localPaths) {
        if (existsSync(p)) {
            return readFileSync(p, 'utf-8');
        }
    }
    return null;
}

app.http('terms-get', {
    methods: ['GET'],
    route: 'terms',
    authLevel: 'anonymous',
    handler: withCorrelation(withAuth(async (request, context) => {
        const correlationId = context.correlationId;
        if (!validateFrontDoorId(request)) return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });

        context.log(`[Consent] GET terms`);

        // 1. Try Blob Storage first
        try {
            const content = await downloadFile(LEGAL_CONTAINER, 'terms-v1.md');
            if (content) {
                const text = content.toString('utf-8');
                return jsonResponse(200, {
                    success: true,
                    data: { content: text, version: 'v1' },
                    meta: { timestamp: new Date().toISOString(), requestId: correlationId },
                });
            }
        } catch (error) {
            context.warn('[Consent] Blob download failed, trying local fallback:', error.message);
        }

        // 2. Fallback: read from local disk (development)
        const localContent = loadTermsFromDisk();
        if (localContent) {
            context.log('[Consent] Served terms from local filesystem');
            return jsonResponse(200, {
                success: true,
                data: { content: localContent, version: 'v1' },
                meta: { timestamp: new Date().toISOString(), requestId: correlationId },
            });
        }

        // 3. Not found anywhere
        return jsonResponse(404, {
            success: false,
            error: { code: 'TERMS_NOT_FOUND', message: 'No se encontraron los términos de uso.' },
            meta: { timestamp: new Date().toISOString(), requestId: correlationId },
        });
    })),
});
