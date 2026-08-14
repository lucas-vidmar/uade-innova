import { app } from '@azure/functions';
import { withCorrelation } from '../../../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal } from '../../../services/auth-utils.js';
import { getTableClient, loadJson, saveJson } from '../../../services/storage.js';
import { getEnrollment } from '../../../services/state-store.js';
import { getGlossary } from '../../../services/glossary-store.js';
import { generateEmbedding } from '../../../services/ai.js';
import { upsertChunks, deleteVectorsByFilter } from '../../../services/vector-store.js';
import { chunkText } from '../../../services/parser.js';
import { generateEmbeddingsBatch } from '../../../services/ai.js';
import { CONFIG } from '../../../services/config.js';

const CORRECTIONS_TABLE = CONFIG.tables.transcriptionCorrections;
const CONTAINER_PROCESSED = 'processed';

app.http('apply-transcription-correction', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'corrections-transcription/apply',
  handler: withCorrelation(async (request, context) => {
    if (!validateFrontDoorId(request)) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }) };
    }

    const principal = parseClientPrincipal(request);
    const isTeacher = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development'
      || principal?.userRoles?.includes('Docente')
      || principal?.userRoles?.includes('Director');

    if (!isTeacher) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado. Se requiere rol Docente o Director.' } }) };
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'El cuerpo debe ser JSON válido.' } }) };
    }

    const { suggestionId, subjectId } = body || {};
    if (!suggestionId || !subjectId) {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'suggestionId y subjectId son requeridos.' } }) };
    }

    try {
      const client = getTableClient(CORRECTIONS_TABLE);
      const entity = await client.getEntity(subjectId, suggestionId);

      if (entity.status === 'applied' || entity.status === 'rejected') {
        return { status: 409, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'ALREADY_RESOLVED', message: 'Esta sugerencia ya fue resuelta.' } }) };
      }

      // 1. Rewrite the transcript text and re-embed so the correction takes effect in RAG
      let reindexed = false;
      if (entity.materialId && entity.fragment && entity.suggestedFix) {
        try {
          const processed = await loadJson(CONTAINER_PROCESSED, `${entity.materialId}.json`);
          const text = processed?.extractedText || processed?.text || '';
          if (text) {
            // Replace all occurrences of the fragment with the suggested fix
            const escaped = entity.fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const corrected = text.replace(new RegExp(escaped, 'gi'), entity.suggestedFix);

            if (corrected !== text) {
              await deleteVectorsByFilter({ materialId: { '$eq': entity.materialId } });
              const chunks = chunkText(corrected);
              const chunkTexts = chunks.map(c => c.text || c);
              const { embeddings } = await generateEmbeddingsBatch(chunkTexts);
              const vectors = embeddings.map((embedding, i) => ({
                id: `${entity.materialId}-chunk-${i}`,
                values: embedding,
                metadata: {
                  subjectId,
                  classId: entity.classId || processed.classId || processed.classIds?.[0] || '',
                  classIds: JSON.stringify(processed.classIds || []),
                  materialId: entity.materialId,
                  materialType: processed.materialType || processed.type || 'transcript',
                  chunkIndex: i,
                  sourceFilename: processed.sourceFilename || processed.filename || '',
                  lectureDate: processed.lectureDate || '',
                  text: chunkTexts[i]?.substring(0, 1000) || '',
                },
              }));
              await upsertChunks(vectors);

              processed.extractedText = corrected;
              processed.text = corrected;
              processed.chunks = chunks;
              processed.chunkCount = chunks.length;
              processed.processedAt = new Date().toISOString();
              await saveJson(CONTAINER_PROCESSED, `${entity.materialId}.json`, processed);
              reindexed = true;
              context.log(`[apply-transcription-correction] Re-indexed ${entity.materialId} with ${chunks.length} corrected chunks`);
            }
          }
        } catch (reErr) {
          context.error(`[apply-transcription-correction] Re-index failed for material ${entity.materialId} (non-blocking):`, reErr.message);
        }
      }

      const now = new Date().toISOString();
      entity.status = 'applied';
      entity.resolvedAt = now;
      entity.teacherId = principal?.userId || principal?.oid || '';
      entity.reindexed = reindexed;

      await client.upsertEntity(entity, 'Replace');

      context.log(`[apply-transcription-correction] Applied suggestion ${suggestionId} for subjectId=${subjectId} reindexed=${reindexed}`);

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, data: { suggestionId, status: 'applied', reindexed } }),
      };
    } catch (err) {
      if (err.statusCode === 404) {
        return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Sugerencia no encontrada.' } }) };
      }
      context.error(`[apply-transcription-correction] Error:`, err);
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }) };
    }
  }),
});
