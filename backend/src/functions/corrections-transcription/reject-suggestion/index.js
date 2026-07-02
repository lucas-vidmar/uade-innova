import { app } from '@azure/functions';
import { withCorrelation } from '../../../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal } from '../../../services/auth-utils.js';
import { getTableClient } from '../../../services/storage.js';
import { CONFIG } from '../../../services/config.js';

const CORRECTIONS_TABLE = CONFIG.tables.transcriptionCorrections;

app.http('reject-transcription-suggestion', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'corrections-transcription/reject',
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

      const now = new Date().toISOString();
      entity.status = 'rejected';
      entity.resolvedAt = now;
      entity.teacherId = principal?.userId || principal?.oid || '';

      await client.upsertEntity(entity, 'Replace');

      context.log(`[reject-transcription-suggestion] Rejected suggestion ${suggestionId} for subjectId=${subjectId}`);

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, data: { suggestionId, status: 'rejected' } }),
      };
    } catch (err) {
      if (err.statusCode === 404) {
        return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Sugerencia no encontrada.' } }) };
      }
      context.error(`[reject-transcription-suggestion] Error:`, err);
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }) };
    }
  }),
});
