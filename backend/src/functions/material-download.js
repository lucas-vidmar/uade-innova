import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { withRateLimit } from '../middleware/with-rate-limit.js';
import { getMaterialState, getEnrollment } from '../services/state-store.js';
import { saveJson } from '../services/storage.js';
import { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential, SASProtocol } from '@azure/storage-blob';
import { validateFrontDoorId, getAuthenticatedUser, parseClientPrincipal } from '../services/auth-utils.js';
import { createStructuredLogger } from '../services/structured-logger.js';
import { CONFIG } from '../services/config.js';

const CONTAINER_MATERIALS = CONFIG.containers.materials;
const CONTAINER_COMPLIANCE = CONFIG.containers.compliance;

// UJ-12 paso 3: la persona tiene que poder comprobar el alcance del acceso antes
// de usarlo. La ventana es corta, se declara en la respuesta y se registra.
const DEFAULT_WINDOW_MINUTES = 15;
const MAX_WINDOW_MINUTES = 60;
const WINDOW_MINUTES = (() => {
    const configured = Number(process.env.MATERIAL_DOWNLOAD_WINDOW_MINUTES);
    if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_WINDOW_MINUTES;
    return Math.min(configured, MAX_WINDOW_MINUTES);
})();

function jsonResponse(status, payload) {
    return { status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

app.http('material-download', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'material-download',
    handler: withCorrelation(withRateLimit(withAuth(async (request, context) => {
        const log = createStructuredLogger('material-download', context);

        if (!validateFrontDoorId(request)) {
            return jsonResponse(403, { error: 'Forbidden - Invalid Front Door ID' });
        }

        const url = new URL(request.url);
        const subjectId = url.searchParams.get('subjectId');
        const materialId = url.searchParams.get('materialId');

        if (!subjectId || !materialId) {
            return jsonResponse(400, { error: 'Faltan parametros: subjectId, materialId' });
        }

        // UJ-12 pasos 2, 3 y 7: el acceso es para una persona con derecho sobre el
        // material. Igual que el resto de los endpoints de material (material-status,
        // classes), se resuelve la identidad y se verifica la matrícula antes de
        // entregar nada.
        const { userId } = getAuthenticatedUser(request);
        if (!userId || userId === 'anonymous') {
            return jsonResponse(401, { error: 'Se requiere autenticación para llevarse un material.' });
        }

        const principal = parseClientPrincipal(request);
        const roles = principal?.userRoles || [];
        const isDirector = roles.includes('Director');

        if (!isDirector) {
            try {
                const enrollment = await getEnrollment(subjectId, userId);
                if (!enrollment || enrollment.status !== 'active') {
                    log.warn('Intento de extracción sin matrícula activa', { userId, subjectId, materialId });
                    return jsonResponse(403, { error: 'No tenés acceso a los materiales de esta materia.' });
                }
            } catch (enrollmentErr) {
                log.error('Error al verificar la matrícula', { userId, subjectId, error: enrollmentErr.message });
                return jsonResponse(500, { error: 'Error al verificar permisos de acceso.' });
            }
        }

        try {
            const material = await getMaterialState(subjectId, materialId);
            if (!material) {
                return jsonResponse(404, { error: 'Material no encontrado' });
            }

            if (material.status !== 'ready') {
                return jsonResponse(400, { error: 'Material aun no disponible', status: material.status });
            }

            // Un material `ready` sin archivo asociado no se puede entregar: se dice
            // qué pasa en vez de devolver un 500 genérico sin mensaje ni correlación.
            let blobUrl = null;
            try {
                blobUrl = material.blobUrl ? new URL(material.blobUrl) : null;
            } catch {
                blobUrl = null;
            }
            if (!blobUrl || !blobUrl.pathname.includes(`/${CONTAINER_MATERIALS}/`)) {
                log.error('Material sin archivo descargable', { userId, subjectId, materialId, status: material.status });
                return jsonResponse(409, {
                    error: 'El material figura como listo pero no tiene archivo asociado, así que no se puede llevar. Volvé a cargarlo o pedile a soporte que revise su estado.',
                    code: 'MATERIAL_BLOB_MISSING',
                });
            }

            const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
            const accountKey = process.env.AZURE_STORAGE_ACCESS_KEY;
            if (!accountName || !accountKey) {
                log.error('Storage no configurado', { subjectId });
                return jsonResponse(500, { error: 'Storage no configurado' });
            }

            const credential = new StorageSharedKeyCredential(accountName, accountKey);
            const blobName = blobUrl.pathname.replace(`/${CONTAINER_MATERIALS}/`, '');
            const startsOn = new Date();
            const expiresOn = new Date(startsOn.getTime() + WINDOW_MINUTES * 60 * 1000);

            const sasParams = generateBlobSASQueryParameters({
                containerName: CONTAINER_MATERIALS,
                blobName,
                startsOn,
                expiresOn,
                permissions: BlobSASPermissions.parse('r'),
                protocol: SASProtocol.Https,
            }, credential);

            const sasUrl = `${material.blobUrl}?${sasParams}`;

            // UJ-12 paso 8: constancia de quién se llevó qué material, cuándo y por
            // cuánto valía el acceso. Se registra además en el contenedor de
            // cumplimiento para que no dependa de los logs del servicio.
            const record = {
                subjectId,
                materialId,
                filename: material.filename || null,
                requestedBy: userId,
                requestedAt: startsOn.toISOString(),
                expiresAt: expiresOn.toISOString(),
                windowMinutes: WINDOW_MINUTES,
                correlationId: context.correlationId || null,
            };
            log.info('Extracción de material concedida', record);
            try {
                await saveJson(
                    CONTAINER_COMPLIANCE,
                    `material-extractions/${subjectId}/${startsOn.toISOString()}__${materialId}.json`,
                    record,
                );
            } catch (auditErr) {
                // La constancia no puede impedir la entrega, pero tiene que quedar rastro.
                log.error('No se pudo registrar la extracción', { subjectId, materialId, error: auditErr?.message });
            }

            return jsonResponse(200, {
                downloadUrl: sasUrl,
                filename: material.filename || 'material',
                status: material.status,
                // Alcance declarado: un solo material, por esta ventana, pedido por
                // esta persona. El enlace no es transferible a otro material ni
                // sobrevive al plazo.
                expiresAt: expiresOn.toISOString(),
                expiresInSeconds: WINDOW_MINUTES * 60,
                scope: { subjectId, materialId, requestedBy: userId },
            });
        } catch (err) {
            log.error('Error al generar la descarga', { subjectId, materialId, error: err?.message });
            return jsonResponse(500, { error: 'Error al generar descarga', code: 'DOWNLOAD_FAILED' });
        }
    }))),
});
