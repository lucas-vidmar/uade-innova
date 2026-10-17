import { app } from '@azure/functions';
import { withAuth } from '../../../middleware/with-auth.js';
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reescribe y re-indexa el texto de UN material aplicando TODOS los fragmentos
 * que hay que corregir en una sola pasada: leer, reemplazar, escribir una vez.
 *
 * UJ-17: aplicar varias enmiendas del mismo material en paralelo hacía que cada
 * request leyera el blob `processed/{id}.json`, lo reescribiera y lo guardara sin
 * control de concurrencia; el último en escribir pisaba a los demás y el texto
 * indexado quedaba con la forma vieja aunque la enmienda figurara aplicada. Por
 * eso el reemplazo se hace acá, agrupado por material y en una única escritura.
 */
async function reindexMaterial({ subjectId, materialId, entities, context }) {
  if (!materialId) return false;
  try {
    const processed = await loadJson(CONTAINER_PROCESSED, `${materialId}.json`);
    const text = processed?.extractedText || processed?.text || '';
    if (!text) return false;

    let corrected = text;
    for (const entity of entities) {
      if (entity.fragment && entity.suggestedFix) {
        corrected = corrected.replace(new RegExp(escapeRegExp(entity.fragment), 'gi'), entity.suggestedFix);
      }
    }
    if (corrected === text) return false;

    await deleteVectorsByFilter({ materialId: { '$eq': materialId } });
    const chunks = chunkText(corrected);
    const chunkTexts = chunks.map(c => c.text || c);
    const { embeddings } = await generateEmbeddingsBatch(chunkTexts);
    const classId = entities.find(e => e.classId)?.classId || processed.classId || processed.classIds?.[0] || '';
    const vectors = embeddings.map((embedding, i) => ({
      id: `${materialId}-chunk-${i}`,
      values: embedding,
      metadata: {
        subjectId,
        classId,
        classIds: JSON.stringify(processed.classIds || []),
        materialId,
        materialType: processed.materialType || processed.type || 'transcript',
        chunkIndex: i,
        sourceFilename: processed.sourceFilename || processed.filename || '',
        lectureDate: processed.lectureDate || '',
        text: chunkTexts[i]?.substring(0, 1000) || '',
        quarantined: false,
      },
    }));
    await upsertChunks(vectors);

    processed.extractedText = corrected;
    processed.text = corrected;
    processed.chunks = chunks;
    processed.chunkCount = chunks.length;
    processed.processedAt = new Date().toISOString();
    await saveJson(CONTAINER_PROCESSED, `${materialId}.json`, processed);
    context.log(`[apply-transcription-correction] Re-indexed ${materialId} with ${chunks.length} corrected chunks (${entities.length} enmiendas en una sola pasada)`);
    return true;
  } catch (reErr) {
    context.error(`[apply-transcription-correction] Re-index failed for material ${materialId} (non-blocking):`, reErr.message);
    return false;
  }
}

app.http('apply-transcription-correction', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'corrections-transcription/apply',
  handler: withCorrelation(withAuth(async (request, context) => {
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

    const { subjectId } = body || {};
    // Acepta una enmienda (suggestionId) o muchas (suggestionIds). El camino de
    // muchas es el que usa "Aplicar todas": una sola pasada por material.
    const rawIds = Array.isArray(body?.suggestionIds)
      ? body.suggestionIds
      : (body?.suggestionId ? [body.suggestionId] : []);
    const suggestionIds = Array.from(new Set(rawIds.map((s) => String(s || '').trim()).filter(Boolean)));
    if (suggestionIds.length === 0 || !subjectId) {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'suggestionId(s) y subjectId son requeridos.' } }) };
    }

    try {
      const client = getTableClient(CORRECTIONS_TABLE);
      const teacherId = principal?.userId || principal?.oid || '';

      const entities = [];
      const failed = [];
      for (const id of suggestionIds) {
        try {
          entities.push(await client.getEntity(subjectId, id));
        } catch (err) {
          if (err.statusCode === 404) failed.push({ suggestionId: id, error: 'NOT_FOUND' });
          else throw err;
        }
      }

      // Camino de una sola enmienda: conserva el contrato de siempre (404/409).
      if (suggestionIds.length === 1) {
        if (failed.length) {
          return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Sugerencia no encontrada.' } }) };
        }
        const entity = entities[0];
        if (entity.status === 'applied' || entity.status === 'rejected') {
          return { status: 409, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'ALREADY_RESOLVED', message: 'Esta sugerencia ya fue resuelta.' } }) };
        }
      }

      const pending = entities.filter((e) => e.status !== 'applied' && e.status !== 'rejected');

      // Agrupar por material: una lectura y una escritura por material, así las
      // enmiendas del mismo material no se pisan entre sí.
      const byMaterial = new Map();
      for (const entity of pending) {
        const key = entity.materialId || '';
        if (!byMaterial.has(key)) byMaterial.set(key, []);
        byMaterial.get(key).push(entity);
      }

      const applied = [];
      const now = new Date().toISOString();
      for (const [materialId, ents] of byMaterial) {
        const reindexed = await reindexMaterial({ subjectId, materialId, entities: ents, context });
        for (const entity of ents) {
          entity.status = 'applied';
          entity.resolvedAt = now;
          entity.teacherId = teacherId;
          entity.reindexed = reindexed;
          await client.upsertEntity(entity, 'Replace');
          applied.push({ suggestionId: entity.rowKey, status: 'applied', reindexed });
        }
      }

      context.log(`[apply-transcription-correction] Applied ${applied.length}/${suggestionIds.length} suggestion(s) for subjectId=${subjectId}`);

      const single = suggestionIds.length === 1 ? applied[0] : null;
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          data: {
            suggestionId: single ? single.suggestionId : undefined,
            status: 'applied',
            reindexed: single ? single.reindexed : applied.some(a => a.reindexed),
            applied,
            appliedCount: applied.length,
            failed,
          },
        }),
      };
    } catch (err) {
      if (err.statusCode === 404) {
        return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Sugerencia no encontrada.' } }) };
      }
      context.error(`[apply-transcription-correction] Error:`, err);
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }) };
    }
  })),
});
