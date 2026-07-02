# Blind Hunter Review — Story 3.5 Source Transparency

Review the following diff changes with no additional context. Report every bug, security concern,
logic error, or suspicious pattern you find.

## Diff — 6 files changed (+148/-6)

- `backend/src/prompts/v1-baseline.md` — Line 17: "No cites fuentes" → "Cita las fuentes usando [N]"
- `backend/src/prompts/v2-empathetic.md` — Same change
- `backend/src/functions/rag-query.js` — Context builder now enumerates chunks with `[N]` prefix; sources include `text` and `materialId` fields
- `backend/src/functions/material-download.js` — New function: GET /api/material-download with SAS URL generation
- `frontend/src/services/api.js` — New `getMaterialDownloadUrl()` method
- `frontend/src/components/ChatWidget.js` — renderMarkdown parses `[N]` → superscript links; renderMessage adds "Fuentes" section; showCitationModal added; stream handler adds Fuentes on done event; citation click delegation

**Backend diff:**
```diff
--- a/backend/src/prompts/v1-baseline.md
+++ b/backend/src/prompts/v1-baseline.md
@@ -14,5 +14,5 @@
 - Respuestas explicativas y claras, sin ser excesivamente breves.
 - Usa titulos cuando ayuden a organizar la idea.
 - Usa listas, pasos o formulas solo si aportan claridad.
-- No cites fuentes en el texto de la respuesta.
+- Cita las fuentes usando [N] donde N es el numero del chunk listado en <contexto_rag>, al final del texto.
 </formato>
```

```diff
--- a/backend/src/functions/rag-query.js
+++ b/backend/src/functions/rag-query.js
@@ -453,13 +453,14 @@ app.http('rag-query', {
         const contextText = matches
-            .map((m) => {
+            .map((m, i) => {
+                const n = i + 1;
                 const filename = m.metadata?.sourceFilename || 'desconocido';
                 const materialType = m.metadata?.materialType || 'material';
                 const chunkIndex = Number.isInteger(m.metadata?.chunkIndex) ? m.metadata.chunkIndex : '';
-                const header = `<chunk archivo="${filename}" tipo="${materialType}" indice="${chunkIndex}">`;
+                const header = `<chunk indice="${n}" archivo="${filename}" tipo="${materialType}" chunkIndex="${chunkIndex}">`;
                 const body = `${m.metadata?.text || ''}`;
-                return `${header}\n${body}\n</chunk>`;
+                return `[${n}] ${header}\n${body}\n</chunk>`;
             })
             .join('\n\n');
 
@@ -499,6 +500,8 @@ ${contextText}
                 sourceFilename: m.metadata?.sourceFilename,
                 slideTitle: m.metadata?.slideTitle,
                 score: Math.round(m.score * 100) / 100,
+                text: m.metadata?.text || '',
+                materialId: m.metadata?.materialId || '',
             }));
 
@@ -649,6 +652,8 @@ ${contextText}
             sourceFilename: m.metadata?.sourceFilename,
             slideTitle: m.metadata?.slideTitle,
             score: Math.round(m.score * 100) / 100,
+            text: m.metadata?.text || '',
+            materialId: m.metadata?.materialId || '',
         }));
```

**New file: backend/src/functions/material-download.js:**
```javascript
import { app } from '@azure/functions';
import { getMaterialState } from '../services/state-store.js';
import { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential, SASProtocol } from '@azure/storage-blob';
import { validateFrontDoorId } from '../services/auth-utils.js';

const CONTAINER_MATERIALS = process.env.AZURE_STORAGE_CONTAINER_MATERIALS || 'class-materials';

app.http('material-download', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'material-download',
    handler: async (request, context) => {
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
                body: JSON.stringify({ downloadUrl: sasUrl, filename: material.filename || 'material', status: material.status }),
            };
        } catch (err) {
            context.error('[Material Download] Error:', err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al generar descarga' }) };
        }
    },
});
```

**Frontend diff (api.js + ChatWidget.js):** See full diff above for complete changes.
Key additions:
- api.js: `getMaterialDownloadUrl(subjectId, materialId)`
- ChatWidget.js: `hasCitations()`, `renderFuentesSection()`, `showCitationModal()`, citation click event delegation, `[N]` → superscript in renderMarkdown, Fuentes section in renderMessage + stream handler
