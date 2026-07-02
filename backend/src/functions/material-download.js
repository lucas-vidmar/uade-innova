import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';
import { getMaterialState } from '../services/state-store.js';
import { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential, SASProtocol } from '@azure/storage-blob';
import { validateFrontDoorId } from '../services/auth-utils.js';
import { CONFIG } from '../services/config.js';

const CONTAINER_MATERIALS = CONFIG.containers.materials;

app.http('material-download', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'material-download',
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) {
            return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        }

        const url = new URL(request.url);
        const subjectId = url.searchParams.get('subjectId');
        const materialId = url.searchParams.get('materialId');

        if (!subjectId || !materialId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Faltan parametros: subjectId, materialId' }) };
        }

        try {
            const material = await getMaterialState(subjectId, materialId);
            if (!material) {
                return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Material no encontrado' }) };
            }

            if (material.status !== 'ready') {
                return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Material aun no disponible', status: material.status }) };
            }

            const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
            const accountKey = process.env.AZURE_STORAGE_ACCESS_KEY;
            if (!accountName || !accountKey) {
                return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Storage no configurado' }) };
            }

            const credential = new StorageSharedKeyCredential(accountName, accountKey);
            const blobUrl = new URL(material.blobUrl);
            const blobName = blobUrl.pathname.replace(`/${CONTAINER_MATERIALS}/`, '');

            const sasParams = generateBlobSASQueryParameters({
                containerName: CONTAINER_MATERIALS,
                blobName,
                startsOn: new Date(),
                expiresOn: new Date(Date.now() + 3600 * 1000),
                permissions: BlobSASPermissions.parse('r'),
                protocol: SASProtocol.Https,
            }, credential);

            const sasUrl = `${material.blobUrl}?${sasParams}`;

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    downloadUrl: sasUrl,
                    filename: material.filename || 'material',
                    status: material.status,
                }),
            };
        } catch (err) {
            context.error('[Material Download] Error:', err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al generar descarga' }) };
        }
    }),
});
